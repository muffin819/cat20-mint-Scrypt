import { Module } from '@nestjs/common';
import { OrderbookService } from './orderbook.service';
import { OrderbookController } from './orderbook.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenOrderEntity } from '../../entities/tokenOrder.entity';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';
import { TxOutEntity } from '../../entities/txOut.entity';
import { RpcModule } from '../../services/rpc/rpc.module';
import { MempoolModule } from '../../services/mempool/mempool.module';
import { TxOutArchiveEntity } from '../../entities/txOutArchive.entity';

@Module({
  imports: [
    TokenModule,
    CommonModule,
    RpcModule,
    MempoolModule,
    TypeOrmModule.forFeature([
      TokenOrderEntity,
      TxOutEntity,
      TxOutArchiveEntity,
    ]),
  ],
  providers: [OrderbookService],
  controllers: [OrderbookController],
})
export class OrderbookModule {}
