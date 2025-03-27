import {
  AdjustData,
  CoupangComparisonWithOnchData,
  OnchItem,
  OnchWithCoupangProduct,
  ProcessProductData,
} from '@daechanjo/models';
import { CoupangItem } from '@daechanjo/models/dist/interfaces/data/coupangItem.interface';
import { Injectable } from '@nestjs/common';

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

  calculatePrices(data: CoupangComparisonWithOnchData) {
    // 순수익
    const netProfit = this.calculateNetProfit(+data.currentPrice, +data.onchProduct.sellerPrice);

    // 목표 최소 이익
    const minimumNetProfit = Math.round(+data.onchProduct.sellerPrice * 0.1);

    return { netProfit, minimumNetProfit };
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

    // 목표 최소 순수익(10프로)
    const minimumNetProfit = Math.round(+item.sellerPrice * 0.1);
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
   * @param {string} itemName - 찾고자 하는 아이템 이름
   * @returns {OnchItem | null} 일치하는 온채널 아이템 또는 null
   */
  findMatchingOnchItem(data: CoupangComparisonWithOnchData, itemName: string): OnchItem {
    // onchProduct와 onchItems가 존재하는지 확인
    if (
      !data.onchProduct ||
      !data.onchProduct.onchItems ||
      data.onchProduct.onchItems.length === 0
    ) {
      return null; // 데이터가 없으면 null 반환
    }

    // 1. 정확히 일치하는 아이템 찾기
    let matchedItem = data.onchProduct.onchItems.find(
      (item) =>
        item.itemName && item.itemName.trim().toLowerCase() === itemName.trim().toLowerCase(),
    );

    // 2. 일치하는 아이템이 없고, '본품'이라는 아이템이 있으면 그것을 반환
    if (!matchedItem) {
      matchedItem = data.onchProduct.onchItems.find(
        (item) => item.itemName && item.itemName.trim() === '본품',
      );
    }

    // 3. 그래도 없으면, 아이템이 하나뿐일 경우 그것을 반환
    if (!matchedItem && data.onchProduct.onchItems.length === 1) {
      matchedItem = data.onchProduct.onchItems[0];
    }

    return matchedItem;
  }
}
