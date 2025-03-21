import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { CoupangProductEntity } from './entities/coupangProduct.entity';

export class PriceRepository {
  constructor(
    @InjectRepository(CoupangProductEntity)
    private readonly coupangProductRepository: Repository<CoupangProductEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async fetchCoupangProductsWithOnchData() {
    const subQuery = this.coupangProductRepository
      .createQueryBuilder('c')
      .select([
        'c.id AS id',
        'c.seller_product_id AS "sellerProductId"',
        'c.product_code AS "productCode"',
        'c.price AS price',
        'c.shipping_cost AS "shippingCost"',
        'c.is_winner AS "isWinner"',
      ])
      .where('c.id IS NOT NULL')
      .andWhere('c.product_code IS NOT NULL')
      .andWhere('c.price IS NOT NULL')
      .andWhere('c.shipping_cost IS NOT NULL')
      .andWhere('c.is_winner IS NOT NULL')
      .orderBy('c.id', 'ASC');

    // 메인 쿼리: 서브쿼리 결과(up)와 onch_product, onch_item를 조인
    return await this.dataSource
      .createQueryBuilder()
      .select('up.id', 'coupangId')
      .addSelect('up."sellerProductId"', 'sellerProductId')
      .addSelect('up."productCode"', 'coupangProductCode')
      .addSelect('up.price', 'coupangPrice')
      .addSelect('up."shippingCost"', 'coupangShippingCost')
      .addSelect('up."isWinner"', 'coupangIsWinner')
      .addSelect('o.sellerPrice', 'onchSellerPrice')
      .addSelect('o.shippingCost', 'onchShippingCost')
      .addSelect(
        `COALESCE(
        json_agg(
          json_build_object(
            'itemName', i.item_name,
            'consumerPrice', i.consumer_price,
            'sellerPrice', i.seller_price
          )
        ) FILTER (WHERE i.item_name IS NOT NULL), '[]'
      )`,
        'onchItems',
      )
      .from('(' + subQuery.getQuery() + ')', 'up')
      .innerJoin('onch_product', 'o', 'up."productCode" = o.product_code')
      .leftJoin('onch_item', 'i', 'o.id = i.onchProductId')
      .where('o.seller_price IS NOT NULL')
      .andWhere('o.shipping_cost IS NOT NULL')
      .groupBy(
        'up.id, up."sellerProductId", up."productCode", up.price, up."shippingCost", up."isWinner", o.seller_price, o.shipping_cost',
      )
      .orderBy('up.id', 'ASC')
      .setParameters(subQuery.getParameters())
      .getRawMany();
  }
}
