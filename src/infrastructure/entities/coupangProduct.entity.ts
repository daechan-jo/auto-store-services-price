import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'coupang_product' })
export class CoupangProductEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'seller_product_id', type: 'varchar', length: 255, nullable: true })
  sellerProductId: string;

  @Column({ name: 'seller_product_name', type: 'varchar', length: 255, nullable: true })
  sellerProductName: string;

  @Column({ name: 'product_code', type: 'varchar', length: 255, nullable: true })
  productCode: string;

  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner: boolean;

  @Column({ type: 'int', nullable: true })
  price: number;

  @Column({ name: 'shipping_cost', type: 'int', nullable: true })
  shippingCost: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
