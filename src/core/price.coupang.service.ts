import {
  AdjustData,
  CoupangProduct,
  CronType,
  OnchWithCoupangProduct,
  ProcessProductData,
} from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
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
      await this.rabbitmqService.send('coupang-queue', 'clearCoupangProducts', {
        cronId: cronId,
        type: CronType.PRICE,
      });

      // 크롤링중 새로운 상품 등록 방지
      await this.redis.set(crawlingLockKey, Date.now().toString(), 'NX');

      console.log(`${CronType.PRICE}${cronId}: 온채널 등록상품 크롤링 시작`);
      await this.rabbitmqService.send('onch-queue', 'crawlOnchRegisteredProducts', {
        cronId,
        store,
        type: CronType.PRICE,
      });

      console.log(`${CronType.PRICE}${cronId}: 쿠팡 판매상품 크롤링 시작`);
      await this.rabbitmqService.send('coupang-queue', 'crawlCoupangDetailProducts', {
        cronId: cronId,
        type: CronType.PRICE,
      });

      // 크롤링 락 해제
      await this.redis.del(crawlingLockKey);
      console.log(`${CronType.PRICE}${cronId}: 새로운 판매가 연산 시작...`);
      await this.calculateMarginAndAdjustPrices(cronId, CronType.PRICE);
    } catch (error) {
      console.error(
        `${CronType.ERROR}${CronType.PRICE}${cronId}: 쿠팡 자동가격조절 오류 발생\n`,
        error,
      );
    }
  }

  async calculateMarginAndAdjustPrices(cronId: string, type: string) {
    const deleteProducts: OnchWithCoupangProduct[] = [];
    const productsBatch: AdjustData[] = [];
    const seenVendorItemIds = new Set();

    let totalProcessed = 0;

    // todo 가능하다면 쿠팡 서비스로 이전
    const products: OnchWithCoupangProduct[] =
      await this.priceRepository.fetchCoupangProductsWithOnchData();

    // products 배열을 상품코드별로 그룹화
    const productsByCode = new Map<string, OnchWithCoupangProduct[]>();
    for (const product of products) {
      const code = product.coupangProductCode.trim();
      if (!productsByCode.has(code)) {
        productsByCode.set(code, []);
      }
      productsByCode.get(code).push(product);
    }

    console.log(`${type}${cronId}: ${products.length}개 상품 연산 시작`);
    // 2) 상품 각각을 처리
    for (const [i, product] of products.entries()) {
      totalProcessed++;

      if (i % Math.ceil(products.length / 10) === 0) {
        const progressPercentage = ((i + 1) / products.length) * 100;
        console.log(
          `${type}${cronId}: 상품 처리 중 ${i + 1}/${products.length} (${progressPercentage.toFixed(2)}%)`,
        );
      }

      // 쿠팡 상세 정보 가져오기
      const coupangDetail: { status: string; data: CoupangProduct } =
        await this.rabbitmqService.send('coupang-queue', 'getProductDetail', {
          cronId,
          type: CronType.PRICE,
          sellerProductId: product.sellerProductId,
        });

      if (!coupangDetail.data.items || !Array.isArray(coupangDetail.data.items)) {
        console.warn(
          `${type}${cronId}: 쿠팡 세부 정보 오류 - ${product.sellerProductId}\n`,
          coupangDetail,
        );
        continue;
      }

      // todo 1차 매칭
      for (const item of coupangDetail.data.items) {
        // 현재 아이템(쿠팡조회)이 속한 onchWithCoupangProdut 가져오기
        const matchedProducts = productsByCode.get(item.externalVendorSku) || [];

        if (matchedProducts) {
          // onchWithCoupangProduct에 속한 아이템 루프
          for (const matchedItem of matchedProducts[0].onchItems) {
            // todo 여기서 한번 더 매칭을 해야함. matchedProducts.onchItems 배열의 itemName === item
            if (matchedItem.itemName === item.itemName) {
              // 데이터 가공
              const processedData: ProcessProductData =
                this.calculateMarginAndAdjustPricesProvider.processProductData(
                  item,
                  matchedItem,
                  matchedProducts[0],
                );


              // 판매가, 순수익, 목표 최소마진
              const { netProfit, minimumNetProfit } =
                this.calculateMarginAndAdjustPricesProvider.calculatePrices(processedData);

              const adjustment: AdjustData =
                this.calculateMarginAndAdjustPricesProvider.adjustPrice(
                  netProfit,
                  minimumNetProfit,
                  processedData,
                );

              if (!adjustment || adjustment.newPrice < 5000 || adjustment.newPrice > 500000) {
                deleteProducts.push(product);
                break;
              }

							// 이미 위너이거나 승인 대기중이라면 패스
							if(adjustment.currentIsWinner || adjustment.vendorItemId === null) continue;

              if (adjustment && !seenVendorItemIds.has(adjustment.vendorItemId)) {
                seenVendorItemIds.add(adjustment.vendorItemId);
                productsBatch.push(adjustment);

                if (productsBatch.length >= 50) {
                  await this.rabbitmqService.send('coupang-queue', 'saveUpdateCoupangItems', {
                    cronId,
                    type,
                    items: productsBatch,
                  });
                  productsBatch.length = 0;
                }
              }
            }
          }
        } else {
          console.log(`상품코드 ${item.externalVendorSku}에 대한 매칭된 제품이 없습니다.`);
        }
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

    if (deleteProducts.length > 0)
      await this.deletePoorConditionProducts(cronId, type, deleteProducts);
  }

  async deletePoorConditionProducts(
    cronId: string,
    type: string,
    deleteProducts: OnchWithCoupangProduct[],
  ) {
    console.log(`${type}${cronId}: 조건미충족 상품 삭제 시작`);

    console.log(`${type}${cronId}: ✉️onch-deleteProducts`);
    await this.rabbitmqService.emit('onch-queue', 'deleteProducts', {
      cronId: cronId,
      store: this.configService.get<string>('STORE'),
      type: CronType.PRICE,
      products: deleteProducts,
    });

    const chunkSize = 500; // 한 번에 전송할 데이터 개수

    for (let i = 0; i < deleteProducts.length; i += chunkSize) {
      const chunk = deleteProducts.slice(i, i + chunkSize);
      console.log(`${type}${cronId}: ${chunk.length}/${deleteProducts.length} 진행중`);

      await this.rabbitmqService.send('coupang-queue', 'stopSaleForMatchedProducts', {
        cronId,
        type,
        matchedProducts: chunk,
      });
      await this.rabbitmqService.send('coupang-queue', 'deleteProducts', {
        cronId,
        type,
        matchedProducts: chunk,
      });
    }

    console.log(`${type}${cronId}: 조건미충족 상품 삭제 종료`);
  }
}
