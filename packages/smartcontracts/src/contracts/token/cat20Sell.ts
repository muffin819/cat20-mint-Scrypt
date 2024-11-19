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
import { SellUtil } from './sellUtil'
import { OpMul } from 'scrypt-ts-lib-btc'
import cbor from 'cbor'

export class CAT20Sell extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    recvOutput: ByteString

    @prop()
    sellerAddress: ByteString

    @prop()
    price: int32

    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        sellerAddress: ByteString,
        price: int32
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.recvOutput = recvOutput
        this.sellerAddress = sellerAddress
        this.price = price
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        tokenInputIndex: int32,
        toBuyUserAmount: int32,
        sellChange: int32,
        buyUserAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
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
                SellUtil.int32ToSatoshiBytes(satoshiToSeller)
            )

            //
            const curStateCnt: bigint = sellChange == 0n ? 1n : 2n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    changeToSellTokenOutput +
                    toSellerOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
