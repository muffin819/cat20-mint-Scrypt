import { Module } from '@nestjs/common';
import { MempoolService } from './mempool.service';
import { RpcModule } from '../rpc/rpc.module';
import { ConfigModule } from '@nestjs/config';
import { TxModule } from '../tx/tx.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [RpcModule, ConfigModule, CommonModule],
  providers: [MempoolService],
  exports: [MempoolService],
})
export class MempoolModule {}
