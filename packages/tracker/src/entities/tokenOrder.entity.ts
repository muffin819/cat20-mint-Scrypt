import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export enum OrderStatus {
  OPEN = 'open',
  FILLED = 'filled',
  PARTIALLY_FILLED = 'partially_filled',
  PARTIALLY_OPEN = 'partially_open',
  CANCELED = 'canceled',
}

@Entity('token_order')
@Index(['spendTxid', 'spendInputIndex'], { unique: true })
@Index(['tokenTxid', 'tokenOutputIndex'], { unique: true })
@Index(['tokenPubKey', 'ownerPubKey'])
export class TokenOrderEntity {
  @PrimaryColumn({ length: 64 })
  txid: string;

  @PrimaryColumn({ name: 'output_index' })
  outputIndex: number;

  @Column({ name: 'token_pubkey', length: 64 })
  tokenPubKey: string;

  @Column({ name: 'token_txid', length: 64, nullable: true })
  tokenTxid: string;

  @Column({ name: 'token_output_index', nullable: true })
  tokenOutputIndex: number;

  @Column({ name: 'token_amount', type: 'bigint', nullable: true })
  tokenAmount: bigint;

  @Column({ name: 'genesis_txid', length: 64, nullable: true })
  genesisTxid: string;

  @Column({ name: 'genesis_output_index', nullable: true })
  genesisOutputIndex: number;

  @Column({ name: 'owner_pubkey', length: 64 })
  ownerPubKey: string;

  @Column({ name: 'price', type: 'bigint' })
  price: bigint;

  @Column({ name: 'block_height' })
  @Index()
  blockHeight: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'spend_txid', nullable: true })
  spendTxid: string;

  @Column({ name: 'spend_input_index', nullable: true })
  spendInputIndex: number;

  @Column({ name: 'spend_block_height', nullable: true })
  spendBlockHeight: number;

  @Column({ name: 'spend_created_at', nullable: true })
  spendCreatedAt: Date;

  @Column({ name: 'taker_pubkey', nullable: true, length: 64 })
  takerPubKey: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.OPEN,
  })
  status: OrderStatus;

  @Column({ name: 'fill_amount', type: 'bigint', nullable: true })
  fillAmount: bigint;

  @Column({ name: 'md5', nullable: true })
  md5: string;
}
