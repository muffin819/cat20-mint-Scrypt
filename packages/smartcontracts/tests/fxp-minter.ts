import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../src/lib/catTx'
import {
    OpenMinterV2Proto,
    OpenMinterV2State,
} from '../src/contracts/token/openMinterV2Proto'
import { int32 } from '../src/contracts/utils/txUtil'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'
import { getTxCtxMulti } from '../src/lib/txTools'
import { getBackTraceInfo } from '../src/lib/proof'
import { getDummySigner, getDummyUTXO } from './utils/txHelper'
import { KeyInfo } from './utils/privateKey'
import { MethodCallOptions, toByteString, UTXO } from 'scrypt-ts'
import { unlockTaprootContractInput } from './utils/contractUtils'
import { btc } from '../src/lib/btc'
import { FXPOpenMinter } from '../src/contracts/token/FXPOpenMinter'
import { txToTxHeader, txToTxHeaderPartial } from '../src/lib/proof'
import { TxProof } from '../src/contracts/utils/txProof'
import { FXPBuyGuard } from '../src/contracts/token/FXPBuyGuard'
export type GetTokenScript = (minterScript: string) => Promise<string>

const SLICE_MAGNITUDE = 2

export async function openMinterV2Deploy(
    seckey,
    address,
    genesisTx,
    genesisUtxo,
    openMinter: FXPOpenMinter,
    getTokenScript: GetTokenScript,
    maxCount: int32,
    premineCount: int32,
    options: {
        wrongRemainingSupply?: boolean
    } = {}
): Promise<ContractIns<OpenMinterV2State>> {
    const openMinterTaproot = TaprootSmartContract.create(openMinter)
    const tokenScript = await getTokenScript(openMinterTaproot.lockingScriptHex)
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    let remainingSupply = maxCount - premineCount
    if (options.wrongRemainingSupply) {
        remainingSupply -= 1n
    }
    const openMinterState = OpenMinterV2Proto.create(
        tokenScript,
        false,
        remainingSupply
    )
    const atIndex = catTx.addStateContractOutput(
        openMinterTaproot.lockingScript,
        OpenMinterV2Proto.toByteString(openMinterState)
    )
    catTx.sign(seckey)
    const preCatTx = CatTx.create()
    preCatTx.tx = genesisTx
    return {
        catTx: catTx,
        contract: openMinter,
        state: openMinterState,
        preCatTx: preCatTx,
        contractTaproot: openMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function openMinterCall(
    keyInfo: KeyInfo,
    contractIns: ContractIns<OpenMinterV2State>,
    tokenState: CAT20State,
    max: int32,
    premine: int32,
    limit: int32,
    guard: {
        contract: TaprootSmartContract
        utxo: UTXO
        preTx: CatTx
        token: ContractIns<CAT20State>
    },
    options: {
        moreThanOneToken?: boolean
        minterExceeedLimit?: boolean
        wrongRemainingSupply?: boolean
        remainingSupplyCountZero?: boolean
    } = {}
): Promise<ContractCallResult<OpenMinterV2State | CAT20State>> {
    if (options.wrongRemainingSupply) {
        max -= 1n
    }

    // if
    const splitAmountList = OpenMinterV2Proto.getSplitAmountList(
        contractIns.state.remainingSupplyCount,
        contractIns.state.isPremined,
        premine
    )
    if (options.remainingSupplyCountZero) {
        splitAmountList[0] = splitAmountList[0] + splitAmountList[1]
        splitAmountList[1] = 0n
    }
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    catTx.tx.from([guard.utxo])
    const nexts: ContractIns<OpenMinterV2State | CAT20State>[] = []
    const openMinterState = contractIns.state
    for (let i = 0; i < splitAmountList.length; i++) {
        const amount = splitAmountList[i]
        if (amount > 0n || options.remainingSupplyCountZero) {
            const splitMinterState = OpenMinterV2Proto.create(
                openMinterState.tokenScript,
                true,
                amount
            )
            const atOutputIndex = catTx.addStateContractOutput(
                contractIns.contractTaproot.lockingScript,
                OpenMinterV2Proto.toByteString(splitMinterState)
            )
            nexts.push({
                catTx: catTx,
                contract: contractIns.contract,
                preCatTx: contractIns.catTx,
                state: splitMinterState,
                contractTaproot: contractIns.contractTaproot,
                atOutputIndex: atOutputIndex,
            })
        }
    }
    if (tokenState.amount > 0n) {
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.state.tokenScript,
            CAT20Proto.toByteString(tokenState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            preCatTx: contractIns.catTx,
            state: tokenState,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    if (options.moreThanOneToken) {
        // const atOutputIndex = catTx.addStateContractOutput(
        //     contractIns.state.tokenScript,
        //     CAT20Proto.toByteString(tokenState)
        // )
        // nexts.push({
        //     catTx: catTx,
        //     contract: contractIns.contract,
        //     preCatTx: contractIns.catTx,
        //     state: tokenState,
        //     contractTaproot: contractIns.contractTaproot,
        //     atOutputIndex: atOutputIndex,
        // })
    }

    const ctxList = getTxCtxMulti(
        catTx.tx,
        [atInputIndex, 1],
        [
            contractIns.contractTaproot.tapleafBuffer,
            guard.contract.tapleafBuffer,
        ]
    )

    const { shPreimage, prevoutsCtx, spentScripts, sighash } = ctxList[0]

    const backtraceInfo = getBackTraceInfo(
        contractIns.catTx.tx,
        contractIns.preCatTx?.tx,
        0
    )
    const sig = btc.crypto.Schnorr.sign(keyInfo.seckey, sighash.hash)
    await contractIns.contract.connect(getDummySigner())

    const preTxHeader = txToTxHeader(guard.preTx.tx)
    const preTx = txToTxHeaderPartial(preTxHeader)

    const {
        shPreimage: guardShPreimage,
        prevoutsCtx: guardPrevoutsCtx,
        spentScripts: guardSpentScripts,
    } = ctxList[1]

    await guard.contract.contract.connect(getDummySigner())
    const redeemCall = await guard.contract.contract.methods.redeem(
        // BigInt(guard.utxo.outputIndex - 1),
        preTx,
        guard.token.state,
        guard.preTx.getPreState(),
        guardShPreimage,
        guardPrevoutsCtx,
        guardSpentScripts,
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<FXPBuyGuard>
    )
    unlockTaprootContractInput(
        redeemCall,
        guard.contract,
        catTx.tx,
        guard.preTx.tx,
        1,
        true,
        true
    )

    const xpAmountHash = FXPOpenMinter.getFXPAmountHash(preTx)

    try {
        const openMinterFuncCall = await contractIns.contract.methods.mint(
            catTx.state.stateHashList,
            tokenState,
            tokenState.amount / 100n,
            splitAmountList,
            preTx,
            guard.token.state,
            guard.preTx.getPreState(),
            xpAmountHash.slice(SLICE_MAGNITUDE),
            keyInfo.pubkeyX,
            toByteString('4a01000000000000'),
            toByteString('4a01000000000000'),
            contractIns.state,
            contractIns.catTx.getPreState(),
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                script: toByteString(''),
                satoshis: toByteString('0000000000000000'),
            },
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: true,
            } as MethodCallOptions<FXPOpenMinter>
        )
        console.log('openMinterFuncCall', openMinterFuncCall)
        unlockTaprootContractInput(
            openMinterFuncCall,
            contractIns.contractTaproot,
            catTx.tx,
            contractIns.catTx.tx,
            0,
            true,
            true
        )
        return {
            catTx: catTx,
            contract: contractIns.contract,
            state: contractIns.state,
            contractTaproot: contractIns.contractTaproot,
            atInputIndex: atInputIndex,
            nexts: nexts,
            // @ts-ignore
            mintAmount: tokenState.amount,
        }
    } catch (e) {
        throw new Error(`ERROR AMOUNT ${tokenState.amount} ${e.message}`)
    }
}
