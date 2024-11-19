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
import { SellUtil } from './sellUtil'
import { OpMul } from 'scrypt-ts-lib-btc'

export class FXPCat20Sell extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    recvOutput: ByteString

    @prop()
    sellerAddress: ByteString

    @prop()
    price: int32

    @prop()
    scalePrice: boolean

    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        sellerAddress: ByteString,
        price: int32,
        scalePrice: boolean
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.recvOutput = recvOutput
        this.sellerAddress = sellerAddress
        this.price = price
        this.scalePrice = scalePrice
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        tokenInputIndex: int32,
        toBuyUserAmount: int32,
        sellChange: int32,
        buyUserAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
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
        changeInfo: ChangeInfo
    ) {
        // check preimage
        if (cancel) {
            assert(hash160(pubKeyPrefix + ownerPubKey) == this.sellerAddress)
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
            // ensure inputs have one token input
            assert(spentScriptsCtx[Number(tokenInputIndex)] == this.cat20Script)
            assert(sellChange >= 0n)
            // build outputs

            // to buyer
            let curStateHashes: ByteString = hash160(
                CAT20Proto.stateHash({
                    amount: toBuyUserAmount,
                    ownerAddr: buyUserAddress,
                })
            )
            const toBuyerTokenOutput = TxUtil.buildOutput(
                this.cat20Script,
                tokenSatoshiBytes
            )

            // sell token change
            let changeToSellTokenOutput = toByteString('')
            if (sellChange > 0n) {
                const contractAddress = hash160(
                    spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
                )
                curStateHashes += hash160(
                    CAT20Proto.stateHash({
                        amount: sellChange,
                        ownerAddr: contractAddress,
                    })
                )
                changeToSellTokenOutput = TxUtil.buildOutput(
                    this.cat20Script,
                    tokenSatoshiBytes
                )
            }

            // satoshi to seller
            const satoshiToSeller = OpMul.mul(this.price, toBuyUserAmount)
            const toSellerOutput = TxUtil.buildOutput(
                this.recvOutput,
                // token 1 decimals = 1 satoshi
                SellUtil.int32ToSatoshiBytesScaled(
                    satoshiToSeller,
                    this.scalePrice
                )
            )

            //
            const curStateCnt: bigint = sellChange == 0n ? 1n : 2n
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

            // Only set fxp reward on full take
            let fxpSellGuardOutput = toByteString('')
            if (sellChange == 0n && fxpReward) {
                const fxpSellGuardP2TR = toByteString(
                    '51204531afe938faf1565672605241a227e4484cb728bf74eadc231d341e5c310e81'
                )
                fxpSellGuardOutput = TxUtil.buildOutput(
                    fxpSellGuardP2TR,
                    SellUtil.int32ToSatoshiBytes(330n)
                )
            }

            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    changeToSellTokenOutput +
                    toSellerOutput +
                    serviceFeeOutput +
                    fxpSellGuardOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
