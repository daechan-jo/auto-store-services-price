import { CoupangProduct, CronType } from '@daechanjo/models';
import { CoupangItem } from '@daechanjo/models/dist/interfaces/data/coupangItem.interface';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { CalculateMarginAndAdjustPricesProvider } from './provider/calculateMarginAndAdjustPrice.provider';
import { PriceRepository } from '../infrastructure/price.repository';

// todo 임시 인터페이스
interface OnchWithCoupangProduct {
  onchSellerPrice: number;
  onchShippingCost: number;
  coupangId: number;
  sellerProductId: string;
  coupangProductCode: string;
  coupangPrice: number;
  coupangShippingCost: number;
  coupangIsWinner: boolean;
  onchItems: [
    {
      itemName: string; // 본품이 나올 수 있으므로 중복 가능
      consumerPrice: number;
      sellerPrice: number;
    },
  ];
}

@Injectable()
export class PriceCoupangService {
  constructor(
    private readonly configService: ConfigService,
    private readonly utilService: UtilService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly priceRepository: PriceRepository,
    private readonly calculateMarginAndAdjustPricesProvider: CalculateMarginAndAdjustPricesProvider,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async initCoupangPriceControl(cronId?: string, retryCount = 0) {
    const lockKey = `lock:${this.configService.get<string>('STORE')}:coupang:price`;
    const currentCronId = cronId || this.utilService.generateCronId();

    const isLocked = await this.redis.set(lockKey, Date.now().toString(), 'NX');

    if (!isLocked) {
      console.log(`${CronType.PRICE}${currentCronId}: 락 획득 실패`);
      return;
    }

    try {
      console.log(`${CronType.PRICE}${currentCronId}: 시작`);

      await this.coupangPriceControl(currentCronId);
    } catch (error: any) {
      console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 오류 발생\n`, error);
      if (retryCount < 3) {
        console.log(`${CronType.PRICE}${currentCronId}: ${retryCount + 1}번째 재시도 예정`);
        setTimeout(() => this.initCoupangPriceControl(cronId, retryCount + 1), 3000);
      } else {
        await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
          cronType: CronType.PRICE,
          store: this.configService.get<string>('STORE'),
          cronId: currentCronId,
          message: error.message,
        });
        console.error(`${CronType.ERROR}${CronType.PRICE}${currentCronId}: 재시도 횟수 초과`);
      }
    } finally {
      await this.redis.del(lockKey);
      console.log(`${CronType.PRICE}${currentCronId}: 종료`);
    }
  }

  async coupangPriceControl(cronId: string) {
    const store = this.configService.get<string>('STORE');

    try {
      // console.log(`${CronType.PRICE}${cronId}: 온채널/쿠팡 크롤링 데이터 삭제`);
      // await this.rabbitmqService.send('onch-queue', 'clearOnchProducts', {
      //   cronId: cronId,
      //   type: CronType.PRICE,
      // });
      // await this.rabbitmqService.send('coupang-queue', 'clearCoupangProducts', {
      //   cronId: cronId,
      //   type: CronType.PRICE,
      // });
      //
      // console.log(`${CronType.PRICE}${cronId}: 온채널 등록상품 크롤링 시작`);
      // await this.rabbitmqService.send('onch-queue', 'crawlOnchRegisteredProducts', {
      //   cronId,
      //   store,
      //   type: CronType.PRICE,
      // });

      // console.log(`${CronType.PRICE}${cronId}: 쿠팡 판매상품 크롤링 시작`);
      // await this.rabbitmqService.send('coupang-queue', 'crawlCoupangDetailProducts', {
      //   cronId: cronId,
      //   type: CronType.PRICE,
      // });

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
    const deleteProducts = [];
    const productsBatch = [];
    const seenVendorItemIds = new Set();

    // const limit = 1000;
    // let offset = 0;
    let totalProcessed = 0;

    const products: OnchWithCoupangProduct[] = await this.priceRepository.getProducts();

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
      for (const [i, item] of coupangDetail.data.items.entries()) {
        // 해당 코드에 맞는 onchWithCoupangProdut 가져오기
        const matchedProducts = productsByCode.get(item.externalVendorSku) || [];

        if (matchedProducts.length > 0) {
          // todo delete 쓸모없음. 왜냐하면 무조건 한번만 매칭됨.
          // todo 이 반복문은 쿠팡상품 단일조회에 속한 아이템 개별 작업임
          // console.log(
          //   `상품코드 ${item.externalVendorSku}에 대한 매칭된 제품 수: ${matchedProducts.length}`,
          // );

          // 각 매칭된 product에 대해 처리 로직 실행
          for (const [x, onchItem] of matchedProducts[0].onchItems.entries()) {
            // todo 여기서 한번 더 매칭을 해야함. matchedProducts.onchItems 배열의 itemName === item
            const matchedItem = onchItem.itemName === item.itemName;

            console.log(`데이터베이스 아이템이름: ${i}-${x} ${onchItem.itemName}`);
            console.log(`쿠팡API조회 아이템이름: ${i}-${x} ${item.itemName}`);
            console.log(i + '-' + x, matchedItem);

            // 예: 가격 업데이트 로직
            // await processProductUpdate(matchedProduct, item);
          }
        } else {
          console.log(`상품코드 ${item.externalVendorSku}에 대한 매칭된 제품이 없습니다.`);
        }
      }

      //   for (const onchItem of product.onchItems) {
      //     const matchedCoupangItem = coupangItemMap.get(onchItem.itemName.trim());
      //     if (!matchedCoupangItem) continue;
      //
      //     // 가격 데이터 가공
      //     const processedData = this.calculateMarginAndAdjustPricesProvider.processProductData(
      //       product,
      //       onchItem,
      //       matchedCoupangItem,
      //     );
      //
      //     // 판매가, 순수익, 목표 최소마진
      //     const { salePrice, currentMargin, targetMargin } =
      //       this.calculateMarginAndAdjustPricesProvider.calculatePrices(processedData);
      //
      //     const adjustment = this.calculateMarginAndAdjustPricesProvider.adjustPrice(
      //       salePrice,
      //       currentMargin,
      //       targetMargin,
      //       processedData,
      //     );
      //
      //     // 비정상 가격은 삭제 후보
      //     if (!adjustment || adjustment?.newPrice < 7000 || adjustment?.newPrice > 1000000) {
      //       deleteProducts.push(product);
      //       break;
      //     }
      //
      //     if (adjustment && !seenVendorItemIds.has(adjustment.vendorItemId)) {
      //       seenVendorItemIds.add(adjustment.vendorItemId);
      //       productsBatch.push(adjustment);
      //
      //       if (productsBatch.length >= 50) {
      //         await this.coupangRepository.saveUpdatedCoupangItems(productsBatch, cronId);
      //         productsBatch.length = 0;
      //       }
      //     }
      //   }
      // }
      //
      // console.log(`${type}${cronId}: 누적 처리 상품 수: ${totalProcessed}`);
      //
      // if (productsBatch.length > 0) {
      //   await this.coupangRepository.saveUpdatedCoupangItems(productsBatch, cronId);
      // }

      console.log(`${type}${cronId}: 연산 종료`);

      // console.log(`${type}${cronId}: ✉️coupang-coupangProductsPriceControl`);
      // await this.rabbitmqService.send('coupang-queue', 'coupangProductsPriceControl', {
      //   cronId: cronId,
      //   type: type,
      // });

      // await this.deletePoorConditionProducts(cronId, type, deleteProducts);
    }

    // async deletePoorConditionProducts(cronId: string, type: string, deleteProducts: any[]) {
    //   console.log(`${type}${cronId}: 조건미충족 상품 삭제 시작`);
    //
    //   console.log(`${type}${cronId}: ✉️onch-deleteProducts`);
    //   await this.rabbitmqService.emit('onch-queue', 'deleteProducts', {
    //     cronId: cronId,
    //     store: this.configService.get<string>('STORE'),
    //     type: CronType.PRICE,
    //     matchedCoupangProducts: deleteProducts,
    //     matchedNaverProducts: [],
    //   });
    //
    //   const chunkSize = 1000; // 한 번에 전송할 데이터 개수
    //
    //   for (let i = 0; i < deleteProducts.length; i += chunkSize) {
    //     console.log(`${type}${cronId}: ${i}/${deleteProducts.length} `);
    //     const chunk = deleteProducts.slice(i, i + chunkSize);
    //
    //     await this.stopSaleForMatchedProducts(cronId, CronType.PRICE, chunk);
    //     await this.deleteProducts(cronId, CronType.PRICE, chunk);
    //   }
    //
    //   console.log(`${type}${cronId}: 종료`);
    // }
  }
}
