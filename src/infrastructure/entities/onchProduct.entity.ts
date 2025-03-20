import { Type } from '@daechanjo/models';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';

import { OnchItemEntity } from './onchItem.entity';

@Entity({ name: 'onch_product' })
export class OnchProductEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'product_code', type: 'varchar', length: 255, nullable: true })
  productCode: string;

  @OneToMany(() => OnchItemEntity, (onchItem) => onchItem.onchProduct, {
    cascade: true,
  })
  onchItems: Type<OnchItemEntity>[];

  @Column({ name: 'consumer_price', type: 'int', nullable: true })
  consumerPrice: number;

  @Column({ name: 'seller_price', type: 'int', nullable: true })
  sellerPrice: number;

  @Column({ name: 'shipping_cost', type: 'int', nullable: true })
  shippingCost: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
