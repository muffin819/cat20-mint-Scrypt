import {
    CatTx,
    ContractIns,
    TaprootSmartContract,
    TaprootMastSmartContract,
} from '../../src/lib/catTx'
import {
    CAT20,
    CAT20Proto,
    CAT20State,
    GuardInfo,
    GuardProto,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
    TransferGuard,
    emptyTokenArray,
    getBackTraceInfoSearch,
    getOutpointObj,
    getTxCtxMulti,
    getTxHeaderCheck,
} from '../../src/index'
import {
    ByteString,
    MethodCallOptions,
    fill,
    hash160,
    int2ByteString,
    toByteString,
} from 'scrypt-ts'
import { deployGuardAndNoState } from '../cat20'
import { getDummySigner, getDummyUTXO } from '../utils/txHelper'
import { FXPCat20Sell } from '../../src/contracts/token/FXPCat20Sell'
import { unlockTaprootContractInput } from '../utils/contractUtils'

const SERVICE_FEE_SCRIPT =
    '512067fe8e4767ab1a9056b1e7c6166d690e641d3f40e188241f35f803b1f84546c2'
const SERVICE_FEE_AMOUNT = 1000000n
export async function cat20SellCall(
    feeDeployUtxo,
    seckey,
    keyLocking: ByteString,
    sellChangeAmount: bigint,
    buyerAddr: ByteString,
    inputTokens: ContractIns<CAT20State>[],
    cat20SellTaproot: TaprootSmartContract,
    minterScript: string,
    guardInfo: TaprootMastSmartContract,
    price: bigint,
    xpGuard: TaprootSmartContract
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index] =
                inputTokens[index].state.amount
        }
    }
    const guardAndSell = await deployGuardAndNoState(
        feeDeployUtxo,
        seckey,
        guardState,
        guardInfo,
        cat20SellTaproot
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    const guardInputIndex = catTx.fromCatTx(
        guardAndSell.catTx,
        guardAndSell.atOutputIndex
    )
    const sellInputIndex = catTx.fromCatTx(
        guardAndSell.catTx,
        guardAndSell.noStateAtOutputIndex
    )
    const totalInputAmount = inputTokens.reduce(
        (p, c) => p + c.state.amount,
        0n
    )
    const receivers = [
        CAT20Proto.create(totalInputAmount - sellChangeAmount, buyerAddr),
    ]
    if (sellChangeAmount > 0n) {
        const tokenChange = CAT20Proto.create(
            sellChangeAmount,
            hash160(cat20SellTaproot.lockingScriptHex)
        )
        receivers.push(tokenChange)
    }
    for (const receiver of receivers) {
        catTx.addStateContractOutput(
            inputTokens[0].contractTaproot.lockingScriptHex,
            CAT20Proto.toByteString(receiver)
        )
    }
    const toBuyUserAmount = totalInputAmount - sellChangeAmount
    catTx.addContractOutput(keyLocking, Number(toBuyUserAmount * price))
    catTx.addContractOutput(SERVICE_FEE_SCRIPT, Number(SERVICE_FEE_AMOUNT))
    if (sellChangeAmount === 0n) {
        catTx.addContractOutput(xpGuard.lockingScriptHex, 330)
    }
    // call getTxCtxMulti
    const inputIndexList: number[] = []
    const scriptBuffers: Buffer[] = []
    for (let i = 0; i < inputTokens.length; i++) {
        inputIndexList.push(i)
        scriptBuffers.push(inputTokens[i].contractTaproot.tapleafBuffer)
    }
    // push guard
    inputIndexList.push(guardInputIndex)
    scriptBuffers.push(guardAndSell.contractTaproot.tapleafBuffer)
    // push sell
    inputIndexList.push(sellInputIndex)
    scriptBuffers.push(guardAndSell.noStateContractTaproot.tapleafBuffer)
    const ctxList = getTxCtxMulti(catTx.tx, inputIndexList, scriptBuffers)
    // token unlock
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts } = ctxList[i]
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(guardAndSell.catTx.tx, 1)
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardAndSell.catTx.tx, 1).outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: guardAndSell.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: false,
                userPubKeyPrefix: toByteString(''),
                userPubKey: toByteString(''),
                userSig: toByteString(''),
                contractInputIndex: BigInt(sellInputIndex),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    // guard unlock
    {
        const { shPreimage, prevoutsCtx, spentScripts } =
            ctxList[guardInputIndex]
        const preTx = getTxHeaderCheck(guardAndSell.catTx.tx, 1)
        await guardAndSell.contract.connect(getDummySigner())
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const tokenAmountArray = fill(0n, MAX_TOKEN_OUTPUT)
        const mixArray = emptyTokenArray()
        const outputSatoshiArray = emptyTokenArray()
        for (let i = 0; i < receivers.length; i++) {
            const receiver = receivers[i]
            tokenOutputMaskArray[i] = true
            tokenAmountArray[i] = receiver.amount
            mixArray[i] = receiver.ownerAddr
        }
        // other output
        for (
            let index = receivers.length + 1;
            index < catTx.tx.outputs.length;
            index++
        ) {
            const output = catTx.tx.outputs[index]
            mixArray[index - 1] = output.script.toBuffer().toString('hex')
            outputSatoshiArray[index - 1] = int2ByteString(
                BigInt(output.satoshis),
                8n
            )
        }
        const tokenTransferCheckCall =
            await guardAndSell.contract.methods.transfer(
                catTx.state.stateHashList,
                mixArray,
                tokenAmountArray,
                tokenOutputMaskArray,
                outputSatoshiArray,
                toByteString('4a01000000000000'),
                guardAndSell.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                spentScripts,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<TransferGuard>
            )
        unlockTaprootContractInput(
            tokenTransferCheckCall,
            guardAndSell.contractTaproot,
            catTx.tx,
            guardAndSell.catTx.tx,
            inputTokens.length,
            true,
            true
        )
    }
    // sell unlock
    {
        await guardAndSell.noStateContract.connect(getDummySigner())
        const { shPreimage, prevoutsCtx, spentScripts } =
            ctxList[sellInputIndex]
        const sellCall = await guardAndSell.noStateContract.methods.take(
            catTx.state.stateHashList,
            0n,
            toBuyUserAmount,
            sellChangeAmount,
            buyerAddr,
            toByteString('4a01000000000000'),
            true,
            false,
            toByteString(''),
            toByteString(''),
            () => toByteString(''),
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
                exec: false,
            } as MethodCallOptions<FXPCat20Sell>
        )
        unlockTaprootContractInput(
            sellCall,
            guardAndSell.noStateContractTaproot,
            catTx.tx,
            guardAndSell.catTx.tx,
            sellInputIndex,
            true,
            true
        )
    }
    return receivers.map((tokenState, index) => {
        return {
            catTx: catTx,
            preCatTx: inputTokens[0].catTx,
            contract: inputTokens[0].contract,
            state: tokenState,
            contractTaproot: inputTokens[0].contractTaproot,
            atOutputIndex: index + 1,
        }
    })
}
