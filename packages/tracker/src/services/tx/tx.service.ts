import { Injectable, Logger } from '@nestjs/common';
import { TxEntity } from '../../entities/tx.entity';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  payments,
  Transaction,
  TxInput,
  TxOutput,
  crypto,
} from 'bitcoinjs-lib';
import { TxOutEntity } from '../../entities/txOut.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Constants } from '../../common/constants';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { CatTxError } from '../../common/exceptions';
import { parseTokenInfo, TaprootPayment } from '../../common/utils';
import { BlockHeader, TokenInfo } from '../../common/types';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
import { getGuardContractInfo } from '@cat-protocol/cat-smartcontracts';
import { LRUCache } from 'lru-cache';
import { CommonService } from '../common/common.service';
import { TxOutArchiveEntity } from 'src/entities/txOutArchive.entity';
import { Cron } from '@nestjs/schedule';
import { TokenOrderEntity, OrderStatus } from 'src/entities/tokenOrder.entity';
import { RpcService } from '../rpc/rpc.service';
import { createTakeSellContract } from 'src/routes/orderbook/orderbook.service';
import { FXPCat20Buy } from '@cat-protocol/cat-smartcontracts';
import { TaprootSmartContract } from '@cat-protocol/cat-smartcontracts/dist/lib/catTx';
import { ContractType } from 'src/routes/orderbook/orderbook.service';
import { hash160 } from 'scrypt-ts';

const OPEN_MINTER_V1_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/openMinter.json');
const OPEN_MINTER_V2_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/openMinterV2.json');
const FXP_OPEN_MINTER_ARTIFACT = require('@cat-protocol/cat-smartcontracts/artifacts/contracts/token/FXPOpenMinter.json');

export enum MinterType {
  OPEN_MINTER_V1 = OPEN_MINTER_V1_ARTIFACT.md5,
  OPEN_MINTER_V2 = OPEN_MINTER_V2_ARTIFACT.md5,
  FXP_OPEN_MINTER = FXP_OPEN_MINTER_ARTIFACT.md5,
  UNKOWN_MINTER = 'unkown_minter',
}

const btc = require('bitcore-lib-inquisition');
const cbor = require('cbor');

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  private readonly GUARD_PUBKEY: string;
  private readonly TRANSFER_GUARD_SCRIPT_HASH: string;

  private static readonly taprootPaymentCache = new LRUCache<
    string,
    { pubkey: Buffer; redeemScript: Buffer }
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly tokenInfoCache = new LRUCache<
    string,
    TokenInfoEntity
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private dataSource: DataSource,
    private commonService: CommonService,
    private readonly rpcService: RpcService,
    @InjectRepository(TokenInfoEntity)
    private tokenInfoEntityRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TokenOrderEntity)
    private tokenOrderEntityRepository: Repository<TokenOrderEntity>,
    @InjectRepository(TxEntity)
    private txEntityRepository: Repository<TxEntity>,
  ) {
    const guardContractInfo = getGuardContractInfo();
    this.GUARD_PUBKEY = guardContractInfo.tpubkey;
    this.TRANSFER_GUARD_SCRIPT_HASH =
      guardContractInfo.contractTaprootMap.transfer.contractScriptHash;
    this.logger.log(`guard xOnlyPubKey = ${this.GUARD_PUBKEY}`);
    this.logger.log(
      `guard transferScriptHash = ${this.TRANSFER_GUARD_SCRIPT_HASH}`,
    );
  }

  /**
   * Process a transaction
   * @param tx transaction to save
   * @param txIndex index of this transaction in the block
   * @param blockHeader header of the block that contains this transaction
   * @returns processing time in milliseconds if successfully processing a CAT-related tx, otherwise undefined
   */
  async processTx(tx: Transaction, txIndex: number, blockHeader: BlockHeader) {
    const startTime = Date.now();
    const timings: { [key: string]: number } = {};

    let buyOrderTxInfo = null;
    if (tx.locktime === 21380) {
      const buyOrderStartTime = Date.now();
      buyOrderTxInfo = await this.searchBuyOrderTxCommitInput(tx);
      timings['searchBuyOrderTxCommitInput'] = Date.now() - buyOrderStartTime;
    }

    if (tx.isCoinbase()) {
      return;
    }
    // filter CAT tx
    if (!this.isCatTx(tx) && !buyOrderTxInfo) {
      return;
    }

    const payOutsStartTime = Date.now();
    const payOuts = tx.outs.map((output) => this.parseTaprootOutput(output));
    timings['parsePayOuts'] = Date.now() - payOutsStartTime;

    // filter tx with Guard outputs
    if (this.searchGuardOutputs(payOuts)) {
      this.logger.log(`[OK] guard builder ${tx.getId()}`);
      return;
    }

    const payInsStartTime = Date.now();
    const payIns = tx.ins.map((input) => this.parseTaprootInput(input));
    timings['parsePayIns'] = Date.now() - payInsStartTime;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const promises: Promise<any>[] = [];
      const guardInputs = this.searchGuardInputs(payIns);

      const updateSpentStartTime = Date.now();
      this.updateSpent(
        queryRunner.manager,
        promises,
        tx,
        blockHeader,
        guardInputs[0],
      );
      timings['updateSpent'] = Date.now() - updateSpentStartTime;

      let stateHashes: Buffer[];

      if (buyOrderTxInfo) {
        const processBuyOrderStartTime = Date.now();
        await this.processBuyOrderTx(
          queryRunner.manager,
          promises,
          tx,
          buyOrderTxInfo,
          blockHeader,
        );
        timings['processBuyOrderTx'] = Date.now() - processBuyOrderStartTime;
      }

      // search Guard inputs
      if (guardInputs.length === 0) {
        const searchMinterStartTime = Date.now();
        const { minterInput, tokenInfo } = await this.searchMinterInput(payIns);
        timings['searchMinterInput'] = Date.now() - searchMinterStartTime;

        try {
          if (!tokenInfo) {
            const processRevealStartTime = Date.now();
            stateHashes = await this.processRevealTx(
              queryRunner.manager,
              promises,
              tx,
              payIns,
              payOuts,
              blockHeader,
            );
            timings['processRevealTx'] = Date.now() - processRevealStartTime;
            this.logger.log(`[OK] reveal tx ${tx.getId()}`);
          } else {
            const processMintStartTime = Date.now();
            stateHashes = await this.processMintTx(
              queryRunner.manager,
              promises,
              tx,
              payOuts,
              minterInput,
              tokenInfo,
              blockHeader,
            );
            timings['processMintTx'] = Date.now() - processMintStartTime;
            this.logger.log(`[OK] mint tx ${tx.getId()}`);
          }
        } catch (e) {
          console.log('SEMI ERROR', tx.getId(), tx, e.message, e.stack);
        }
      } else {
        const processTransferStartTime = Date.now();
        for (const guardInput of guardInputs) {
          stateHashes = await this.processTransferTx(
            queryRunner.manager,
            promises,
            tx,
            guardInput,
            payOuts,
            blockHeader,
          );
        }
        timings['processTransferTx'] = Date.now() - processTransferStartTime;
        this.logger.log(`[OK] transfer tx ${tx.getId()}`);
      }

      const saveTxStartTime = Date.now();
      await Promise.all([
        ...promises,
        stateHashes
          ? this.saveTx(
              queryRunner.manager,
              tx,
              txIndex,
              blockHeader,
              stateHashes,
            )
          : () => {},
      ]);
      timings['saveTxAndPromises'] = Date.now() - saveTxStartTime;

      const commitStartTime = Date.now();
      await queryRunner.commitTransaction();
      timings['commitTransaction'] = Date.now() - commitStartTime;

      const totalTime = Math.ceil(Date.now() - startTime);

      // Filter out 0ms timings and log the rest in a single line
      const significantTimings = Object.entries(timings)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => `${key}: ${value}ms`)
        .join(' | ');

      this.logger.debug(
        `processTx ${tx.getId()} - Total: ${totalTime}ms${significantTimings ? ' | ' + significantTimings : ''}`,
      );

      return totalTime;
    } catch (e) {
      if (e instanceof CatTxError) {
        this.logger.log(`skip tx ${tx.getId()}, ${e.message}`);
      } else {
        this.logger.error(`process tx ${tx.getId()} error, ${e.message}`);
        process.exit();
      }
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Check if this is a CAT tx
   */
  private isCatTx(tx: Transaction) {
    if (tx.outs.length > 0) {
      // OP_RETURN OP_PUSHBYTES_24 'cat' <1 byte version> <20 bytes root_hash>
      return tx.outs[0].script.toString('hex').startsWith('6a1863617401');
    }
    return false;
  }

  private async updateSpent(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    blockHeader: BlockHeader,
    guardInput: TaprootPayment | null,
  ) {
    const isCat = this.isCatTx(tx);
    let isFilled = false;

    tx.ins.forEach((input, i) => {
      const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
      const prevOutputIndex = input.index;

      promises.push(
        manager.update(
          TxOutEntity,
          {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
          {
            spendTxid: tx.getId(),
            spendInputIndex: i,
          },
        ),
      );

      const serviceFeeP2TR =
        '512067fe8e4767ab1a9056b1e7c6166d690e641d3f40e188241f35f803b1f84546c2';
      let status;
      if (tx.outs.length === 3) {
        status = OrderStatus.CANCELED;
      } else if (
        // Buy order filled w/ no change
        tx.outs.length === 6 &&
        Buffer.from(tx.outs[3].script).toString('hex') === serviceFeeP2TR
      ) {
        status = OrderStatus.FILLED;
      } else if (
        // Buy order filled w/ no token change
        tx.outs.length === 5 &&
        Buffer.from(tx.outs[2].script).toString('hex') === serviceFeeP2TR
      ) {
        status = OrderStatus.FILLED;
      } else if (tx.outs.length === 6) {
        status = OrderStatus.PARTIALLY_FILLED;
      }

      if (status === OrderStatus.FILLED) {
        isFilled = true;
      }

      if (isCat && status && guardInput) {
        // Order Spent
        const tokenOutputs = this.parseTokenOutputs(guardInput);
        const tokenOutput = tokenOutputs.get(1);

        if (tokenOutput) {
          promises.push(
            manager.update(
              TokenOrderEntity,
              {
                txid: prevTxid,
                outputIndex: prevOutputIndex,
              },
              {
                spendTxid: tx.getId(),
                spendInputIndex: i,
                spendBlockHeight: blockHeader.height,
                spendCreatedAt: new Date(blockHeader.time * 1000),
                takerPubKey: Buffer.from(tx.outs[tx.outs.length - 1].script)
                  .slice(2)
                  .toString('hex'),
                status,
                fillAmount: tokenOutput.tokenAmount,
              },
            ),
          );
        }
      }

      if (isCat && !guardInput) {
        status = OrderStatus.CANCELED;

        promises.push(
          manager.update(
            TokenOrderEntity,
            {
              txid: prevTxid,
              outputIndex: prevOutputIndex,
            },
            {
              spendTxid: tx.getId(),
              spendInputIndex: i,
              spendBlockHeight: blockHeader.height,
              spendCreatedAt: new Date(blockHeader.time * 1000),
              status,
            },
          ),
        );
      }
    });

    if (isFilled) {
      const index = tx.outs.length === 5 ? 3 : 4;
      // Add guard output to tx_out table
      promises.push(
        manager.save(TxOutEntity, {
          txid: tx.getId(),
          outputIndex: index,
          blockHeight: blockHeader.height,
          satoshis: BigInt(tx.outs[index].value),
          lockingScript: tx.outs[index].script.toString('hex'),
        }),
      );
    }
  }

  private async saveTx(
    manager: EntityManager,
    tx: Transaction,
    txIndex: number,
    blockHeader: BlockHeader,
    stateHashes: Buffer[],
  ) {
    const rootHash = this.parseStateRootHash(tx);
    return manager.save(TxEntity, {
      txid: tx.getId(),
      blockHeight: blockHeader.height,
      txIndex,
      stateHashes: [rootHash, ...stateHashes]
        .map((stateHash) => stateHash.toString('hex'))
        .join(';'),
    });
  }

  /**
   * Search Guard in tx outputs
   * @returns true if found Guard tx outputs, false otherwise
   */
  private searchGuardOutputs(payOuts: TaprootPayment[]): boolean {
    for (const payOut of payOuts) {
      if (this.GUARD_PUBKEY === payOut?.pubkey?.toString('hex')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Search Guard in tx inputs
   * @returns array of Guard inputs
   */
  private searchGuardInputs(payIns: TaprootPayment[]): TaprootPayment[] {
    return payIns.filter((payIn) => {
      return this.GUARD_PUBKEY === payIn?.pubkey?.toString('hex');
    });
  }

  /**
   * Search Guard in tx inputs
   * @returns array of Guard inputs
   */
  private searchBuyInput(payIns: TaprootPayment[]): boolean {
    try {
      if (!payIns.length) {
        return false;
      }

      const payIn = payIns[0];

      if (!payIn) {
        return false;
      }

      if (!payIn.witness.length) {
        return false;
      }

      // Heuristic: buy tx has 55 witness elements
      if (payIn.witness.length !== 55) {
        return false;
      }

      return true;
    } catch (e) {
      console.log('Error in searchBuyInput', e);
      process.exit();
    }
  }

  /**
   * Search minter in tx inputs.
   * If no minter input found, returns { minterInput: null, tokenInfo: null }
   *
   * If there is more than one minter input, throw an error.
   */
  private async searchMinterInput(payIns: TaprootPayment[]): Promise<{
    minterInput: TaprootPayment | null;
    tokenInfo: TokenInfoEntity | null;
  }> {
    let minter = {
      minterInput: null,
      tokenInfo: null,
    };
    for (const payIn of payIns) {
      const xOnlyPubKey = payIn?.pubkey?.toString('hex');
      if (xOnlyPubKey) {
        const tokenInfo = await this.getTokenInfo(xOnlyPubKey);
        if (tokenInfo) {
          if (minter.tokenInfo) {
            throw new CatTxError(
              'invalid mint tx, multiple minter inputs found',
            );
          }
          minter = {
            minterInput: payIn,
            tokenInfo,
          };
        }
      }
    }
    return minter;
  }

  private async getTokenInfo(minterPubKey: string) {
    let tokenInfo = TxService.tokenInfoCache.get(minterPubKey);
    if (!tokenInfo) {
      tokenInfo = await this.tokenInfoEntityRepository.findOne({
        where: { minterPubKey },
      });
      if (tokenInfo && tokenInfo.tokenPubKey) {
        const lastProcessedHeight =
          await this.commonService.getLastProcessedBlockHeight();
        if (
          lastProcessedHeight !== null &&
          lastProcessedHeight - tokenInfo.revealHeight >=
            Constants.TOKEN_INFO_CACHE_BLOCKS_THRESHOLD
        ) {
          TxService.tokenInfoCache.set(minterPubKey, tokenInfo);
        }
      }
    }
    return tokenInfo;
  }

  private async processRevealTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    payIns: TaprootPayment[],
    payOuts: TaprootPayment[],
    blockHeader: BlockHeader,
  ) {
    // commit input
    const { inputIndex: commitInputIndex, tokenInfo } =
      this.searchRevealTxCommitInput(payIns);
    const commitInput = payIns[commitInputIndex];
    const genesisTxid = Buffer.from(tx.ins[commitInputIndex].hash)
      .reverse()
      .toString('hex');
    const tokenId = `${genesisTxid}_${tx.ins[commitInputIndex].index}`;
    // state hashes
    const stateHashes = commitInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);
    // minter output
    const minterPubKey = this.searchRevealTxMinterOutputs(payOuts);
    // save token info
    promises.push(
      manager.save(TokenInfoEntity, {
        tokenId,
        revealTxid: tx.getId(),
        revealHeight: blockHeader.height,
        genesisTxid,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        rawInfo: tokenInfo,
        minterPubKey,
      }),
    );
    // save tx outputs
    promises.push(
      manager.save(
        TxOutEntity,
        tx.outs
          .map((_, i) =>
            payOuts[i]?.pubkey
              ? this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts)
              : null,
          )
          .filter((out) => out !== null),
      ),
    );
    return stateHashes;
  }

  private async processBuyOrderTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    buyOrderTxInfo: {
      atIndex: number;
      contract: TaprootSmartContract;
      args: any[];
    },
    blockHeader: BlockHeader,
  ) {
    const prevTxid = Buffer.from(tx.ins[buyOrderTxInfo.atIndex].hash)
      .reverse()
      .toString('hex');
    const prevIndex = 1;
    const commitTx = await this.rpcService.getRawTransaction(prevTxid);

    const script = Buffer.from(commitTx.outs[prevIndex].script).toString('hex');
    const sats = commitTx.outs[prevIndex].value;

    if (buyOrderTxInfo.contract.lockingScriptHex !== script) {
      return null;
    }

    const entity: TokenOrderEntity = {
      txid: prevTxid,
      outputIndex: prevIndex,
      tokenPubKey: buyOrderTxInfo.args[0].slice(4),
      tokenTxid: null,
      tokenOutputIndex: null,
      tokenAmount: BigInt(sats) / buyOrderTxInfo.args[2],
      ownerPubKey: tx.outs[tx.outs.length - 1].script.slice(2).toString('hex'),
      price: buyOrderTxInfo.args[2],
      spendTxid: null,
      spendInputIndex: null,
      blockHeight: blockHeader.height,
      createdAt: new Date(blockHeader.time * 1000),
      spendBlockHeight: null,
      spendCreatedAt: null,
      takerPubKey: null,
      status: OrderStatus.OPEN,
      fillAmount: null,
      genesisTxid: null,
      genesisOutputIndex: null,
      // @ts-ignore
      md5: ContractType.FXPCAT20_BUY,
    };
    promises.push(manager.save(TokenOrderEntity, entity));
  }

  private async searchBuyOrderTxCommitInput(tx: Transaction) {
    try {
      const lockingScript = tx.ins[0].witness[0].toString('hex');
      const script = new btc.Script(lockingScript);
      const chunks = script.toASM().split(' ');

      if (chunks[3] !== '6f72646572') {
        return null;
      }

      const decoded = cbor.decodeAllSync(chunks[5])[0];
      const { args, md5 } = decoded;

      if (md5 !== ContractType.FXPCAT20_BUY) {
        return null;
      }

      const contract = TaprootSmartContract.create(
        new FXPCat20Buy(args[0], args[1], args[2], false),
      );

      const info = {
        atIndex: 0,
        contract,
        args,
      };

      return info;
    } catch (e) {
      console.log(e);
    }
  }

  /**
   * There is one and only one commit in the reveal tx inputs.
   * The commit input must contain a valid token info.
   * The token info must contain name, symbol, and decimals.
   *
   * If there are multiple commit inputs, throw an error.
   * If there is no commit input, throw an error.
   */
  private searchRevealTxCommitInput(payIn: TaprootPayment[]): {
    inputIndex: number;
    tokenInfo: TokenInfo;
  } {
    let commit = null;
    for (let i = 0; i < payIn.length; i++) {
      if (
        payIn[i] &&
        payIn[i].witness.length >= Constants.COMMIT_INPUT_WITNESS_MIN_SIZE
      ) {
        try {
          // parse token info from commit redeem script
          const tokenInfo = parseTokenInfo(payIn[i].redeemScript);
          if (tokenInfo) {
            // token info is valid here
            if (commit) {
              throw new CatTxError(
                'invalid reveal tx, multiple commit inputs found',
              );
            }
            commit = {
              inputIndex: i,
              tokenInfo,
            };
          }
        } catch (e) {
          this.logger.error(`search commit in reveal tx error, ${e.message}`);
        }
      }
    }
    if (!commit) {
      throw new CatTxError('invalid reveal tx, missing commit input');
    }
    return commit;
  }

  /**
   * There is one and only one type of minter in the reveal tx outputs.
   * There are no other outputs except OP_RETURN and minter.
   *
   * If there is no minter output, throw an error.
   * If the x-only pubkey of other outputs differ from the first minter, throw an error.
   *
   * @returns minter output x-only pubkey
   */
  private searchRevealTxMinterOutputs(payOuts: TaprootPayment[]): string {
    if (payOuts.length < 2) {
      throw new CatTxError('invalid reveal tx, missing minter output');
    }
    const minterPubKey = payOuts[1]?.pubkey?.toString('hex');
    if (!minterPubKey) {
      throw new CatTxError('invalid reveal tx, missing minter output');
    }
    for (let i = 2; i < payOuts.length; i++) {
      const outputPubKey = payOuts[i]?.pubkey?.toString('hex');
      if (!outputPubKey || outputPubKey !== minterPubKey) {
        throw new CatTxError('invalid reveal tx, output other than minter');
      }
    }
    return minterPubKey;
  }

  private async processMintTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    payOuts: TaprootPayment[],
    minterInput: TaprootPayment,
    tokenInfo: TokenInfoEntity,
    blockHeader: BlockHeader,
  ) {
    if (minterInput.witness.length < Constants.MINTER_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid mint tx, invalid minter witness field');
    }

    const stateHashes = minterInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);

    // ownerPubKeyHash
    if (
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_ADDR_OFFSET].length !==
      Constants.PUBKEY_HASH_BYTES
    ) {
      throw new CatTxError(
        'invalid mint tx, invalid byte length of owner pubkey hash',
      );
    }
    const ownerPubKeyHash =
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_ADDR_OFFSET].toString(
        'hex',
      );
    // tokenAmount
    if (
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET].length >
      Constants.TOKEN_AMOUNT_MAX_BYTES
    ) {
      throw new CatTxError(
        'invalid mint tx, invalid byte length of token amount',
      );
    }
    const tokenAmount = BigInt(
      minterInput.witness[
        Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET
      ].readIntLE(
        0,
        minterInput.witness[Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET]
          .length,
      ),
    );

    if (tokenAmount <= 0n) {
      throw new CatTxError('invalid mint tx, token amount should be positive');
    }
    // token output
    const { tokenPubKey, outputIndex: tokenOutputIndex } =
      this.searchMintTxTokenOutput(payOuts, tokenInfo);

    if (tokenInfo.tokenPubKey === null) {
      // update token info when first mint
      promises.push(
        manager.update(
          TokenInfoEntity,
          {
            tokenId: tokenInfo.tokenId,
          },
          {
            tokenPubKey,
            firstMintHeight: blockHeader.height,
          },
        ),
      );
    }

    // save token mint
    promises.push(
      manager.save(TokenMintEntity, {
        txid: tx.getId(),
        tokenPubKey,
        ownerPubKeyHash,
        tokenAmount:
          // @ts-ignore
          tokenInfo.rawInfo.minterMd5 === MinterType.FXP_OPEN_MINTER
            ? tokenAmount * 2n
            : tokenAmount,
        blockHeight: blockHeader.height,
      }),
    );

    // save tx outputs
    promises.push(
      manager.save(
        TxOutEntity,
        tx.outs
          .map((_, i) => {
            const isXPTokenOutput =
              i === tokenOutputIndex + 1 &&
              // @ts-ignore
              tokenInfo.rawInfo.minterMd5 === MinterType.FXP_OPEN_MINTER;
            const isOut = i <= tokenOutputIndex || isXPTokenOutput;

            if (isOut && payOuts[i]?.pubkey) {
              const baseEntity = this.buildBaseTxOutEntity(
                tx,
                i,
                blockHeader,
                payOuts,
              );

              if (isXPTokenOutput) {
                return {
                  ...baseEntity,
                  ownerPubKeyHash: hash160(
                    minterInput.witness[41].toString('hex'),
                  ),
                  tokenAmount,
                };
              }

              return i === tokenOutputIndex
                ? {
                    ...baseEntity,
                    ownerPubKeyHash,
                    tokenAmount,
                  }
                : baseEntity;
            }
            return null;
          })
          .filter((out) => out !== null),
      ),
    );
    return stateHashes;
  }

  /**
   * There is one and only one token in outputs.
   * The token output must be the first output right after minter.
   *
   * If there is no token output, throw an error.
   * If there are multiple token outputs, throw an error.
   * If the minter outputs are not consecutive, throw an error.
   * If the token output pubkey differs from what it minted before, throw an error.
   */
  private searchMintTxTokenOutput(
    payOuts: TaprootPayment[],
    tokenInfo: TokenInfoEntity,
  ) {
    let tokenOutput = {
      tokenPubKey: '',
      outputIndex: -1,
    };
    for (let i = 1; i < payOuts.length; i++) {
      const outputPubKey = payOuts[i]?.pubkey?.toString('hex');
      if (tokenOutput.tokenPubKey) {
        // token output found, this output cannot be a minter or a token output
        //
        if (!outputPubKey) {
          // good if cannot parse x-only pubkey from this output
          continue;
        }
        if (outputPubKey === tokenInfo.minterPubKey) {
          // invalid if get a minter output again after the token output was found
          throw new CatTxError(
            'invalid mint tx, minter outputs are not consecutive',
          );
        }

        const isOpenMinterV1 =
          // @ts-ignore
          tokenInfo.rawInfo.minterMd5 === MinterType.OPEN_MINTER_V1;
        const isOpenMinterV2 =
          // @ts-ignore
          tokenInfo.rawInfo.minterMd5 === MinterType.OPEN_MINTER_V2;

        if (
          outputPubKey === tokenOutput.tokenPubKey &&
          (isOpenMinterV1 || isOpenMinterV2)
        ) {
          // invalid if get a token output again after the token output was found
          throw new CatTxError('invalid mint tx, multiple token outputs found');
        }
      } else {
        // token output not found yet, this output can only be a minter or a token output
        //
        if (!outputPubKey) {
          // invalid if cannot parse x-only pubkey from this output
          throw new CatTxError('invalid mint tx, invalid output structure');
        }
        if (outputPubKey === tokenInfo.minterPubKey) {
          // good if get a minter output
          continue;
        }
        // potential token output here
        //
        if (
          tokenInfo.tokenPubKey !== null &&
          tokenInfo.tokenPubKey !== outputPubKey
        ) {
          // invalid if get a token output that is different from the previously minted token pubkey
          throw new CatTxError(
            'invalid mint tx, invalid token output with a different pubkey',
          );
        }
        // valid token output here
        tokenOutput = {
          tokenPubKey: outputPubKey,
          outputIndex: i,
        };
      }
    }
    if (!tokenOutput.tokenPubKey) {
      throw new CatTxError('invalid mint tx, missing token output');
    }
    return tokenOutput;
  }

  private async processTransferTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    guardInput: TaprootPayment,
    payOuts: TaprootPayment[],
    blockHeader: BlockHeader,
  ) {
    if (guardInput.witness.length < Constants.GUARD_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid transfer tx, invalid guard witness field');
    }
    const stateHashes = guardInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);

    const scriptHash = crypto
      .hash160(guardInput?.redeemScript || Buffer.alloc(0))
      .toString('hex');
    if (scriptHash === this.TRANSFER_GUARD_SCRIPT_HASH) {
      const tokenOutputs = this.parseTokenOutputs(guardInput);

      const tokens = [...tokenOutputs.keys()].map((i) => {
        return {
          ...this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts),
          ownerPubKeyHash: tokenOutputs.get(i).ownerPubKeyHash,
          tokenAmount: tokenOutputs.get(i).tokenAmount,
        };
      });

      promises.push(manager.save(TxOutEntity, tokens));

      if (tx.locktime >= 2138 && tx.locktime <= 2138 + 1000) {
        const guardIndex = tx.ins.findIndex((e, i) => {
          return (
            e?.witness?.[41]?.toString('hex') ===
            '512052f5ec24681512889f765a3313b746a0e92b01df3f4e48404236906a1ff462fe'
          );
        });
        const prevTxid = Buffer.from(tx.ins[guardIndex].hash)
          .reverse()
          .toString('hex');
        const commitTx = await this.rpcService.getRawTransaction(prevTxid);
        const price = commitTx.locktime;

        const ownerLockingScript = Buffer.from(
          tx.outs[tx.outs.length - 1].script,
        ).toString('hex');
        const ownerPubkey = ownerLockingScript.slice(4);

        const sellContract = await createTakeSellContract(
          tokens[0].lockingScript,
          ownerLockingScript,
          BigInt(price),
        );

        const entities = [];
        if (
          sellContract.lockingScriptHex ===
          Buffer.from(commitTx.outs[2].script).toString('hex')
        ) {
          const entity: TokenOrderEntity = {
            txid: prevTxid,
            outputIndex: 2,
            tokenPubKey: tokens[0].lockingScript.slice(4),
            tokenTxid: tokens[0].txid,
            tokenOutputIndex: 1,
            tokenAmount: tokens[0].tokenAmount,
            ownerPubKey: ownerPubkey,
            price: BigInt(price),
            spendTxid: null,
            spendInputIndex: null,
            blockHeight: blockHeader.height,
            createdAt: new Date(blockHeader.time * 1000),
            spendBlockHeight: null,
            spendCreatedAt: null,
            takerPubKey: null,
            status: OrderStatus.OPEN,
            fillAmount: null,
            genesisTxid: null,
            genesisOutputIndex: null,
            // @ts-ignore
            md5: ContractType.FXPCAT20_SELL,
          };
          entities.push(entity);
        }
        promises.push(manager.save(TokenOrderEntity, entities));
      }
    }

    return stateHashes;
  }

  /**
   * Parse token outputs from guard input of a transfer tx
   */
  private parseTokenOutputs(guardInput: TaprootPayment) {
    const ownerPubKeyHashes = guardInput.witness.slice(
      Constants.TRANSFER_GUARD_ADDR_OFFSET,
      Constants.TRANSFER_GUARD_ADDR_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const tokenAmounts = guardInput.witness.slice(
      Constants.TRANSFER_GUARD_AMOUNT_OFFSET,
      Constants.TRANSFER_GUARD_AMOUNT_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const masks = guardInput.witness.slice(
      Constants.TRANSFER_GUARD_MASK_OFFSET,
      Constants.TRANSFER_GUARD_MASK_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const tokenOutputs = new Map<
      number,
      {
        ownerPubKeyHash: string;
        tokenAmount: bigint;
      }
    >();
    for (let i = 0; i < Constants.CONTRACT_OUTPUT_MAX_COUNT; i++) {
      if (masks[i].toString('hex') !== '') {
        const ownerPubKeyHash = ownerPubKeyHashes[i].toString('hex');
        const tokenAmount = BigInt(
          tokenAmounts[i].readIntLE(0, tokenAmounts[i].length),
        );
        tokenOutputs.set(i + 1, {
          ownerPubKeyHash,
          tokenAmount,
        });
      }
    }
    return tokenOutputs;
  }

  /**
   * Parse state root hash from tx
   */
  private parseStateRootHash(tx: Transaction) {
    return tx.outs[0].script.subarray(
      Constants.STATE_ROOT_HASH_OFFSET,
      Constants.STATE_ROOT_HASH_OFFSET + Constants.STATE_ROOT_HASH_BYTES,
    );
  }

  private validateStateHashes(stateHashes: Buffer[]) {
    for (const stateHash of stateHashes) {
      if (
        stateHash.length !== 0 &&
        stateHash.length !== Constants.STATE_HASH_BYTES
      ) {
        throw new CatTxError('invalid state hash length');
      }
    }
  }

  /**
   * Parse taproot input from tx input, returns null if failed
   */
  private parseTaprootInput(input: TxInput): TaprootPayment | null {
    try {
      const key = crypto
        .hash160(
          Buffer.concat([
            crypto.hash160(input.witness[input.witness.length - 2]), // redeem script
            crypto.hash160(input.witness[input.witness.length - 1]), // cblock
          ]),
        )
        .toString('hex');
      let cached = TxService.taprootPaymentCache.get(key);
      if (!cached) {
        const taproot = payments.p2tr({ witness: input.witness });
        cached = {
          pubkey: taproot?.pubkey,
          redeemScript: taproot?.redeem?.output,
        };
        TxService.taprootPaymentCache.set(key, cached);
      }
      return Object.assign({}, cached, { witness: input.witness });
    } catch {
      return null;
    }
  }

  /**
   * Parse taproot output from tx output, returns null if failed
   */
  private parseTaprootOutput(output: TxOutput): TaprootPayment | null {
    try {
      if (
        output.script.length !== Constants.TAPROOT_LOCKING_SCRIPT_LENGTH ||
        !output.script.toString('hex').startsWith('5120')
      ) {
        return null;
      }
      return {
        pubkey: output.script.subarray(2, 34),
        redeemScript: null,
        witness: null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete tx in blocks with height greater than or equal to the given height
   */
  public async deleteTx(manager: EntityManager, height: number) {
    // txs to delete
    const txs = await this.txEntityRepository.find({
      select: ['txid'],
      where: { blockHeight: MoreThanOrEqual(height) },
    });
    const promises = [
      manager.delete(TokenInfoEntity, {
        revealHeight: MoreThanOrEqual(height),
      }),
      manager.update(
        TokenInfoEntity,
        { firstMintHeight: MoreThanOrEqual(height) },
        { firstMintHeight: null, tokenPubKey: null },
      ),
      manager.delete(TokenMintEntity, {
        blockHeight: MoreThanOrEqual(height),
      }),
      manager.delete(TxEntity, { blockHeight: MoreThanOrEqual(height) }),
      manager.delete(TxOutEntity, { blockHeight: MoreThanOrEqual(height) }),
      // reset spent status of tx outputs
      ...txs.map((tx) => {
        return manager.update(
          TxOutEntity,
          { spendTxid: tx.txid },
          { spendTxid: null, spendInputIndex: null },
        );
      }),
    ];
    if (txs.length > 0) {
      // Empty criteria(s) are not allowed for the delete method
      promises.push(
        manager.delete(
          TokenInfoEntity,
          txs.map((tx) => {
            return { genesisTxid: tx.txid };
          }),
        ),
      );
    }
    return Promise.all(promises);
  }

  private buildBaseTxOutEntity(
    tx: Transaction,
    outputIndex: number,
    blockHeader: BlockHeader,
    payOuts: TaprootPayment[],
  ) {
    return {
      txid: tx.getId(),
      outputIndex,
      blockHeight: blockHeader.height,
      satoshis: BigInt(tx.outs[outputIndex].value),
      lockingScript: tx.outs[outputIndex].script.toString('hex'),
      xOnlyPubKey: payOuts[outputIndex].pubkey.toString('hex'),
    };
  }

  @Cron('* * * * *')
  private async archiveTxOuts() {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    if (lastProcessedHeight === null) {
      return;
    }
    const txOuts = await this.dataSource.manager
      .createQueryBuilder('tx_out', 'txOut')
      .innerJoin('tx', 'tx', 'txOut.spend_txid = tx.txid')
      .where('txOut.spend_txid IS NOT NULL')
      .andWhere('tx.block_height < :blockHeight', {
        blockHeight: lastProcessedHeight - 3 * 2880, // blocks before three days ago
      })
      .orderBy('tx.block_height', 'ASC')
      .addOrderBy('tx.tx_index', 'ASC')
      .limit(1000) // archive no more than 1000 records once a time
      .getMany();
    if (txOuts.length === 0) {
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      await Promise.all([
        manager.save(TxOutArchiveEntity, txOuts),
        manager.delete(
          TxOutEntity,
          txOuts.map((txOut) => {
            return { txid: txOut.txid, outputIndex: txOut.outputIndex };
          }),
        ),
      ]);
    });
    this.logger.log(`archived ${txOuts.length} tx outputs`);
  }
}
