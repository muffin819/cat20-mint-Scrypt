import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { InjectRepository } from '@nestjs/typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { IsNull, LessThanOrEqual, Repository, In, Not } from 'typeorm';
import { Constants } from '../../common/constants';
import { CommonService } from '../../services/common/common.service';
import {
  TokenOrderEntity,
  OrderStatus,
} from '../../entities/tokenOrder.entity';
import { TxOutArchiveEntity } from '../../entities/txOutArchive.entity';
import { RpcService } from '../../services/rpc/rpc.service';
import { TaprootSmartContract } from '@cat-protocol/cat-smartcontracts/dist/lib/catTx';
import { FXPCat20Sell } from '@cat-protocol/cat-smartcontracts';
import { hash160 } from 'scrypt-ts';
import { addressToXOnlyPubKey } from '../../common/utils';
import { MempoolService } from '../../services/mempool/mempool.service';

const FXP_CAT20_BUY_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/FXPCat20Buy.json');
const FXP_CAT20_SELL_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/FXPCat20Sell.json');
const CAT20_SELL_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/cat20Sell.json');
const CAT20_BUY_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/buyCAT20.json');

const btc = require('bitcore-lib-inquisition');

export enum ContractType {
  FXPCAT20_SELL = FXP_CAT20_SELL_ARTIFACT.md5,
  FXPCAT20_BUY = FXP_CAT20_BUY_ARTIFACT.md5,
  CAT20_SELL = CAT20_SELL_ARTIFACT.md5,
  CAT20_BUY = CAT20_BUY_ARTIFACT.md5,
}

export async function createTakeSellContract(
  token_script: string,
  seller_locking_script: string,
  price: bigint,
) {
  const script = btc.Script.fromHex(seller_locking_script);

  const sellContract = TaprootSmartContract.create(
    new FXPCat20Sell(
      token_script,
      seller_locking_script,
      hash160(script.getPublicKeyHash()),
      price,
      false,
    ),
  );

  return sellContract;
}

@Injectable()
export class OrderbookService {
  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
    private readonly rpcService: RpcService,
    @InjectRepository(TokenOrderEntity)
    private readonly tokenOrderRepository: Repository<TokenOrderEntity>,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
    @InjectRepository(TxOutArchiveEntity)
    private readonly txOutArchiveRepository: Repository<TxOutArchiveEntity>,
    private readonly mempoolService: MempoolService,
  ) {}

  async getOrderbookUtxos(
    tokenIdOrTokenAddr: string,
    offset: number,
    limit: number,
  ) {
    const utxos = await this.queryOrderbookUtxos(
      tokenIdOrTokenAddr,
      false,
      offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
      Math.min(
        limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
        Constants.QUERY_PAGING_MAX_LIMIT,
      ),
    );

    return {
      utxos: utxos.utxos,
      trackerBlockHeight: utxos.trackerBlockHeight,
    };
  }

  async getOrderbookHistory(
    tokenIdOrTokenAddr: string,
    offset: number,
    limit: number,
  ) {
    const utxos = await this.queryOrderbookUtxos(
      tokenIdOrTokenAddr,
      false,
      offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
      Math.min(
        limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
        Constants.QUERY_PAGING_MAX_LIMIT,
      ),
      {
        spendTxid: Not(IsNull()),
        status: In([OrderStatus.FILLED, OrderStatus.PARTIALLY_FILLED]),
      },
      {
        spendCreatedAt: 'DESC',
      },
    );

    return {
      utxos: utxos.utxos,
      trackerBlockHeight: utxos.trackerBlockHeight,
    };
  }

  async countFxpClaimsForAddress(address: string) {
    const ownerPubKey = addressToXOnlyPubKey(address);

    const count = await this.tokenOrderRepository.query(`
      select
        count(*)
      from
        token_order join
        tx_out on tx_out.txid = token_order.spend_txid and tx_out.output_index = 4
      where
        (owner_pubkey = '${ownerPubKey}') and
        token_order.spend_txid is not null and
        status = 'filled' and
        md5 in ('${ContractType.FXPCAT20_SELL}', '${ContractType.FXPCAT20_BUY}') and
        tx_out.spend_txid is null
    `);

    return {
      count: parseInt(count[0].count, 10),
    };
  }

  async getFxpClaimForAddress(address: string) {
    const ownerPubKey = addressToXOnlyPubKey(address);

    let utxos = await this.tokenOrderRepository.query(`
      select
        token_order.spend_txid as "spendTxid",
        token_order.owner_pubkey as "ownerPubKey",
        token_order.taker_pubkey as "takerPubKey",
        token_order.md5 as "md5"
     from
        token_order join
        tx_out on tx_out.txid = token_order.spend_txid and tx_out.output_index = 4
      where
        (owner_pubkey = '${ownerPubKey}') and
        token_order.spend_txid is not null and
        status = 'filled' and
        md5 in ('${ContractType.FXPCAT20_SELL}', '${ContractType.FXPCAT20_BUY}') and
        tx_out.spend_txid is null
    `);

    utxos = utxos.filter((utxo) => {
      const outpoint = this.mempoolService.encodeOutpoint(utxo.spendTxid, 4);
      const isContractSpent = this.mempoolService.spendsMap.has(outpoint);
      console.log(outpoint, this.mempoolService.spendsMap.has(outpoint));
      return !isContractSpent;
    });

    return {
      utxos,
    };
  }

  async getOrderbookUtxoCount(tokenIdOrTokenAddr: string) {
    return this.queryOrderbookUtxos(tokenIdOrTokenAddr, true);
  }

  async getOrderbookUtxosByAddress(
    tokenIdOrTokenAddr: string,
    address: string,
  ) {
    const ownerPubKey = addressToXOnlyPubKey(address);
    return this.queryOrderbookUtxos(tokenIdOrTokenAddr, false, 0, 1000, {
      ownerPubKey,
    });
  }

  async getOrderbookUtxosByAddressHistory(
    tokenIdOrTokenAddr: string,
    address: string,
  ) {
    const ownerPubKey = addressToXOnlyPubKey(address);
    return this.queryOrderbookUtxos(
      tokenIdOrTokenAddr,
      false,
      0,
      1000,
      [
        {
          ownerPubKey,
          spendTxid: Not(IsNull()),
          status: In([OrderStatus.FILLED, OrderStatus.PARTIALLY_FILLED]),
        },
        {
          takerPubKey: ownerPubKey,
          spendTxid: Not(IsNull()),
        },
      ],
      {
        spendCreatedAt: 'DESC',
      },
    );
  }

  async queryOrderbookUtxos(
    tokenIdOrTokenAddr: string,
    isCountQuery: boolean = false,
    offset: number = null,
    limit: number = null,
    extraWhere: any = {},
    extraOrder: any = {},
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();

    const tokenInfo =
      await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
        tokenIdOrTokenAddr,
      );

    let count = 0;
    let utxos: TokenOrderEntity[] = [];
    if (lastProcessedHeight !== null && tokenInfo?.minterPubKey) {
      const where = Array.isArray(extraWhere)
        ? extraWhere.map((e) => ({
            tokenPubKey: tokenInfo.tokenPubKey,
            spendTxid: IsNull(),
            blockHeight: LessThanOrEqual(lastProcessedHeight),
            ...e,
          }))
        : {
            tokenPubKey: tokenInfo.tokenPubKey,
            spendTxid: IsNull(),
            blockHeight: LessThanOrEqual(lastProcessedHeight),
            ...extraWhere,
          };
      if (isCountQuery) {
        count = await this.tokenOrderRepository.count({
          where,
        });
      } else {
        utxos = await this.tokenOrderRepository.find({
          where,
          order: extraOrder || { createdAt: 'ASC' },
          skip: offset,
          take: limit,
        });
      }
    }

    utxos = utxos.filter((utxo) => {
      const outpoint = this.mempoolService.encodeOutpoint(
        utxo.txid,
        utxo.outputIndex,
      );

      const tokenOutpoint = this.mempoolService.encodeOutpoint(
        utxo.tokenTxid,
        utxo.tokenOutputIndex,
      );

      const isTokenSpent = this.mempoolService.spendsMap.has(tokenOutpoint);
      const isContractSpent = this.mempoolService.spendsMap.has(outpoint);

      return !isContractSpent && !isTokenSpent;
    });

    return Object.assign({}, isCountQuery ? { count } : { utxos }, {
      trackerBlockHeight: lastProcessedHeight,
    });
  }

  async getChartData(tokenIdOrTokenAddr: string, timeframe: string = '12h') {
    const history = await this.queryOrderbookUtxos(
      tokenIdOrTokenAddr,
      false,
      0,
      100000,
      {
        spendTxid: Not(IsNull()),
        status: In([OrderStatus.FILLED, OrderStatus.PARTIALLY_FILLED]),
      },
      {
        spendCreatedAt: 'ASC',
      },
    );
    const utxos = history.utxos;

    const timeframeInSeconds = this.getTimeframeInSeconds(timeframe);

    const tradeBuckets = new Map();

    // Get the current timestamp and round it down to the nearest timeframe
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const latestBucketTimestamp =
      currentTimestamp - (currentTimestamp % timeframeInSeconds);

    // Group trades by time bucket
    for (const utxo of utxos) {
      const utxoTimestamp = Math.floor(utxo.spendCreatedAt.getTime() / 1000);
      const bucketTimestamp =
        utxoTimestamp - (utxoTimestamp % timeframeInSeconds);

      if (!tradeBuckets.has(bucketTimestamp)) {
        tradeBuckets.set(bucketTimestamp, []);
      }
      tradeBuckets.get(bucketTimestamp).push(Number(utxo.price));
    }

    // Generate OHLC data for each bucket, including empty ones up to the current time
    const chartData = [];
    let lastPrice = null;
    for (
      let timestamp = Math.min(...tradeBuckets.keys());
      timestamp <= latestBucketTimestamp;
      timestamp += timeframeInSeconds
    ) {
      const prices = tradeBuckets.get(timestamp) || [];
      if (prices.length > 0) {
        const candle = {
          open: lastPrice,
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          time: timestamp,
          trades: prices.length,
        };
        chartData.push(candle);
        lastPrice = candle.close;
      } else if (lastPrice !== null) {
        // For empty buckets, use the last known price
        chartData.push({
          open: lastPrice,
          high: lastPrice,
          low: lastPrice,
          close: lastPrice,
          time: timestamp,
          trades: 0,
        });
      }
    }

    return chartData;
  }

  private getTimeframeInSeconds(timeframe: string): number {
    const unit = timeframe.match(/[a-zA-Z]+$/)?.[0] || '';
    const value = parseInt(timeframe.replace(/[a-zA-Z]+$/, ''));

    if (isNaN(value)) {
      console.warn(`Invalid timeframe value: ${timeframe}`);
      return 43200; // Default to 12 hours (43200 seconds) if invalid timeframe is provided
    }

    switch (unit) {
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      case 'w':
        return value * 604800;
      default:
        console.warn(`Invalid timeframe unit: ${unit}`);
        return 43200; // Default to 12 hours (43200 seconds) if invalid timeframe is provided
    }
  }

  async renderUtxo(txid: string, outputIndex: number) {
    let utxo = await this.txOutRepository.findOne({
      where: {
        txid,
        outputIndex,
      },
    });

    if (!utxo) {
      // @ts-ignore
      utxo = await this.txOutArchiveRepository.findOne({
        where: {
          txid,
          outputIndex,
        },
      });
    }

    const res = await this.tokenService.renderUtxos([utxo]);
    return res[0];
  }
}
