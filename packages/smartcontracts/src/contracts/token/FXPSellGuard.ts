import { SmartContract, assert, method, toByteString } from 'scrypt-ts'
import { STATE_OUTPUT_INDEX } from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { XrayedTxIdPreimg1, TxProof } from '../utils/txProof'
import { SellUtil } from './sellUtil'
import { CAT20State, CAT20Proto } from './cat20Proto'
import { PreTxStatesInfo, StateUtils } from '../utils/stateUtils'

export class FXPSellGuard extends SmartContract {
    constructor() {
        super(...arguments)
    }

    @method()
    public redeem(
        preTx: XrayedTxIdPreimg1,
        preState: CAT20State,
        preTxStatesInfo: PreTxStatesInfo,
        // ctxs
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx
    ) {
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
        // Verify prev tx is a cat protocol tx
        StateUtils.verifyPreStateHash(
            preTxStatesInfo,
            CAT20Proto.stateHash(preState),
            preTx.outputScriptList[STATE_OUTPUT_INDEX],
            1n
        )

        // Verify prev tx
        const prevTixd = TxProof.getTxIdFromPreimg1(preTx)
        assert(prevTixd == prevoutsCtx.spentTxhash, 'prevTixd error')

        // Verify prev tx service fee
        const serviceFeeScript = toByteString(
            '512067fe8e4767ab1a9056b1e7c6166d690e641d3f40e188241f35f803b1f84546c2'
        )
        const serviceFeeSats = SellUtil.int32ToSatoshiBytes(1000000n)

        assert(
            preTx.outputScriptList[3] == serviceFeeScript,
            'should pay service fee address'
        )
        assert(
            preTx.outputSatoshisList[3] == serviceFeeSats,
            'should pay service fee amount'
        )
    }
}
