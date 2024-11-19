import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { MinterService } from './minter.service';
import { errorResponse, okResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CacheTTL } from '@nestjs/cache-manager';

@Controller('minters')
export class MinterController {
  constructor(private readonly minterService: MinterService) {}

  @Get(':tokenIdOrTokenAddr/utxos')
  @CacheTTL(1000 * 60)
  @ApiTags('minter')
  @ApiOperation({ summary: 'Get minter utxos by token id or token address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'paging offset',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'paging limit',
  })
  async getMinterUtxos(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Query('offset') offset: number,
    @Query('limit') limit: number,
  ) {
    try {
      const utxos = await this.minterService.getMinterUtxos(
        tokenIdOrTokenAddr,
        parseInt(offset.toString()),
        Math.min(parseInt(limit.toString()), 500),
      );
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/utxoCount')
  @ApiTags('minter')
  @ApiOperation({
    summary: 'Get minter utxo count by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getMinterUtxoCount(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
  ) {
    try {
      const utxos =
        await this.minterService.getMinterUtxoCount(tokenIdOrTokenAddr);

      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/mintCount')
  @ApiTags('minter')
  @ApiOperation({
    summary: 'Get minter utxo count by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getMinterMints(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
  ) {
    try {
      const utxos =
        await this.minterService.getMinterMintCount(tokenIdOrTokenAddr);

      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
