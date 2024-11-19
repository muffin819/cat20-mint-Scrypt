import { Controller, Get, UseInterceptors, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { errorResponse, okResponse } from '../../common/utils';
import { CommonService } from '../../services/common/common.service';
import { CacheTTL } from '@nestjs/cache-manager';

@Controller()
export class HealthCheckController {
  constructor(private readonly commonService: CommonService) {}

  @Get()
  @CacheTTL(5000)
  @ApiTags('info')
  @ApiOperation({ summary: 'Check the health of the service' })
  async checkHealth() {
    try {
      const blockchainInfo = await this.commonService.getBlockchainInfo();
      const res = {
        trackerBlockHeight:
          await this.commonService.getLastProcessedBlockHeight(),
        nodeBlockHeight: blockchainInfo?.blocks || null,
        latestBlockHeight: blockchainInfo?.headers || null,
      };
      return okResponse(res);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
