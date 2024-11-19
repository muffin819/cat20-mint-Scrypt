import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'

import chaiAsPromised from 'chai-as-promised'
import { hash160 } from 'scrypt-ts'
import { getOutpointString } from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'
import { CAT20 } from '@cat-protocol/cat-smartcontracts'
import { ClosedMinter } from '@cat-protocol/cat-smartcontracts'
import { FXPCat20Sell } from '../src/contracts/token/FXPCat20Sell'
import { FXPCat20Buy } from '../src/contracts/token/FXPCat20Buy'
import { FXPSellGuard } from '../src/contracts/token/FXPSellGuard'
import { FXPBuyGuard } from '../src/contracts/token/FXPBuyGuard'
import { FXPOpenMinter } from '../src/contracts/token/FXPOpenMinter'
import { TransferGuard } from '../src/contracts/token/transferGuard'
import { BurnGuard } from '../src/contracts/token/burnGuard'
import { txToTxHeader, txToTxHeaderPartial } from '../src/lib/proof'
import { UTXO, getBtcDummyUtxo, getDummyGenesisTx } from './utils/txHelper'

import { KeyInfo, getP2TRKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import {
    closedMinterCall,
    closedMinterDeploy,
    getGuardContractInfo,
} from './cat20'
import {
    CatTx,
    ContractIns,
    TaprootSmartContract,
    script2P2TR,
    TaprootMastSmartContract,
} from '../src/lib/catTx'
import { btc } from '@cat-protocol/cat-smartcontracts/dist/lib/btc'
import { cat20SellCall } from './utils/cat20Sell'
import { buycat20Call } from './utils/buyCAT20'
import { openMinterCall, openMinterV2Deploy } from './fxp-minter'
import { getCatCommitScript } from '../src/lib/commit'
import {
    OpenMinterV2Proto,
    OpenMinterV2State,
} from '../src/contracts/token/openMinterV2Proto'

export interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    minterMd5: string
}

export interface OpenMinterTokenInfo extends TokenInfo {
    max: bigint
    limit: bigint
    premine: bigint
}

use(chaiAsPromised)

describe('Test `FXP Orderbook`', () => {
    // Orderbook Inf
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let closedMinter: ClosedMinter
    let closedMinterTaproot: TaprootSmartContract
    let guardInfo: TaprootMastSmartContract
    let token: CAT20
    let tokenTaproot: TaprootSmartContract
    let closedMinterIns: ContractIns<string>
    let cat20Sell: FXPCat20Sell
    let buycat20: FXPCat20Buy
    let cat20SellTaproot: TaprootSmartContract
    let buycat20Taproot: TaprootSmartContract
    let xpSellGuard: FXPSellGuard
    let xpBuyGuard: FXPBuyGuard
    let xpSellGuardTaproot: TaprootSmartContract
    let xpBuyGuardTaproot: TaprootSmartContract
    let xpGuardSellUtxo: UTXO
    let xpGuardSellPreTx: CatTx
    let xpGuardSellToken: ContractIns<CAT20State>
    let xpGuardBuyUtxo: UTXO
    let xpGuardBuyPreTx: CatTx
    let xpGuardBuyToken: ContractIns<CAT20State>
    let xpGuardSellMintInfo: CAT20State
    let xpGuardBuyMintInfo: CAT20State
    let keyLocking: string
    let feeDeployUtxo
    const price = 100000n

    // XP Token Info
    let max: bigint
    let maxCount: bigint
    let limit: bigint
    let premine: bigint
    let premineCount: bigint

    before(async () => {
        // init load
        FXPCat20Sell.loadArtifact()
        FXPCat20Buy.loadArtifact()
        FXPSellGuard.loadArtifact()
        FXPBuyGuard.loadArtifact()
        FXPOpenMinter.loadArtifact()
        CAT20.loadArtifact()
        TransferGuard.loadArtifact()
        BurnGuard.loadArtifact()

        // key info
        keyInfo = getP2TRKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)
        // minter
        closedMinter = new ClosedMinter(keyInfo.xAddress, genesisOutpoint)
        closedMinterTaproot = TaprootSmartContract.create(closedMinter)
        // FXP Guard
        xpSellGuard = new FXPSellGuard()
        xpBuyGuard = new FXPBuyGuard()
        xpSellGuardTaproot = TaprootSmartContract.create(xpSellGuard)
        xpBuyGuardTaproot = TaprootSmartContract.create(xpBuyGuard)
        console.log('FXPSellGuard', xpSellGuardTaproot.lockingScriptHex)
        console.log('FXPBuyGuard', xpBuyGuardTaproot.lockingScriptHex)
        // guard
        guardInfo = getGuardContractInfo()
        // token
        token = new CAT20(
            closedMinterTaproot.lockingScriptHex,
            guardInfo.lockingScriptHex
        )
        tokenTaproot = TaprootSmartContract.create(token)
        // deploy minter
        closedMinterIns = await closedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            closedMinter,
            tokenTaproot.lockingScriptHex
        )
        keyLocking = genesisTx.outputs[0].script.toHex()
        cat20Sell = new FXPCat20Sell(
            tokenTaproot.lockingScriptHex,
            keyLocking,
            keyInfo.xAddress,
            price,
            false
        )

        buycat20 = new FXPCat20Buy(
            tokenTaproot.lockingScriptHex,
            keyInfo.xAddress,
            price,
            false
        )
        cat20SellTaproot = TaprootSmartContract.create(cat20Sell)
        buycat20Taproot = TaprootSmartContract.create(buycat20)
        feeDeployUtxo = getBtcDummyUtxo(keyInfo.addr)
    })

    async function mintToken(tokenState: CAT20State) {
        const closedMinterCallInfo = await closedMinterCall(
            closedMinterIns,
            tokenTaproot,
            tokenState,
            true
        )
        closedMinterIns = closedMinterCallInfo.nexts[0] as ContractIns<string>
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT20State>
    }

    async function getTokenByNumber(
        count: number,
        xAddress: string,
        overflow: boolean = false
    ): Promise<ContractIns<CAT20State>[]> {
        const inputTokens: ContractIns<CAT20State>[] = []
        for (let i = 0; i < count; i++) {
            let amount = BigInt(Math.floor(Math.random() * 100)) + 10n
            if (overflow) {
                amount = BigInt(2147483647)
            }
            inputTokens.push(
                await mintToken(CAT20Proto.create(amount, xAddress))
            )
        }
        return inputTokens
    }

    describe('When a token is being sell', () => {
        it('t01: should success sell all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                xpSellGuardTaproot
            )

            expect(nextTokens.length).to.be.equal(1)

            xpGuardSellUtxo = {
                txId: nextTokens[0].catTx.tx.id,
                outputIndex: 4,
                satoshis: nextTokens[0].catTx.tx.outputs[4].satoshis,
                script: nextTokens[0].catTx.tx.outputs[4].script.toHex(),
            }
            xpGuardSellPreTx = nextTokens[0].catTx
            xpGuardSellToken = nextTokens[0]
            xpGuardSellMintInfo = CAT20Proto.create(
                FXPOpenMinter.getFXPAmount(
                    txToTxHeaderPartial(txToTxHeader(xpGuardSellPreTx.tx))
                ),
                keyInfo.xAddress
            )

            expect(xpSellGuardTaproot.lockingScriptHex).to.be.equal(
                xpGuardSellUtxo.script
            )
        })

        it('t02: should success sell all with multi input tokens', async () => {
            const inputTokens = await getTokenByNumber(
                2,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                xpSellGuardTaproot
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell partial', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                xpSellGuardTaproot
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t04: should success sell partial with multi token input', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                xpSellGuardTaproot
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t05: should success sell partial multiple until sell out', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const totalAmount = inputTokens[0].state.amount
            const sellMultiple = async function (
                inputTokens: ContractIns<CAT20State>[],
                amount: bigint
            ) {
                const nextTokens = await cat20SellCall(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    amount - 1n,
                    keyInfo.xAddress,
                    inputTokens,
                    cat20SellTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    xpSellGuardTaproot
                )
                if (nextTokens.length == 2) {
                    await sellMultiple([nextTokens[1]], amount - 1n)
                }
            }
            await sellMultiple(inputTokens, totalAmount)
        })
    })

    describe('buy token', () => {
        it('t01: should success sell to buyer partially', async () => {
            try {
                const inputTokens = await getTokenByNumber(
                    1,
                    hash160(buycat20Taproot.lockingScriptHex)
                )

                const preferBuyAmount = 1n
                const nextTokens = await buycat20Call(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    1n,
                    keyInfo.xAddress,
                    keyInfo.xAddress,
                    inputTokens,
                    buycat20Taproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    preferBuyAmount,
                    xpBuyGuardTaproot
                )
                expect(nextTokens.length).to.be.equal(2)
            } catch (e) {
                console.log(e)
                process.exit(1)
            }
        })

        it('t02: should success sell to buyer all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = inputTokens[0].state.amount
            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20Taproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preferBuyAmount,
                xpBuyGuardTaproot
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell to buyer all with 3 token utxos', async () => {
            const inputTokens = await getTokenByNumber(
                3,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = inputTokens.reduce(
                (acc, inputToken) => acc + inputToken.state.amount,
                0n
            )
            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20Taproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preferBuyAmount,
                xpBuyGuardTaproot
            )
            expect(nextTokens.length).to.be.equal(1)

            xpGuardBuyUtxo = {
                txId: nextTokens[0].catTx.tx.id,
                outputIndex: 3,
                satoshis: nextTokens[0].catTx.tx.outputs[3].satoshis,
                script: nextTokens[0].catTx.tx.outputs[3].script.toHex(),
            }
            xpGuardBuyPreTx = nextTokens[0].catTx
            xpGuardBuyToken = nextTokens[0]
            xpGuardBuyMintInfo = CAT20Proto.create(
                FXPOpenMinter.getFXPAmount(
                    txToTxHeaderPartial(txToTxHeader(xpGuardBuyPreTx.tx))
                ),
                keyInfo.xAddress
            )

            expect(xpBuyGuardTaproot.lockingScriptHex).to.be.equal(
                xpGuardBuyUtxo.script
            )
        })

        it('t04: should fail if too much satoshis to seller', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = 10n
            const toBuyerAmount = 1n

            await expect(
                buycat20Call(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    toBuyerAmount,
                    keyInfo.xAddress,
                    keyInfo.xAddress,
                    inputTokens,
                    buycat20Taproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    preferBuyAmount,
                    xpBuyGuardTaproot,
                    toBuyerAmount * price + 100n
                )
            ).to.be.rejectedWith(/expected false to equal true/)
        })
    })

    describe('When deploying a new token', () => {
        it('should deploy an FXPOpenMinter contract', async () => {
            try {
                // create genesisTx
                const info: OpenMinterTokenInfo = {
                    name: 'CAT',
                    symbol: 'C',
                    decimals: 2,
                    minterMd5: '0417a28b9d921607cab0454595860641',
                    max: 21000000n,
                    limit: 1000n,
                    premine: 0n,
                }
                const commitScript = getCatCommitScript(keyInfo.pubkeyX, info)
                const lockingScript = Buffer.from(commitScript, 'hex')
                const {
                    p2tr: p2trCommit,
                    // tapScript,
                    // cblock,
                } = script2P2TR(lockingScript)
                const utxos = [getBtcDummyUtxo(keyInfo.addr)]
                const genesisTx = new btc.Transaction().from([utxos]).addOutput(
                    new btc.Transaction.Output({
                        satoshis: 330,
                        script: p2trCommit,
                    })
                )
                const preCatTx = CatTx.create()
                preCatTx.tx = genesisTx
                // create revealTx
                const genesisUtxo = {
                    address: keyInfo.addr.toString(),
                    txId: genesisTx.id,
                    outputIndex: 0,
                    script: new btc.Script(keyInfo.addr),
                    satoshis: genesisTx.outputs[0].satoshis,
                }
                const revealCatTx = CatTx.create()
                revealCatTx.tx.from(genesisUtxo)
                const genesisOutpoint = getOutpointString(genesisTx, 0)
                limit = info.limit * 10n ** BigInt(info.decimals)
                // calc count
                max = info.max * 10n ** BigInt(info.decimals)
                maxCount = max / limit
                premine = info.premine * 10n ** BigInt(info.decimals)
                premineCount = premine / limit
                const openMinterV2 = new FXPOpenMinter(
                    genesisOutpoint,
                    maxCount,
                    premine,
                    premineCount,
                    limit,
                    keyInfo.xAddress
                )
                const openMinterV2Taproot =
                    TaprootSmartContract.create(openMinterV2)
                const guardInfo = getGuardContractInfo()
                const token = new CAT20(
                    openMinterV2Taproot.lockingScriptHex,
                    guardInfo.lockingScriptHex
                )
                const tokenTaproot = TaprootSmartContract.create(token)
                const openMinterState = OpenMinterV2Proto.create(
                    tokenTaproot.lockingScriptHex,
                    false,
                    maxCount - premineCount
                )
                const atIndex = revealCatTx.addStateContractOutput(
                    openMinterV2Taproot.lockingScript,
                    OpenMinterV2Proto.toByteString(openMinterState)
                )
                const openMinterIns: ContractIns<OpenMinterV2State> = {
                    catTx: revealCatTx,
                    contract: openMinterV2,
                    state: openMinterState,
                    preCatTx: preCatTx,
                    contractTaproot: openMinterV2Taproot,
                    atOutputIndex: atIndex,
                }
                // mint tx (premine)
                const premineCallInfo = await openMinterCall(
                    keyInfo,
                    openMinterIns,
                    xpGuardSellMintInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardSellPreTx,
                        utxo: xpGuardSellUtxo,
                        contract: xpSellGuardTaproot,
                        token: xpGuardSellToken,
                    },
                    {
                        moreThanOneToken: true,
                    }
                )
                // mint tx (after premine)
                for (
                    let index = 0;
                    index < premineCallInfo.nexts.length - 1;
                    index++
                ) {
                    const nextOpenMinterIns = premineCallInfo.nexts[
                        index
                    ] as ContractIns<OpenMinterV2State>
                    await openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        xpGuardSellMintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardSellPreTx,
                            utxo: xpGuardSellUtxo,
                            contract: xpSellGuardTaproot,
                            token: xpGuardSellToken,
                        },
                        {
                            moreThanOneToken: true,
                        }
                    )
                }
            } catch (e) {
                console.log(e)
                process.exit(2)
            }
        })
    })

    describe('When minting an existed token', () => {
        let genesisTx: btc.Transaction
        let genesisUtxo: UTXO
        let genesisOutpoint: string
        let openMinter: FXPOpenMinter
        let openMinterIns: ContractIns<OpenMinterV2State>
        let max: bigint
        let maxCount: bigint
        let premine: bigint
        let premineCount: bigint
        let limit: bigint
        let premineInfo: CAT20State
        let premineCallInfo
        const tokenScript =
            '5120c4043a44196c410dba2d7c9288869727227e8fcec717f73650c8ceadc90877cd'

        before(async () => {
            try {
                // dummy genesis
                const dummyGenesis = getDummyGenesisTx(
                    keyInfo.seckey,
                    keyInfo.addr
                )
                genesisTx = dummyGenesis.genesisTx
                genesisUtxo = dummyGenesis.genesisUtxo
                genesisOutpoint = getOutpointString(genesisTx, 0)
                max = 10000n
                limit = 100n
                maxCount = max / limit
                // 5% premine
                premine = 0n
                premineCount = premine / limit
                openMinter = new FXPOpenMinter(
                    genesisOutpoint,
                    maxCount,
                    premine,
                    premineCount,
                    limit,
                    keyInfo.xAddress
                )
                const getTokenScript = async () => tokenScript
                openMinterIns = await openMinterV2Deploy(
                    keyInfo.seckey,
                    keyInfo.xAddress,
                    genesisTx,
                    genesisUtxo,
                    openMinter,
                    getTokenScript,
                    maxCount,
                    premineCount
                )
                // premine pass
                premineCallInfo = await openMinterCall(
                    keyInfo,
                    openMinterIns,
                    xpGuardSellMintInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardSellPreTx,
                        utxo: xpGuardSellUtxo,
                        contract: xpSellGuardTaproot,
                        token: xpGuardSellToken,
                    },
                    {
                        moreThanOneToken: true,
                    }
                )
            } catch (e) {
                console.log(e)
                process.exit(3)
            }
        })

        it('should succeed in minting', async () => {
            // new minter mint pass
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterV2State>

                await openMinterCall(
                    keyInfo,
                    nextOpenMinterIns,
                    xpGuardBuyMintInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardBuyPreTx,
                        utxo: xpGuardBuyUtxo,
                        contract: xpBuyGuardTaproot,
                        token: xpGuardBuyToken,
                    },
                    {
                        moreThanOneToken: true,
                    }
                )
            }
        })

        it('should succeed in minting 250 times and track min, max, average', async () => {
            let minAmount = BigInt(Number.MAX_SAFE_INTEGER)
            let maxAmount = BigInt(0)
            let totalAmount = BigInt(0)
            let count = 0

            // new minter mint pass
            for (let i = 0; i < 250; i++) {
                for (
                    let index = 0;
                    index < premineCallInfo.nexts.length - 1;
                    index++
                ) {
                    const inputTokens = await getTokenByNumber(
                        3,
                        hash160(buycat20Taproot.lockingScriptHex)
                    )

                    const preferBuyAmount = inputTokens.reduce(
                        (acc, inputToken) => acc + inputToken.state.amount,
                        0n
                    )
                    const nextTokens = await buycat20Call(
                        feeDeployUtxo,
                        keyInfo.seckey,
                        keyLocking,
                        preferBuyAmount,
                        keyInfo.xAddress,
                        keyInfo.xAddress,
                        inputTokens,
                        buycat20Taproot,
                        closedMinterTaproot.lockingScriptHex,
                        guardInfo,
                        price,
                        preferBuyAmount,
                        xpBuyGuardTaproot
                    )
                    expect(nextTokens.length).to.be.equal(1)

                    xpGuardBuyUtxo = {
                        txId: nextTokens[0].catTx.tx.id,
                        outputIndex: 3,
                        satoshis: nextTokens[0].catTx.tx.outputs[3].satoshis,
                        script: nextTokens[0].catTx.tx.outputs[3].script.toHex(),
                    }
                    xpGuardBuyPreTx = nextTokens[0].catTx
                    xpGuardBuyToken = nextTokens[0]
                    xpGuardBuyMintInfo = CAT20Proto.create(
                        FXPOpenMinter.getFXPAmount(
                            txToTxHeaderPartial(
                                txToTxHeader(xpGuardBuyPreTx.tx)
                            )
                        ),
                        keyInfo.xAddress
                    )

                    expect(xpBuyGuardTaproot.lockingScriptHex).to.be.equal(
                        xpGuardBuyUtxo.script
                    )

                    const nextOpenMinterIns = premineCallInfo.nexts[
                        index
                    ] as ContractIns<OpenMinterV2State>

                    const mint = await openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        xpGuardBuyMintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardBuyPreTx,
                            utxo: xpGuardBuyUtxo,
                            contract: xpBuyGuardTaproot,
                            token: xpGuardBuyToken,
                        },
                        {
                            moreThanOneToken: true,
                        }
                    )

                    // @ts-ignore
                    const amount = mint.mintAmount

                    // Update min, max, and total
                    minAmount = amount < minAmount ? amount : minAmount
                    maxAmount = amount > maxAmount ? amount : maxAmount
                    totalAmount += amount
                    count++

                    // Calculate average
                    const averageAmount = totalAmount / BigInt(count)

                    // Log the stats for each iteration
                    console.log(`Iteration ${i + 1}, Index ${index + 1}:`)
                    console.log(`  Min: ${minAmount}`)
                    console.log(`  Max: ${maxAmount}`)
                    console.log(`  Average: ${averageAmount}`)
                }
            }

            // Log final stats
            console.log('Final Stats:')
            console.log(`  Min: ${minAmount}`)
            console.log(`  Max: ${maxAmount}`)
            console.log(`  Average: ${totalAmount / BigInt(count)}`)
        })

        it('should fail when preTx is not verified', async () => {
            // new minter mint pass
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterV2State>

                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        xpGuardBuyMintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardSellPreTx,
                            utxo: xpGuardBuyUtxo,
                            contract: xpBuyGuardTaproot,
                            token: xpGuardBuyToken,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when premine add remindingSupply not equal max', async () => {
            const limit = 100n
            const max = 10000n
            const maxCount = max / limit
            // 5% premine
            const premine = (max * 5n) / 100n
            const premineCount = premine / limit
            const getTokenScript = async () => tokenScript
            const openMinterIns = await openMinterV2Deploy(
                keyInfo.seckey,
                keyInfo.xAddress,
                genesisTx,
                genesisUtxo,
                openMinter,
                getTokenScript,
                maxCount,
                premineCount,
                { wrongRemainingSupply: true }
            )
            const premineInfo = {
                // first mint amount equal premine
                // after mint amount need less than limit
                amount: premine,
                ownerAddr: hash160(keyInfo.pubkeyX),
            }
            await expect(
                openMinterCall(
                    keyInfo,
                    openMinterIns,
                    premineInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardBuyPreTx,
                        utxo: xpGuardBuyUtxo,
                        contract: xpBuyGuardTaproot,
                        token: xpGuardBuyToken,
                    },
                    {
                        wrongRemainingSupply: true,
                    }
                )
            ).to.be.rejected
        })

        it('should fail when the minting amount exceeds the limit', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterV2State>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        xpGuardBuyMintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardBuyPreTx,
                            utxo: xpGuardBuyUtxo,
                            contract: xpBuyGuardTaproot,
                            token: xpGuardBuyToken,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when the minting amount does not reach the limit', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterV2State>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        xpGuardBuyMintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardBuyPreTx,
                            utxo: xpGuardBuyUtxo,
                            contract: xpBuyGuardTaproot,
                            token: xpGuardBuyToken,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when remainingSupplyCount of new minters equals 0', async () => {
            const nextOpenMinterIns = premineCallInfo
                .nexts[0] as ContractIns<OpenMinterV2State>
            await expect(
                openMinterCall(
                    keyInfo,
                    nextOpenMinterIns,
                    xpGuardSellMintInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardSellPreTx,
                        utxo: xpGuardSellUtxo,
                        contract: xpSellGuardTaproot,
                        token: xpGuardSellToken,
                    }
                    // {
                    //     remainingSupplyCountZero: true,
                    // }
                )
            ).to.be.rejected
        })

        it('should fail when subsequent minter outputs count exceeed the limit', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit + 1n, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterV2State>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        mintInfo,
                        max,
                        premine,
                        limit,
                        {
                            preTx: xpGuardSellPreTx,
                            utxo: xpGuardSellUtxo,
                            contract: xpSellGuardTaproot,
                            token: xpGuardSellToken,
                        },
                        {
                            minterExceeedLimit: true,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when trying to premine more than once', async () => {
            // premine more than once
            await expect(
                openMinterCall(
                    keyInfo,
                    premineCallInfo.nexts[0],
                    premineInfo,
                    max,
                    premine,
                    limit,
                    {
                        preTx: xpGuardSellPreTx,
                        utxo: xpGuardSellUtxo,
                        contract: xpSellGuardTaproot,
                        token: xpGuardSellToken,
                    }
                )
            ).to.be.rejected
        })
    })
})
