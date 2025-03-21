import { AdjustData, OnchWithCoupangProduct, ProcessProductData } from '@daechanjo/models';
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

  calculatePrices(processedData: ProcessProductData) {
    // 이익 ( - 10.8% 수수료 )
    const fee = processedData.coupangSalePrice * 0.108;
    const profit = Math.round(processedData.coupangSalePrice - fee);

    // 순수익
    const netProfit = profit - processedData.onchSellerPrice;

    // 목표 최소 마진
    const minimumNetProfit = Math.round(processedData.onchSellerPrice * 0.07);

    return { netProfit, minimumNetProfit };
  }

  adjustPrice(
    netProfit: number,
    minimumNetProfit: number,
    processedData: ProcessProductData,
  ): AdjustData | null {
    // 위너가 아니고 현재 순이익이 최소 목표마진보다 높다면
    if (!processedData.coupangIsWinner && netProfit > minimumNetProfit * 1.03) {
      // 새로운 가격은 원래 가격보다 3% 낮게 설정
      const newPrice = processedData.coupangSalePrice * 0.97;
      const roundedPrice = Math.round(newPrice / 10) * 10;

      return {
        sellerProductId: processedData.sellerProductId,
        vendorItemId: processedData.vendorItemId,
        itemName: processedData.itemName,
        newPrice: roundedPrice,
        currentPrice: processedData.coupangSalePrice,
        currentIsWinner: processedData.coupangIsWinner,
      };
    } else {
      return null;
    }
  }
}
