import { AdjustData, CoupangComparisonWithOnchData, CronType } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { CalculateMarginAndAdjustPricesProvider } from './provider/calculateMarginAndAdjustPrice.provider';
import { PriceRepository } from '../infrastructure/price.repository';

@Injectable()
export class PriceCoupangService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly priceRepository: PriceRepository,
    private readonly utilService: UtilService,
    private readonly calculateMarginAndAdjustPricesProvider: CalculateMarginAndAdjustPricesProvider,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async coupangPriceControl(cronId: string) {
    const store = this.configService.get<string>('STORE');
    const crawlingLockKey = `lock:${this.configService.get<string>('STORE')}:coupang:price:crawl`;

    try {
      console.log(`${CronType.PRICE}${cronId}: 온채널/쿠팡 크롤링 데이터 삭제`);
      await this.rabbitmqService.send('onch-queue', 'clearOnchProducts', {
        cronId: cronId,
        type: CronType.PRICE,
      });
      await this.rabbitmqService.send('coupang-queue', 'clearCoupangComparison', {
        cronId: cronId,
        type: CronType.PRICE,
      });

      // 크롤링중 새로운 상품 등록 방지
      await this.redis.set(crawlingLockKey, Date.now().toString(), 'NX');

      console.log(`${CronType.PRICE}${cronId}: 온채널/쿠팡 판매상품 크롤링 시작`);
      await Promise.all([
        this.rabbitmqService.send('onch-queue', 'crawlOnchRegisteredProducts', {
          cronId,
          store,
          type: CronType.PRICE,
        }),

        this.rabbitmqService.send('coupang-queue', 'crawlCoupangPriceComparison', {
          cronId: cronId,
          type: CronType.PRICE,
          winnerStatus: 'LOSE_NOT_SUPPRESSED',
        }),

        // 위너상품의 경우 최소가, 최대가 미충족 상품 제거를 위해 같이 크롤링
        this.rabbitmqService.send('coupang-queue', 'crawlCoupangPriceComparison', {
          cronId: cronId,
          type: CronType.PRICE,
          winnerStatus: 'WIN_NOT_SUPPRESSED',
        }),
      ]);

      // 크롤링 락 해제
      await this.redis.del(crawlingLockKey);
      await this.calculateMarginAndAdjustPrices(cronId, CronType.PRICE);
    } catch (error) {
      console.error(
        `${CronType.ERROR}${CronType.PRICE}${cronId}: 쿠팡 자동가격조절 오류 발생\n`,
        error,
      );
    }
  }

  async calculateMarginAndAdjustPrices(cronId: string, type: string) {
    const productsBatch: AdjustData[] = [];
    const deleteProductsMap = new Map<string, CoupangComparisonWithOnchData>();

    console.log(`${CronType.PRICE}${cronId}: 새로운 판매가 연산 시작...`);

    const comparisonData: CoupangComparisonWithOnchData[] =
      await this.priceRepository.findCoupangComparisonWithOnchData({});

    for (const [i, data] of comparisonData.entries()) {
      if (i % Math.ceil(comparisonData.length / 10) === 0) {
        const progressPercentage = ((i + 1) / comparisonData.length) * 100;
        console.log(
          `${type}${cronId}: 상품 처리 중 ${i + 1}/${comparisonData.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      const productInfo = this.utilService.extractProductInfo(data.productName);
      const matchedItem = this.calculateMarginAndAdjustPricesProvider.findMatchingOnchItem(
        data,
        productInfo,
      );

      if (!matchedItem) {
        console.log(
          `${type}${cronId}: 매칭된 아이템을 찾지 못했습니다. ${data.productName}\n${data.onchProduct}`,
        );
        continue;
      }

      if (
        +data.winnerPrice > matchedItem.consumerPrice ||
        data.winnerVendorId === this.configService.get<string>('COUPANG_VENDOR_ID')
      ) {
        continue;
      }

      const adjustment: AdjustData | null = this.calculateMarginAndAdjustPricesProvider.adjustPrice(
        matchedItem,
        data,
      );

      if (
        adjustment === null ||
        !adjustment ||
        adjustment.newPrice < this.configService.get<number>('PRODUCT_MIN_PRICE') ||
        adjustment.newPrice > this.configService.get<number>('PRODUCT_MAX_PRICE')
      ) {
        deleteProductsMap.set(data.externalVendorSkuCode, data);
        continue;
      }
      if (adjustment.newPrice === adjustment.currentPrice) continue;

      productsBatch.push(adjustment);
      if (productsBatch.length >= 50) {
        console.log(`${type}${cronId}: 배치 저장`);
        await this.rabbitmqService.send('coupang-queue', 'saveUpdateCoupangItems', {
          cronId,
          type,
          items: productsBatch,
        });
        productsBatch.length = 0;
      }
    }
    if (productsBatch.length > 0) {
      await this.rabbitmqService.send('coupang-queue', 'saveUpdateCoupangItems', {
        cronId,
        type,
        items: productsBatch,
      });
    }

    console.log(`${type}${cronId}: 연산 종료`);
    console.log(`${type}${cronId}: ✉️coupang-coupangProductsPriceControl`);
    await this.rabbitmqService.emit('coupang-queue', 'coupangProductsPriceControl', {
      cronId: cronId,
      type: type,
    });

    const deleteProductsArray = Array.from(deleteProductsMap.values());
    console.log(`${type}${cronId}: 삭제대상 아이템(상품) ${deleteProductsArray.length} 개`);

    if (deleteProductsArray.length > 0)
      await this.deletePoorConditionProducts(cronId, type, deleteProductsArray);
  }

  async deletePoorConditionProducts(
    cronId: string,
    type: string,
    deleteProducts: CoupangComparisonWithOnchData[],
  ) {
    console.log(`${type}${cronId}: 조건미충족 상품 삭제 시작`);

    console.log(`${type}${cronId}: ✉️onch-deleteProducts`);
    await this.rabbitmqService.emit('onch-queue', 'deleteProducts', {
      cronId: cronId,
      store: this.configService.get<string>('STORE'),
      type: CronType.PRICE,
      data: deleteProducts,
    });

    console.log(`${type}${cronId}: 쿠팡 조건 미충족 상품 삭제 시작`);
    const chunkSize = 500; // 한 번에 전송할 데이터 개수

    for (let i = 0; i < deleteProducts.length; i += chunkSize) {
      const chunk = deleteProducts.slice(i, i + chunkSize);
      console.log(`${type}${cronId}: ${i}/${deleteProducts.length} 진행중`);

      await this.rabbitmqService.send('coupang-queue', 'stopSaleBySellerProductId', {
        cronId,
        type,
        data: chunk,
      });
      await this.rabbitmqService.send('coupang-queue', 'deleteBySellerProductId', {
        cronId,
        type,
        data: chunk,
      });
    }

    console.log(`${type}${cronId}: 조건미충족 상품 삭제 종료`);
  }
}
