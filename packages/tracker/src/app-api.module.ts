import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheInterceptor } from '@nestjs/cache-manager';

// config
import { appConfig } from './config/app.config';
import { ormConfig } from './config/db.config';
// routes
import { HealthCheckModule } from './routes/healthCheck/healthCheck.module';
import { TokenModule } from './routes/token/token.module';
import { MinterModule } from './routes/minter/minter.module';
import { AddressModule } from './routes/address/address.module';
import { OrderbookModule } from './routes/orderbook/orderbook.module';
// serivces
import { CommonModule } from './services/common/common.module';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggerMiddleware } from './middleware/logger.middleware';
import { MempoolModule } from './services/mempool/mempool.module';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
      envFilePath: ['config/.env', '.env'],
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : 10000,
    }),
    TypeOrmModule.forRoot(ormConfig),

    HealthCheckModule,
    TokenModule,
    MinterModule,
    AddressModule,
    OrderbookModule,
    MempoolModule,
    CommonModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
  ],
})
export class AppApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
