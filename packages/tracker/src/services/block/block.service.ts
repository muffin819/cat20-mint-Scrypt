import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/utils';
import { RpcService } from '../rpc/rpc.service';
import { BlockEntity } from '../../entities/block.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Block } from 'bitcoinjs-lib';
import { TxService } from '../tx/tx.service';
import { BlockHeader } from '../../common/types';
import { Constants } from '../../common/constants';
import { CommonService } from '../common/common.service';
import {
  TokenOrderEntity,
  OrderStatus,
} from '../../entities/tokenOrder.entity';
import { ContractType } from '../../routes/orderbook/orderbook.service';
import { FXPCat20Sell } from '@cat-protocol/cat-smartcontracts';

const fxpCat20Sell = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/FXPCat20Sell.json');
FXPCat20Sell.loadArtifact(fxpCat20Sell);

@Injectable()
export class BlockService implements OnModuleInit {
  private readonly logger = new Logger(BlockService.name);

  private readonly genesisBlockHeight: number;

  constructor(
    private dataSource: DataSource,
    private readonly rpcService: RpcService,
    private readonly txService: TxService,
    private readonly configService: ConfigService,
    private readonly commonService: CommonService,
    @InjectRepository(BlockEntity)
    private blockEntityRepository: Repository<BlockEntity>,
  ) {
    this.genesisBlockHeight = this.configService.get('genesisBlockHeight');
  }

  async onModuleInit() {
    await this.checkRpcConnection();
    await this.checkDatabaseConnection();

    await this.processForceReindex();

    this.daemonProcessBlocks();
    this.logger.log('daemon process blocks initialized');
  }

  /**
   * process reindex from a block height
   */
  private async processForceReindex() {
    if (process.env.REINDEX_BLOCK_HEIGHT !== undefined) {
      const reindexHeight = Math.max(
        parseInt(process.env.REINDEX_BLOCK_HEIGHT),
        this.genesisBlockHeight,
      );

      const lastProcessedBlock =
        await this.commonService.getLastProcessedBlock();
      const chunkSize = 100;
      let currentHeight = lastProcessedBlock?.height || 0;

      while (true) {
        currentHeight -= chunkSize;
        currentHeight = Math.max(currentHeight, reindexHeight);
        console.log(
          `deleting ${chunkSize} blocks from ${currentHeight} to ${currentHeight + chunkSize}`,
        );
        await this.deleteBlocks(currentHeight);

        if (currentHeight <= reindexHeight) {
          break;
        }
      }
    }
  }

  private async checkRpcConnection() {
    await this.rpcService.getBlockchainInfo(true, true);
    this.logger.log('rpc connection established');
  }

  private async checkDatabaseConnection() {
    try {
      await this.blockEntityRepository.count();
      this.logger.log('database connection established');
    } catch (e) {
      this.logger.error(`database not ready, ${e.message}`);
      throw new Error('database not ready, run `yarn migration:run` first');
    }
  }

  /**
   * delete blocks with height greater than or equal to the given height
   * @param height the start block height to be deleted
   */
  private async deleteBlocks(height: number) {
    await this.dataSource.manager.transaction(async (manager) => {
      await Promise.all([
        // delete blocks with height greater than or equal to the given height
        manager.delete(BlockEntity, {
          height: MoreThanOrEqual(height),
        }),
        // delete related tx in database
        this.txService.deleteTx(manager, height),
      ]);
    });
  }

  private async daemonProcessBlocks() {
    while (true) {
      try {
        await this.processBlocks();
      } catch (e) {
        this.logger.error(`daemon process blocks error, ${e.message}`);
      }
    }
  }

  private async processBlocks() {
    // query last processed block in database
    const lastProcessedBlock = await this.commonService.getLastProcessedBlock();
    // the potential next height to be processed is the height of last processed block plus one
    // or the genesis block height if this is the first time run
    const nextHeight = lastProcessedBlock
      ? lastProcessedBlock.height + 1
      : this.genesisBlockHeight;
    // get block hash by height to check the existence of the next block
    // if cannot get a result, then there is no new block to process
    const nextHash = await this.getBlockHash(nextHeight);
    if (!nextHash) {
      await sleep(Constants.BLOCK_PROCESSING_INTERVAL);
      return;
    }
    //                       lastProcessedBlock
    //                          v
    // database: [ ] -- [ ] -- [ ]
    //                           \ -- [ ]
    //                                 ^
    //                              nextHash
    //                             nextHeader
    //
    //                       lastProcessedBlock
    //                          v
    // database: [ ] -- [ ] -- [ ]
    //            \
    //             \ -- [ ] -- [ ] -- [ ]
    //                   ^             ^
    //               nextHeader     nextHash
    const nextHeader = await this.processReorg(nextHash);
    await this.processBlock(nextHeader);
  }

  /**
   * process reorg if needed, and return the header of the right next block to process
   * @param nextHash block hash of potential next block
   */
  private async processReorg(nextHash: string): Promise<BlockHeader> {
    let nextHeader: BlockHeader;
    let hash = nextHash;
    // backtrack blocks from a block hash until
    //   the corresponding block record appears in the database,
    //   or the genesis block is reached.
    while (true) {
      nextHeader = await this.getBlockHeader(hash);
      if (nextHeader.height === this.genesisBlockHeight) {
        break;
      }
      const existed = await this.blockEntityRepository.exists({
        where: { hash: nextHeader.previousblockhash },
      });
      if (existed) {
        break;
      }
      hash = nextHeader.previousblockhash;
    }
    if (nextHeader.hash !== nextHash) {
      // found reorg
      this.logger.log(
        `found reorg, common ancestor #${nextHeader.height - 1} ${nextHeader.previousblockhash}`,
      );
      await this.deleteBlocks(nextHeader.height);
    }
    return nextHeader;
  }

  private async processBlock(blockHeader: BlockHeader) {
    const rawBlock = await this.getRawBlock(blockHeader.hash);
    const block = Block.fromHex(rawBlock);
    if (block.transactions.length === 0) {
      throw new Error('no txs in block');
    }
    const startTs = Date.now();
    // process all the block txs one by one in order
    let catTxsCount = 0;
    let catProcessingTime = 0;
    for (let i = 0; i < block.transactions.length; i++) {
      const ms = await this.txService.processTx(
        block.transactions[i],
        i,
        blockHeader,
      );
      if (ms !== undefined) {
        catTxsCount += 1;
        catProcessingTime += ms;
      }
    }
    // save block
    await this.blockEntityRepository.save({
      ...blockHeader,
      previousHash: blockHeader.previousblockhash,
    });

    let _percentage = '';
    const latestBlockHeight = (await this.commonService.getBlockchainInfo())
      ?.headers;
    if (latestBlockHeight && latestBlockHeight !== 0) {
      _percentage = `[${(
        (blockHeader.height / latestBlockHeight) *
        100
      ).toFixed(2)}%] `.padStart(10, ' ');
    }

    try {
      await this.processPartiallyFilledOrders(blockHeader);
    } catch (e) {
      this.logger.error(`process partially filled orders error, ${e.message}`);
    }

    const processingTime = Math.ceil(Date.now() - startTs);
    const tps = Math.ceil((block.transactions.length / processingTime) * 1000);
    const catTps = Math.ceil((catTxsCount / catProcessingTime) * 1000);

    const _txsCount = `${block.transactions.length} txs`.padStart(8, ' ');
    const _time = `${processingTime} ms`.padStart(8, ' ');
    const _tps = `${tps} tps`.padStart(8, ' ');
    const _catTxsCount = `${catTxsCount} txs`.padStart(8, ' ');
    const _catTime = `${catProcessingTime} ms`.padStart(8, ' ');
    const _catTps = `${catTps} tps`.padStart(8, ' ');
    this.logger.log(
      `${_percentage}processed block #${blockHeader.height} ${blockHeader.hash}, ${_txsCount} ${_time} ${_tps}, ${_catTxsCount} ${_catTime} ${_catTps}`,
    );
  }

  private async getBlockHash(height: number): Promise<string | undefined> {
    const resp = await this.rpcService.getBlockHash(height);
    return resp?.data?.result;
  }

  private async getBlockHeader(blockHash: string): Promise<BlockHeader> {
    const resp = await this.rpcService.getBlockHeader(blockHash);
    return resp.data.result;
  }

  private async getRawBlock(blockHash: string): Promise<string> {
    const resp = await this.rpcService.getBlock(blockHash);
    return resp.data.result;
  }

  async processPartiallyFilledOrders(blockHeader: BlockHeader) {
    let sql = `
      with open_orders as (
        select
        *
      from
        token_order
      )
      select
        too.*
      from
        token_order too left join
        open_orders oo on oo.txid = too.spend_txid and oo.txid != too.txid
      where
        too.status = 'partially_filled' and
        oo.txid is null;

    `;

    const tokens = await this.blockEntityRepository.query(sql); // Optimize the query by using subqueries with indexes

    const entities: TokenOrderEntity[] = [];
    for (const token of tokens) {
      const isBuy = token.md5 === ContractType.FXPCAT20_BUY;
      const outputIndex = isBuy ? 3 : 2;
      const entity: TokenOrderEntity = {
        txid: token.spend_txid,
        outputIndex,
        tokenPubKey: token.token_pubkey,
        tokenTxid: isBuy ? null : token.txid,
        tokenOutputIndex: isBuy ? null : outputIndex,
        ownerPubKey: token.owner_pubkey,
        price: token.price,
        spendTxid: null,
        spendInputIndex: null,
        blockHeight: blockHeader.height,
        createdAt: new Date(blockHeader.time * 1000),
        spendBlockHeight: null,
        spendCreatedAt: null,
        takerPubKey: null,
        status: OrderStatus.PARTIALLY_OPEN,
        fillAmount: null,
        genesisTxid: token.genesis_txid || token.txid,
        genesisOutputIndex: token.genesis_output_index || token.output_index,
        md5: token.md5,
        tokenAmount: BigInt(token.token_amount) - BigInt(token.fill_amount),
      };
      console.log(entity, token);
      entities.push(entity);
    }

    await this.dataSource.manager.transaction(async (manager) => {
      await manager.save(TokenOrderEntity, entities);
    });
  }
}
