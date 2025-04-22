import {
  AdjustData,
  CoupangComparisonWithOnchData,
  JobType,
  WinnerStatus,
} from '@daechanjo/models';
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

  async coupangPriceControl(jobId: string) {
    const store = this.configService.get<string>('STORE');

    try {
      console.log(`${JobType.PRICE}${jobId}: 온채널/쿠팡 크롤링 데이터 삭제`);
      await this.rabbitmqService.send('onch-queue', 'clearOnchProducts', {
        jobId: jobId,
        jobType: JobType.PRICE,
      });
      await this.rabbitmqService.send('coupang-queue', 'clearCoupangComparison', {
        jobId: jobId,
        jobType: JobType.PRICE,
      });

      console.log(`${JobType.PRICE}${jobId}: 온채널/쿠팡 판매상품 크롤링 시작`);
      await Promise.all([
        this.rabbitmqService.send('onch-queue', 'crawlOnchRegisteredProducts', {
          jobId: jobId,
          jobType: JobType.PRICE,
          store: store,
        }),

        this.rabbitmqService.send('coupang-queue', 'crawlCoupangPriceComparison', {
          jobId: jobId,
          jobType: JobType.PRICE,
          data: WinnerStatus.LOSE_NOT_SUPPRESSED,
        }),

        // 위너상품의 경우 최소가, 최대가 미충족 상품 제거를 위해 같이 크롤링
        this.rabbitmqService.send('coupang-queue', 'crawlCoupangPriceComparison', {
          jobId: jobId,
          jobType: JobType.PRICE,
          data: WinnerStatus.WIN_NOT_SUPPRESSED,
        }),

        // 노출 제한
        this.rabbitmqService.send('coupang-queue', 'crawlCoupangPriceComparison', {
          jobId: jobId,
          jobType: JobType.PRICE,
          data: WinnerStatus.ANY_SUPPRESSED,
        }),
      ]);

      await this.calculateMarginAndAdjustPrices(jobId, JobType.PRICE);
    } catch (error) {
      console.error(
        `${JobType.ERROR}${JobType.PRICE}${jobId}: 쿠팡 자동가격조절 오류 발생\n`,
        error,
      );
    } finally {
    }
  }

  async calculateMarginAndAdjustPrices(jobId: string, jobType: string) {
    let failCount = 0;
    let successCount = 0;
    const productsBatch: AdjustData[] = [];
    const deleteProductsMap = new Map<string, CoupangComparisonWithOnchData>();

    console.log(`${JobType.PRICE}${jobId}: 새로운 판매가 연산 시작...`);

    const comparisonData: CoupangComparisonWithOnchData[] =
      await this.priceRepository.findCoupangComparisonWithOnchData({});

    for (const [i, data] of comparisonData.entries()) {
      if (i % Math.ceil(comparisonData.length / 10) === 0) {
        const progressPercentage = ((i + 1) / comparisonData.length) * 100;
        console.log(
          `${jobType}${jobId}: 상품 처리 중 ${i + 1}/${comparisonData.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      const productInfo = this.utilService.extractProductInfo(data.productName);
      const matchedItem = this.calculateMarginAndAdjustPricesProvider.findMatchingOnchItem(
        data,
        productInfo,
      );

      if (!matchedItem) {
        console.log(
          `${jobType}${jobId}: 매칭된 아이템을 찾지 못했습니다. ${data.productName}\n${data.onchProduct}`,
        );
        failCount++;
        continue;
      }

      // 현재 내 상품이 위너인 경우 컨티뉴
      if (
        +data.winnerFinalPrice > matchedItem.consumerPrice + +data.currentShippingFee ||
        data.winnerVendorId === this.configService.get<string>('COUPANG_VENDOR_ID')
      )
        continue;

      if (
        +data.currentPrice < this.configService.get<number>('PRODUCT_MIN_PRICE') ||
        +data.currentPrice > this.configService.get<number>('PRODUCT_MAX_PRICE')
      ) {
        deleteProductsMap.set(data.externalVendorSkuCode, data);
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
      successCount++;
      if (productsBatch.length >= 50) {
        console.log(`${jobType}${jobId}: 배치 저장`);
        await this.rabbitmqService.send('coupang-queue', 'saveUpdateCoupangItems', {
          jobId,
          jobType,
          data: productsBatch,
        });
        productsBatch.length = 0;
      }
    }
    if (productsBatch.length > 0) {
      await this.rabbitmqService.send('coupang-queue', 'saveUpdateCoupangItems', {
        jobId,
        jobType,
        data: productsBatch,
      });
    }

    console.log(`${jobType}${jobId}: 연산 종료`);
    console.log(`${jobType}${jobId}: ✉️coupang-coupangProductsPriceControl`);
    await this.rabbitmqService.emit('coupang-queue', 'coupangProductsPriceControl', {
      jobId: jobId,
      jobType: jobType,
    });

    const deleteProductsArray = Array.from(deleteProductsMap.values());
    console.log(`${jobType}${jobId}: 총 아이템 ${comparisonData.length}`);
    console.log(`${jobType}${jobId}: 성공/${successCount} 실패/${failCount}`);
    console.log(`${jobType}${jobId}: 삭제대상 아이템 ${deleteProductsArray.length} 개`);

    if (deleteProductsArray.length > 0)
      await this.deletePoorConditionProducts(jobId, jobType, deleteProductsArray);
  }

  async deletePoorConditionProducts(
    jobId: string,
    jobType: string,
    data: CoupangComparisonWithOnchData[],
  ) {
    console.log(`${jobType}${jobId}: 조건미충족 상품 삭제 시작`);

    const deleteProducts = data.map((product) => {
      return {
        sellerProductId: String(product.vendorInventoryId),
        productName: product.productName,
      };
    });

    console.log(`${jobType}${jobId}: ✉️onch-deleteProducts`);
    await this.rabbitmqService.emit('onch-queue', 'deleteProducts', {
      jobId: jobId,
      jobType: JobType.PRICE,
      store: this.configService.get<string>('STORE'),
      data: deleteProducts,
    });

    console.log(`${jobType}${jobId}: 쿠팡 조건 미충족 상품 삭제 시작`);
    const chunkSize = 500; // 한 번에 전송할 데이터 개수

    for (let i = 0; i < deleteProducts.length; i += chunkSize) {
      const chunk = deleteProducts.slice(i, i + chunkSize);
      console.log(`${jobType}${jobId}: ${i}/${deleteProducts.length} 진행중`);

      await this.rabbitmqService.send('coupang-queue', 'stopSaleBySellerProductId', {
        jobId,
        jobType,
        data: chunk,
      });
      await this.rabbitmqService.send('coupang-queue', 'deleteBySellerProductId', {
        jobId,
        jobType,
        data: chunk,
      });
    }

    console.log(`${jobType}${jobId}: 조건미충족 상품 삭제 종료`);
  }
}
