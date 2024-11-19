import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/utils';
import { RpcService } from '../rpc/rpc.service';
import { DataSource } from 'typeorm';
import { Transaction } from 'bitcoinjs-lib';
import { CommonService } from '../common/common.service';
import * as Promise from 'bluebird';

@Injectable()
export class MempoolService implements OnModuleInit {
  private readonly logger = new Logger(MempoolService.name);
  public spendsMap: Map<string, string> = new Map();
  public utxosMap: Map<string, any> = new Map();

  constructor(
    private dataSource: DataSource,
    private readonly rpcService: RpcService,
    private readonly configService: ConfigService,
    private readonly commonService: CommonService,
  ) {}

  async onModuleInit() {
    await this.checkRpcConnection();
    this.daemonProcessMempool();
    this.logger.log('Daemon process mempool initialized');
  }

  private async checkRpcConnection() {
    await this.rpcService.getBlockchainInfo(true, true);
    this.logger.log('RPC connection established');
  }

  private async fetchTx(
    txid: string,
    retries = 2,
  ): Promise<Transaction | null> {
    try {
      const tx = await this.rpcService.getRawTransaction(txid);
      return tx;
    } catch (error) {
      if (retries > 0) {
        return this.fetchTx(txid, retries - 1);
      }
      return null;
    }
  }

  private async daemonProcessMempool() {
    while (true) {
      try {
        const txids = await this.rpcService.getRawMempool();
        // Create a set of transactions in the mempool
        const txidSet = new Set(txids);

        // Free up memory
        const beforeUtxos = this.utxosMap.size;
        for (const [outpoint, utxo] of this.utxosMap) {
          const [txid] = this.decodeOutpoint(outpoint);
          if (!txidSet.has(txid)) {
            this.utxosMap.delete(outpoint);
            this.spendsMap.delete(outpoint);
          }
        }

        for (const [outpoint, spentOutpoint] of this.spendsMap) {
          const [txid] = this.decodeOutpoint(spentOutpoint);
          if (!txidSet.has(txid)) {
            this.spendsMap.delete(outpoint);
          }
        }

        const afterUtxos = this.utxosMap.size;

        // Find new transactions
        const newTxids = txids.filter((txid) => {
          const outpoint = this.encodeOutpoint(txid, 0);
          return !this.utxosMap.has(outpoint);
        });

        // Fetch new transactions with progress logging
        const totalNewTxs = newTxids.length;
        let fetchedTxs = 0;
        let lastLoggedPercent = 0;

        const txs = (
          await Promise.map(
            newTxids,
            async (txid) => {
              const tx = await this.fetchTx(txid);
              fetchedTxs++;

              // Calculate progress percentage
              const currentPercent = Math.floor(
                (fetchedTxs / totalNewTxs) * 100,
              );

              // Log progress every percent
              if (currentPercent > lastLoggedPercent && totalNewTxs > 10000) {
                this.logger.log(
                  `syncing ${currentPercent}% (${fetchedTxs}/${totalNewTxs})`,
                );
                lastLoggedPercent = currentPercent;
              }

              return tx;
            },
            {
              concurrency: 10,
            },
          )
        ).filter((tx) => !!tx);

        const spends = this.getSpends(txs);
        const utxos = this.getUtxos(txs);

        spends.forEach((spend) => {
          this.spendsMap.set(spend.outpoint, spend.spentOutpoint);
        });

        utxos.forEach((utxo) => {
          this.utxosMap.set(utxo.outpoint, utxo);
        });

        this.logger.log(
          `Txs: ${txids.length}, Spends: ${this.spendsMap.size}, UTXOs: ${this.utxosMap.size}, Removed: ${beforeUtxos - afterUtxos}`,
        );

        await sleep(2000);
      } catch (error) {
        this.logger.error(`Daemon process mempool error: ${error.message}`);
        await sleep(10000);
      }
    }
  }

  encodeOutpoint(txid: string, vout: number): string {
    return `${txid}:${vout}`;
  }

  decodeOutpoint(outpoint: string): [string, number] {
    const [txid, vout] = outpoint.split(':');
    return [txid, parseInt(vout, 10)];
  }

  private getSpends(
    transactions: Transaction[],
  ): { outpoint: string; spentOutpoint: string }[] {
    const spends: { outpoint: string; spentOutpoint: string }[] = [];
    transactions.forEach((tx) => {
      tx.ins.forEach((input, index) => {
        const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
        const outpoint = this.encodeOutpoint(prevTxid, input.index);
        const spentOutpoint = this.encodeOutpoint(tx.getId(), index);
        spends.push({ outpoint, spentOutpoint });
      });
    });
    return spends;
  }

  private getUtxos(
    transactions: Transaction[],
  ): { outpoint: string; value: number }[] {
    const utxos: { outpoint: string; value: number }[] = [];
    transactions.forEach((tx) => {
      tx.outs.forEach((output, index) => {
        const outpoint = this.encodeOutpoint(tx.getId(), index);
        utxos.push({ outpoint, value: output.value });
      });
    });
    return utxos;
  }
}
