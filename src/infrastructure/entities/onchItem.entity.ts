import { Type } from '@daechanjo/models';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn } from 'typeorm';

import { OnchProductEntity } from './onchProduct.entity';

@Entity({ name: 'onch_item' })
export class OnchItemEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'item_name', type: 'varchar', length: 255, nullable: false })
  itemName: string;

  @Column({ name: 'consumer_price', type: 'int', nullable: true })
  consumerPrice: number;

  @Column({ name: 'seller_price', type: 'int', nullable: true })
  sellerPrice: number;

  @ManyToOne(() => OnchProductEntity, (onchProduct) => onchProduct.onchItems, {
    onDelete: 'CASCADE',
  })
  onchProduct: Type<OnchProductEntity>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
