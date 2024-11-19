import { Controller, Get, Param, Query } from '@nestjs/common';
import { OrderbookService } from './orderbook.service';
import { errorResponse, okResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

@Controller('orderbook')
export class OrderbookController {
  constructor(private readonly orderbookService: OrderbookService) {}

  @Get(':tokenIdOrTokenAddr/utxos')
  @ApiTags('orderbook')
  @ApiOperation({ summary: 'Get orderbook utxos by token id or token address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getOrderbookUtxos(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
  ) {
    try {
      const limit = 10000;
      const offset = 0;
      const utxos = await this.orderbookService.getOrderbookUtxos(
        tokenIdOrTokenAddr,
        offset,
        limit,
      );
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/history')
  @ApiTags('orderbook')
  @ApiOperation({ summary: 'Get orderbook utxos by token id or token address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getOrderbookHistory(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
  ) {
    // const key = `/orderbook/${tokenIdOrTokenAddr}/utxos/${limit}/${Math.random()}`;

    // const cachedUtxos = await this.cacheManager.get(key);
    // if (cachedUtxos) {
    //   return okResponse(cachedUtxos);
    // }

    try {
      const limit = 10000;
      const offset = 0;
      const utxos = await this.orderbookService.getOrderbookHistory(
        tokenIdOrTokenAddr,
        offset,
        limit,
      );
      // this.cacheManager.set(key, utxos, 60 * 1000);
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/address/:address')
  @ApiTags('orderbook')
  @ApiOperation({ summary: 'Get orderbook utxos by token id or token address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiParam({
    name: 'address',
    required: true,
    type: String,
    description: 'address',
  })
  async getOrderbookUtxosForAddress(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Param('address') address: string,
  ) {
    try {
      const utxos = await this.orderbookService.getOrderbookUtxosByAddress(
        tokenIdOrTokenAddr,
        address,
      );
      // this.cacheManager.set(key, utxos, 60 * 1000);
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get('/token/:txid/:outputIndex')
  @ApiTags('orderbook')
  @ApiOperation({ summary: 'Get orderbook utxos by token id or token address' })
  @ApiParam({
    name: 'txid',
    required: true,
    type: String,
    description: 'txid',
  })
  @ApiParam({
    name: 'outputIndex',
    required: true,
    type: Number,
    description: 'output index',
  })
  async getTokenUtxo(
    @Param('txid') txid: string,
    @Param('outputIndex') outputIndex: number,
  ) {
    try {
      const res = await this.orderbookService.renderUtxo(txid, outputIndex);
      return okResponse(res);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/address/:address/history')
  @ApiTags('orderbook')
  @ApiOperation({
    summary: 'Get orderbook utxos history by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiParam({
    name: 'address',
    required: true,
    type: String,
    description: 'address',
  })
  async getOrderbookUtxosForAddressHistory(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Param('address') address: string,
  ) {
    try {
      const utxos =
        await this.orderbookService.getOrderbookUtxosByAddressHistory(
          tokenIdOrTokenAddr,
          address,
        );

      // this.cacheManager.set(key, utxos, 60 * 1000);
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get('address/:address/fxp-claim-count')
  @ApiTags('orderbook')
  @ApiOperation({
    summary: 'Get fxp claims for address',
  })
  @ApiParam({
    name: 'address',
    required: true,
    type: String,
    description: 'address',
  })
  async countFxpClaimsForAddress(@Param('address') address: string) {
    try {
      const utxos =
        await this.orderbookService.countFxpClaimsForAddress(address);
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get('address/:address/fxp-claim')
  @ApiTags('orderbook')
  @ApiOperation({
    summary: 'Get a fxp claim for address',
  })
  @ApiParam({
    name: 'address',
    required: true,
    type: String,
    description: 'address',
  })
  async getFxpClaimsForAddress(@Param('address') address: string) {
    try {
      const utxos = await this.orderbookService.getFxpClaimForAddress(address);
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/chart')
  @ApiTags('orderbook')
  @ApiOperation({ summary: 'Get chart data for token' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiQuery({
    name: 'timeframe',
    required: false,
    type: String,
    description: 'Timeframe for chart data (e.g., "1h", "1d", "1w")',
  })
  async getChartData(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Query('timeframe') timeframe: string = '1h',
  ) {
    try {
      const chartData = await this.orderbookService.getChartData(
        tokenIdOrTokenAddr,
        timeframe,
      );
      return okResponse(chartData);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
