import { MAX_INPUT, int32 } from '../../index'
import {
    method,
    toByteString,
    ByteString,
    SmartContractLib,
    len,
    int2ByteString,
    assert,
    FixedArray,
    sha256,
    byteString2Int,
    hash160,
    slice,
} from 'scrypt-ts'
import { XrayedTxIdPreimg1 } from '../utils/txProof'

export type SpentAmountsCtx = FixedArray<ByteString, typeof MAX_INPUT>

export class SellUtil extends SmartContractLib {
    @method()
    static mergeSpentAmounts(spentAmounts: SpentAmountsCtx): ByteString {
        let result = toByteString('')
        for (let index = 0; index < MAX_INPUT; index++) {
            const spentAmount = spentAmounts[index]
            if (len(spentAmount) == 8n) {
                result += spentAmount
            }
        }
        return result
    }

    @method()
    static checkSpentAmountsCtx(
        spentAmounts: SpentAmountsCtx,
        hashSpentAmounts: ByteString
    ): boolean {
        // check spent amounts
        assert(
            sha256(SellUtil.mergeSpentAmounts(spentAmounts)) ==
                hashSpentAmounts,
            'spentAmountsCtx mismatch'
        )
        return true
    }

    @method()
    static int32ToSatoshiBytes(amount: int32): ByteString {
        assert(amount > 0n)
        let amountBytes = int2ByteString(amount)
        const amountBytesLen = len(amountBytes)
        if (amountBytesLen == 1n) {
            amountBytes += toByteString('000000')
        } else if (amountBytesLen == 2n) {
            amountBytes += toByteString('0000')
        } else if (amountBytesLen == 3n) {
            amountBytes += toByteString('00')
        }
        return amountBytes + toByteString('00000000')
    }

    @method()
    static int32ToSatoshiBytesScaled(
        amount: int32,
        scale: boolean
    ): ByteString {
        assert(amount > 0n)
        let amountBytes = scale
            ? SellUtil.scale2ByteString(amount)
            : int2ByteString(amount)
        const amountBytesLen = len(amountBytes)
        if (amountBytesLen == 1n) {
            amountBytes += toByteString('00000000000000')
        } else if (amountBytesLen == 2n) {
            amountBytes += toByteString('000000000000')
        } else if (amountBytesLen == 3n) {
            amountBytes += toByteString('0000000000')
        } else if (amountBytesLen == 4n) {
            amountBytes += toByteString('00000000')
        } else if (amountBytesLen == 5n) {
            amountBytes += toByteString('000000')
        } else if (amountBytesLen == 6n) {
            amountBytes += toByteString('0000')
        } else if (amountBytesLen == 7n) {
            amountBytes += toByteString('00')
        }
        return amountBytes
    }

    @method()
    static scale2ByteString(amount: int32): ByteString {
        return toByteString('00') + int2ByteString(amount)
    }
}
