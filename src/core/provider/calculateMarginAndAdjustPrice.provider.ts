import {
  AdjustData,
  CoupangComparisonWithOnchData,
  OnchItem,
  OnchWithCoupangProduct,
  ProcessProductData,
} from '@daechanjo/models';
import { CoupangItem } from '@daechanjo/models/dist/interfaces/data/coupangItem.interface';
import { Injectable } from '@nestjs/common';
import * as stringSimilarity from 'string-similarity';

@Injectable()
export class CalculateMarginAndAdjustPricesProvider {
  processProductData(
    item: CoupangItem, // api로 조회한거
    matchedItem: { itemName: string; consumerPrice: number; sellerPrice: number }, // db에서 나온 아이템
    matchedProduct: OnchWithCoupangProduct, // db에서 나온 구조체
  ): ProcessProductData {
    return {
      sellerProductId: matchedProduct.sellerProductId,
      vendorItemId: item.vendorItemId,
      itemName: item.itemName,
      coupangSalePrice: +item.salePrice,
      onchSellerPrice: +matchedItem.sellerPrice,
      onchConsumerPrice: +matchedItem.consumerPrice,
      coupangIsWinner: matchedProduct.coupangIsWinner,
    };
  }

  calculateNetProfit(salePrice: number, wholesalePrice: number) {
    const fee = salePrice * 0.108;
    const profit = Math.round(salePrice - fee);
    return profit - wholesalePrice;
  }

  adjustPrice(item: OnchItem, data: CoupangComparisonWithOnchData): AdjustData | null {
    // 새로운 가격은 상대 위너 가격보다 3% 낮게 설정
    const newPrice = +data.winnerPrice * 0.97;
    const roundedPrice = Math.round(newPrice / 10) * 10;

    // 목표 최소 순수익(도매가의 10프로)
    const minimumNetProfit = Math.round(item.sellerPrice * 0.1);
    // 새로운 가격의 순수익
    const newProfit = this.calculateNetProfit(roundedPrice, item.sellerPrice);
    // 새로운 생선한 가격의 마진이 목표 마진보다 높다면
    if (newProfit >= minimumNetProfit) {
      return {
        vendorItemId: data.vendorItemId,
        productName: data.productName,
        winnerPrice: +data.winnerPrice,
        currentPrice: +data.currentPrice,
        sellerPrice: item.sellerPrice,
        newPrice: roundedPrice,
      };
    } else {
      return null;
    }
  }

  /**
   * 쿠팡 상품 데이터에서 일치하는 온채널 아이템을 찾습니다.
   * 아이템 이름이 일치하는 것을 찾거나, '본품'이라고 표시된 기본 아이템을 반환합니다.
   *
   * @param {CoupangComparisonWithOnchData} data - 쿠팡 비교 데이터
   * @param {Object} productInfo - 상품 정보 객체 (extractProductInfo 함수의 반환값)
   * @returns {OnchItem | null} 일치하는 온채널 아이템 또는 null
   */
  /**
   * 쿠팡 상품 데이터에서 일치하는 온채널 아이템을 찾습니다.
   * 옵션 이름이 일치하는 것을 찾거나, '본품'이라고 표시된 기본 아이템을 반환합니다.
   *
   * @param {CoupangComparisonWithOnchData} data - 쿠팡 비교 데이터
   * @param {Object} productInfo - 상품 정보 객체 (extractProductInfo 함수의 반환값)
   * @returns {OnchItem | null} 일치하는 온채널 아이템 또는 null
   */
  findMatchingOnchItem(
    data: CoupangComparisonWithOnchData,
    productInfo: { original: string; productName: string; options: string[] },
  ): OnchItem | null {
    // onchProduct와 onchItems가 존재하는지 확인
    if (
      !data.onchProduct ||
      !data.onchProduct.onchItems ||
      data.onchProduct.onchItems.length === 0
    ) {
      return null; // 데이터가 없으면 null 반환
    }

    let matchedItem: OnchItem | null = null;

    // 옵션 배열이 있고 비어있지 않은 경우
    if (productInfo.options && productInfo.options.length > 0) {
      // 각 옵션에 대해 일치하는 아이템 찾기
      for (const option of productInfo.options) {
        const optionNormalized = option.trim().toLowerCase().replace(/\s+/g, '');
        // 옵션 이름과 일치하는 아이템 찾기
        const item = data.onchProduct.onchItems.find((item) => {
          if (!item.itemName) return false;
          const itemNameNormalized = item.itemName.trim().toLowerCase().replace(/\s+/g, '');
          return itemNameNormalized === optionNormalized;
        });
        if (item) {
          matchedItem = item;
          break; // 일치하는 아이템을 찾으면 루프 종료
        }
      }
    }

    // '본품'이라는 아이템 찾기
    if (!matchedItem) {
      matchedItem = data.onchProduct.onchItems.find(
        (item) => item.itemName && item.itemName.trim() === '본품',
      );
    }

    if (!matchedItem) {
      // 아이템 이름 배열 생성 및 정규화
      const itemNames = data.onchProduct.onchItems
        .filter((item) => item.itemName)
        .map((item) => ({
          item,
          normalizedName: item.itemName!.trim().toLowerCase(),
        }));

      // 검색을 위한 제품명 정규화
      const normalizedProductName = data.productName.trim().toLowerCase();

      // 유사도 비교를 위한 배열 구성
      const targets = itemNames.map((entry) => entry.normalizedName);

      // 제품명과 모든 아이템의 유사도 계산
      const matches = stringSimilarity.findBestMatch(normalizedProductName, targets);

      // 가장 유사한 아이템 선택 (유사도와 무관하게 항상 최고 점수 선택)
      matchedItem = itemNames[matches.bestMatchIndex].item;
    }

    // 아이템이 하나뿐일 경우 그것을 반환
    if (!matchedItem && data.onchProduct.onchItems.length === 1) {
      matchedItem = data.onchProduct.onchItems[0];
    }

    return matchedItem;
  }
}
