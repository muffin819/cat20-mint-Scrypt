import {
    method,
    SmartContract,
    assert,
    prop,
    ByteString,
    FixedArray,
    sha256,
    hash160,
    toByteString,
    PubKey,
    byteString2Int,
    int2ByteString,
} from 'scrypt-ts'
import { ChangeInfo, STATE_OUTPUT_INDEX, TxUtil, int32 } from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'
import {
    StateUtils,
    PreTxStatesInfo,
    TxoStateHashes,
} from '../utils/stateUtils'
import { CAT20State, CAT20Proto } from './cat20Proto'
import { OpenMinterV2Proto, OpenMinterV2State } from './openMinterV2Proto'
import { XrayedTxIdPreimg1, TxProof } from '../utils/txProof'
import { OpMul } from 'scrypt-ts-lib-btc'
const MAX_NEXT_MINTERS = 2

export class FXPOpenMinter extends SmartContract {
    @prop()
    genesisOutpoint: ByteString

    @prop()
    maxCount: int32

    @prop()
    premine: int32

    @prop()
    premineCount: int32

    @prop()
    limit: int32

    @prop()
    premineAddr: ByteString

    constructor(
        genesisOutpoint: ByteString,
        maxCount: int32,
        premine: int32,
        premineCount: int32,
        limit: int32,
        premineAddr: ByteString
    ) {
        super(...arguments)
        this.genesisOutpoint = genesisOutpoint
        this.maxCount = maxCount
        /*
        Note: this assumes this.premineCount *  this.limit  == this.premine,
        which can be trivially validated by anyone after the token is deployed
        */
        this.premine = premine
        this.premineCount = premineCount
        this.limit = limit
        this.premineAddr = premineAddr
    }

    static getFXPAmount(tx: XrayedTxIdPreimg1): int32 {
        const hash = FXPOpenMinter.getFXPAmountHash(tx)
        let rand = byteString2Int(hash[0] + hash[1]) // -127n through 127n

        if (rand < 0n) {
            rand = -rand
        }

        const res = (rand + 1n) * 100n

        if (res == 6900n) {
            return 42000n
        }

        return (rand + 1n) * 100n
    }

    @method()
    static getFXPAmountHash(tx: XrayedTxIdPreimg1): ByteString {
        const txid = TxProof.getTxIdFromPreimg1(tx)
        const hash = sha256(
            tx.outputScriptList[0] +
                tx.outputScriptList[1] +
                tx.outputScriptList[2] +
                tx.outputScriptList[3] +
                tx.outputScriptList[4] +
                tx.outputScriptList[5] +
                txid
        )
        return hash
    }

    @method()
    public mint(
        //
        curTxoStateHashes: TxoStateHashes,
        // contract logic args
        tokenMint: CAT20State,
        tokenAmount: int32,
        nextMinterCounts: FixedArray<int32, typeof MAX_NEXT_MINTERS>,

        // FXP Guard
        guardPreTx: XrayedTxIdPreimg1,
        guardPreState: CAT20State,
        guardPreTxStatesInfo: PreTxStatesInfo,
        guardAmountHashSuffix: ByteString,
        guardTakerPubkey: PubKey,

        // satoshis locked in minter utxo
        minterSatoshis: ByteString,
        // satoshis locked in token utxo
        tokenSatoshis: ByteString,
        // unlock utxo state info
        preState: OpenMinterV2State,
        preTxStatesInfo: PreTxStatesInfo,
        // backtrace info, use b2g
        backtraceInfo: BacktraceInfo,
        // common args
        // current tx info
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        // change output info
        changeInfo: ChangeInfo
    ) {
        // check preimage
        assert(
            this.checkSig(
                SigHashUtils.checkSHPreimage(shPreimage),
                SigHashUtils.Gx
            ),
            'preimage check error'
        )
        // check ctx
        SigHashUtils.checkPrevoutsCtx(
            prevoutsCtx,
            shPreimage.hashPrevouts,
            shPreimage.inputIndex
        )
        SigHashUtils.checkSpentScriptsCtx(
            spentScriptsCtx,
            shPreimage.hashSpentScripts
        )
        // verify state
        StateUtils.verifyPreStateHash(
            preTxStatesInfo,
            OpenMinterV2Proto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )
        // check preTx script eq this locking script
        const preScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
        // back to genesis
        Backtrace.verifyUnique(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.genesisOutpoint,
            preScript
        )

        // Verify guard script
        const FXPSellGuardP2TR = toByteString(
            '51204531afe938faf1565672605241a227e4484cb728bf74eadc231d341e5c310e81'
        )
        const FXPBuyGuardP2TR = toByteString(
            '5120629546ef6334959d5d9c0ab8268c3f04d23b56658c1f3ad34d94555a9f7db8b3'
        )
        const takerScript = toByteString('5120') + guardTakerPubkey
        const isBuy = spentScriptsCtx[1] == FXPBuyGuardP2TR
        const isSell = spentScriptsCtx[1] == FXPSellGuardP2TR
        const guardTxid = TxProof.getTxIdFromPreimg1(guardPreTx)

        assert(isBuy || isSell, 'guard script mismatches')

        if (isSell) {
            assert(
                takerScript == guardPreTx.outputScriptList[2],
                'taker pubkey mismatch'
            )
            assert(
                guardTxid + toByteString('04000000') ===
                    prevoutsCtx.prevouts[1],
                'guard txid mismatch'
            )
            assert(
                tokenMint.ownerAddr == hash160(guardTakerPubkey),
                'ownerAddr mismatch'
            )
        }

        if (isBuy) {
            assert(
                tokenMint.ownerAddr == guardPreState.ownerAddr,
                'ownerAddr mismatch'
            )

            const is5 = guardPreTx.outputScriptList[5] == takerScript
            const is4 = guardPreTx.outputScriptList[4] == takerScript

            assert(is5 || is4, 'taker pubkey mismatch')

            if (is4) {
                assert(
                    guardTxid + toByteString('03000000') ===
                        prevoutsCtx.prevouts[1],
                    'guard txid mismatch'
                )
            }

            if (is5) {
                assert(
                    guardTxid + toByteString('04000000') ===
                        prevoutsCtx.prevouts[1],
                    'guard txid mismatch'
                )
            }
        }

        // Verify guard state
        StateUtils.verifyPreStateHash(
            guardPreTxStatesInfo,
            CAT20Proto.stateHash(guardPreState),
            guardPreTx.outputScriptList[STATE_OUTPUT_INDEX],
            1n
        )

        // split to multiple minters
        let openMinterOutputs = toByteString('')
        let curStateHashes = toByteString('')
        let curStateCnt = 1n
        let mintCount = 0n
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const count = nextMinterCounts[i]
            if (count > 0n) {
                mintCount += count
                curStateCnt += 1n
                openMinterOutputs += TxUtil.buildOutput(
                    preScript,
                    minterSatoshis
                )
                curStateHashes += hash160(
                    OpenMinterV2Proto.stateHash({
                        tokenScript: preState.tokenScript,
                        isPremined: true,
                        remainingSupplyCount: count,
                    })
                )
            }
        }

        const tokenOutput = TxUtil.buildOutput(
            preState.tokenScript,
            tokenSatoshis
        )
        const tokenOutputs = tokenOutput

        curStateHashes += hash160(
            CAT20Proto.stateHash({
                amount: tokenMint.amount,
                ownerAddr: tokenMint.ownerAddr,
            })
        )

        // not first unlock mint
        mintCount += 1n
        assert(mintCount == preState.remainingSupplyCount)

        const isLottery = tokenAmount == 420n

        assert(
            tokenAmount <= 128n || isLottery, // 2^7 = 128
            'token amount must be less than 128'
        )

        assert(
            OpMul.mul(tokenAmount, 100n) == tokenMint.amount,
            'token amount mismatch'
        )

        const amountHash = FXPOpenMinter.getFXPAmountHash(guardPreTx)
        const amount = isLottery ? 69n - 1n : tokenAmount - 1n
        const posAmountHash =
            (amount === 0n ? toByteString('00') : int2ByteString(amount)) +
            guardAmountHashSuffix
        const negAmountHash =
            (amount === 0n ? toByteString('80') : int2ByteString(-amount)) +
            guardAmountHashSuffix

        if (isLottery) {
            console.log({
                amount,
                amountHash,
                posAmountHash,
                negAmountHash,
                tokneAmount: tokenMint.amount,
            })
        }

        assert(
            amountHash == posAmountHash || amountHash == negAmountHash,
            'FXP amount mismatch'
        )

        const stateOutput = StateUtils.getCurrentStateOutput(
            curStateHashes,
            curStateCnt,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)

        const hashOutputs = sha256(
            stateOutput + openMinterOutputs + tokenOutputs + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
