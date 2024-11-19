import {
    ByteString,
    PubKey,
    PubKeyHash,
    Sig,
    SmartContract,
    assert,
    hash160,
    method,
    prop,
    sha256,
    toByteString,
} from 'scrypt-ts'
import { ChangeInfo, TxUtil, int32 } from '../../index'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../../index'
import { StateUtils, TxoStateHashes } from '../../index'
import { CAT20Proto } from '../../index'
import { SellUtil, SpentAmountsCtx } from './sellUtil'
import { OpMul } from 'scrypt-ts-lib-btc'

export class BuyCAT20 extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    buyerAddress: ByteString

    @prop()
    price: int32

    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: int32
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.buyerAddress = buyerAddress
        this.price = price
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        preRemainingSatoshis: int32,
        toBuyerAmount: int32,
        toSellerAmount: int32,
        toSellerAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
        tokenInputIndex: int32,
        // sig data
        cancel: boolean,
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        // ctxs
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        spentAmountsCtx: SpentAmountsCtx,
        changeInfo: ChangeInfo
    ) {
        // check preimage
        if (cancel) {
            assert(hash160(pubKeyPrefix + ownerPubKey) == this.buyerAddress)
            assert(this.checkSig(ownerSig, ownerPubKey))
        } else {
            // Check sighash preimage.
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

            assert(
                spentScriptsCtx[Number(tokenInputIndex)] == this.cat20Script,
                'should spend the cat20Script'
            )
            SellUtil.checkSpentAmountsCtx(
                spentAmountsCtx,
                shPreimage.hashSpentAmounts
            )
            assert(toSellerAmount >= 0n, 'Invalid to seller amount')

            assert(
                spentAmountsCtx[Number(prevoutsCtx.inputIndexVal)] ==
                    SellUtil.int32ToSatoshiBytes(preRemainingSatoshis),
                'Invalid preRemainingSatoshis'
            )

            const costSatoshis = OpMul.mul(this.price, toBuyerAmount)
            assert(
                preRemainingSatoshis >= costSatoshis,
                'Insufficient satoshis balance'
            )

            // to buyer
            let curStateHashes: ByteString = hash160(
                CAT20Proto.stateHash({
                    amount: toBuyerAmount,
                    ownerAddr: this.buyerAddress,
                })
            )
            const toBuyerTokenOutput = TxUtil.buildOutput(
                this.cat20Script,
                tokenSatoshiBytes
            )

            // sell token change
            let toSellerTokenOutput = toByteString('')
            if (toSellerAmount > 0n) {
                curStateHashes += hash160(
                    CAT20Proto.stateHash({
                        amount: toSellerAmount,
                        ownerAddr: toSellerAddress,
                    })
                )
                toSellerTokenOutput = TxUtil.buildOutput(
                    this.cat20Script,
                    tokenSatoshiBytes
                )
            }

            // remaining buyer utxo satoshi
            const remainingSatoshis = preRemainingSatoshis - costSatoshis
            let remainingOutput = toByteString('')
            if (remainingSatoshis > 0n) {
                const selfSpentScript =
                    spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
                remainingOutput = TxUtil.buildOutput(
                    selfSpentScript,
                    SellUtil.int32ToSatoshiBytes(remainingSatoshis)
                )
            }

            //
            const curStateCnt: bigint = toSellerAmount == 0n ? 1n : 2n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    toSellerTokenOutput +
                    remainingOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
