import { Controller, Get, Param, Inject } from '@nestjs/common';
import { AddressService } from './address.service';
import { errorResponse, okResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Controller('addresses')
export class AddressController {
  constructor(
    private readonly addressService: AddressService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Get(':ownerAddr/balances')
  @ApiTags('address')
  @ApiOperation({ summary: 'Get token balances by owner address' })
  @ApiParam({
    name: 'ownerAddr',
    required: true,
    type: String,
    description: 'token owner address',
  })
  async getTokenBalances(@Param('ownerAddr') ownerAddr: string) {
    const key = `/addresses/${ownerAddr}/balances`;

    const cachedBalances = await this.cacheManager.get(key);
    if (cachedBalances) {
      return okResponse(cachedBalances);
    }

    try {
      const balances = await this.addressService.getTokenBalances(ownerAddr);
      this.cacheManager.set(key, balances, 1000 * 60 * 5);
      return okResponse(balances);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
