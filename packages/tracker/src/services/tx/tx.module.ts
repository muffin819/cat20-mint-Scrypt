import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TxEntity } from '../../entities/tx.entity';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { CommonModule } from '../common/common.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RpcModule } from '../rpc/rpc.module';
import { TokenOrderEntity } from '../../entities/tokenOrder.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([TxEntity, TokenInfoEntity, TokenOrderEntity]),
    CommonModule,
    RpcModule,
    ScheduleModule.forRoot(),
  ],
  providers: [TxService],
  exports: [TxService],
})
export class TxModule {}
