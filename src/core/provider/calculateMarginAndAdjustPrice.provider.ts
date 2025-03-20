import { Injectable } from '@nestjs/common';

@Injectable()
export class CalculateMarginAndAdjustPricesProvider {
  processProductData(product: any, onchItem: any, matchedCoupangItem: any) {
    return {
      sellerProductId: product.sellerProductId,
      vendorItemId: matchedCoupangItem.vendorItemId,
      itemName: onchItem.itemName,
      coupangSalePrice: +matchedCoupangItem.salePrice,
      onchSellerPrice: +onchItem.sellerPrice,
      onchConsumerPrice: +onchItem.consumerPrice,
      coupangShippingCost: +product.coupangShippingCost,
      onchShippingCost: +product.onchShippingCost,
      coupangIsWinner: product.coupangIsWinner,
    };
  }

  calculatePrices(processedData: any) {
    const salePrice = Math.round(
      processedData.coupangSalePrice -
        processedData.coupangSalePrice / 10.8 +
        processedData.coupangShippingCost,
    );
    // 도매가
    const wholesalePrice = processedData.onchSellerPrice + processedData.onchShippingCost;

    // 순수익 ( 도매가 - 판매가 )
    const currentMargin = salePrice - wholesalePrice;

    // 목표 최소 마진
    const targetMargin = Math.round(wholesalePrice * 0.07); // 최소 마진 7%

    return { salePrice, currentMargin, targetMargin };
  }

  adjustPrice(salePrice: number, currentMargin: number, targetMargin: number, processedData: any) {
    // 위너가 아니고 현재 마진이 목표 마진보다 높다면
    if (currentMargin > targetMargin && !processedData.coupangIsWinner) {
      const newPrice = salePrice * 0.97;
      const roundedPrice = Math.round(newPrice / 10) * 10;

      return {
        sellerProductId: processedData.sellerProductId,
        vendorItemId: processedData.vendorItemId,
        itemName: processedData.itemName,
        action: 'down',
        newPrice: roundedPrice,
        currentPrice: processedData.coupangSalePrice,
        currentIsWinner: processedData.coupangIsWinner,
      };
    }
  }
}
