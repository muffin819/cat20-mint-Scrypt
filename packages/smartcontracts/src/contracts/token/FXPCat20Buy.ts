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
import { ChangeInfo, TxUtil, int32 } from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { StateUtils, TxoStateHashes } from '../utils/stateUtils'
import { CAT20Proto } from './cat20Proto'
import { SellUtil, SpentAmountsCtx } from './sellUtil'
import { OpMul } from 'scrypt-ts-lib-btc'

export class FXPCat20Buy extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    buyerAddress: ByteString

    @prop()
    price: int32

    @prop()
    scalePrice: boolean

    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: int32,
        scalePrice: boolean
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.buyerAddress = buyerAddress
        this.price = price
        this.scalePrice = scalePrice
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        preRemainingAmount: int32,
        toBuyerAmount: int32,
        toSellerAmount: int32,
        toSellerAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
        tokenInputIndex: int32,
        //
        fxpReward: boolean,
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

            const preRemainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount
            )

            assert(
                spentAmountsCtx[Number(prevoutsCtx.inputIndexVal)] ==
                    SellUtil.int32ToSatoshiBytesScaled(
                        preRemainingSatoshis,
                        this.scalePrice
                    ),
                'Invalid preRemainingSatoshis'
            )

            const costSatoshis = OpMul.mul(this.price, toBuyerAmount)
            assert(
                preRemainingAmount >= toBuyerAmount,
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
            const remainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount - toBuyerAmount
            )
            let remainingOutput = toByteString('')
            if (remainingSatoshis > 0n) {
                const selfSpentScript =
                    spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
                remainingOutput = TxUtil.buildOutput(
                    selfSpentScript,
                    SellUtil.int32ToSatoshiBytesScaled(
                        remainingSatoshis,
                        this.scalePrice
                    )
                )
            }

            //
            const curStateCnt: bigint = toSellerAmount == 0n ? 1n : 2n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            const serviceFeeP2TR = toByteString(
                '512067fe8e4767ab1a9056b1e7c6166d690e641d3f40e188241f35f803b1f84546c2'
            )
            const serviceFeeOutput = TxUtil.buildOutput(
                serviceFeeP2TR,
                SellUtil.int32ToSatoshiBytes(1000000n)
            )
            const fxpBuyGuardP2TR = toByteString(
                '5120629546ef6334959d5d9c0ab8268c3f04d23b56658c1f3ad34d94555a9f7db8b3'
            )

            let fxpBuyGuardOutput = toByteString('')

            if (remainingSatoshis == 0n && fxpReward) {
                fxpBuyGuardOutput = TxUtil.buildOutput(
                    fxpBuyGuardP2TR,
                    SellUtil.int32ToSatoshiBytes(330n)
                )
            }

            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    toSellerTokenOutput +
                    remainingOutput +
                    serviceFeeOutput +
                    fxpBuyGuardOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
