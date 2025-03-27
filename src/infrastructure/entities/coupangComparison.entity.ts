import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'coupang_comparison' })
export class CoupangComparisonEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'product_id', type: 'bigint' })
  productId: number;

  @Column({ name: 'vendor_item_id', type: 'bigint' })
  vendorItemId: number;

  @Column({ name: 'item_id', type: 'bigint' })
  itemId: number;

  @Column({ name: 'product_name', type: 'varchar' })
  productName: string;

  @Column({ name: 'winner_status', type: 'boolean' })
  winnerStatus: boolean;

  // 현재 위너와 나의 가격차
  @Column({ name: 'price_gap_with_winner_product', type: 'varchar' })
  priceGapWithWinnerProduct: string;

  @Column({ name: 'winner_vendor_item_id', type: 'bigint' })
  winnerVendorItemId: number;

  @Column({ name: 'winner_vendor_id', type: 'varchar' })
  winnerVendorId: string;

  // 현재 위너인 아이템 가격
  @Column({ name: 'winner_price', type: 'varchar' })
  winnerPrice: string;

  @Column({ name: 'winner_final_price', type: 'varchar' })
  winnerFinalPrice: string;

  @Column({ name: 'winner_shipping_fee', type: 'varchar' })
  winnerShippingFee: string;

  // 현재 내 가격
  @Column({ name: 'current_price', type: 'varchar' })
  currentPrice: string;

  @Column({ name: 'current_final_price', type: 'varchar' })
  currentFinalPrice: string;

  @Column({ name: 'current_shipping_fee', type: 'varchar' })
  currentShippingFee: string;

  // 추천가
  @Column({ name: 'recommend_price', type: 'varchar' })
  recommendPrice: string;

  @Column({ name: 'recommend_unit_price_num', type: 'varchar' })
  recommendUnitPriceNum: string;

  @Column({ name: 'recommend_unit_price_unit', type: 'varchar' })
  recommendUnitPriceUnit: string;

  @Column({ name: 'recommend_final_price', type: 'varchar' })
  recommendFinalPrice: string;

  // 잠재가?
  @Column({ name: 'potential_sales', type: 'varchar' })
  potentialSales: string;

  // 7일간 판매내역
  @Column({ name: 'my_recent_sales', type: 'varchar' })
  myRecentSales: string;

  @Column({ name: 'my_recent_gmv', type: 'varchar' })
  myRecentGmv: string;

  // 온채널 상품코드
  @Column({ name: 'external_vendor_sku_code', type: 'varchar' })
  externalVendorSkuCode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
