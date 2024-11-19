import { BurnGuard } from './contracts/token/burnGuard'
import { ClosedMinter } from './contracts/token/closedMinter'
import { OpenMinter } from './contracts/token/openMinter'
import { CAT20 } from './contracts/token/cat20'
import { TransferGuard } from './contracts/token/transferGuard'
import { OpenMinterV2 } from './contracts/token/openMinterV2'
import { CAT20Sell } from './contracts/token/cat20Sell'
import { BuyCAT20 } from './contracts/token/buyCAT20'
import { FXPCat20Buy } from './contracts/token/FXPCat20Buy'
import { FXPCat20Sell } from './contracts/token/FXPCat20Sell'
import { FXPOpenMinter } from './contracts/token/FXPOpenMinter'
import { FXPBuyGuard } from './contracts/token/FXPBuyGuard'
import { FXPSellGuard } from './contracts/token/FXPSellGuard'

import closedMinter from '../artifacts/contracts/token/closedMinter.json'
import openMinter from '../artifacts/contracts/token/openMinter.json'
import openMinterV2 from '../artifacts/contracts/token/openMinterV2.json'
import cat20 from '../artifacts/contracts/token/cat20.json'
import burnGuard from '../artifacts/contracts/token/burnGuard.json'
import transferGuard from '../artifacts/contracts/token/transferGuard.json'
import cat20Sell from '../artifacts/contracts/token/cat20Sell.json'
import buyCAT20 from '../artifacts/contracts/token/buyCAT20.json'
import fxpCat20Buy from '../artifacts/contracts/token/FXPCat20Buy.json'
import fxpCat20Sell from '../artifacts/contracts/token/FXPCat20Sell.json'
import fxpOpenMinter from '../artifacts/contracts/token/FXPOpenMinter.json'
import fxpBuyGuard from '../artifacts/contracts/token/FXPBuyGuard.json'
import fxpSellGuard from '../artifacts/contracts/token/FXPSellGuard.json'
;(() => {
    ClosedMinter.loadArtifact(closedMinter)
    OpenMinter.loadArtifact(openMinter)
    OpenMinterV2.loadArtifact(openMinterV2)
    CAT20.loadArtifact(cat20)
    BurnGuard.loadArtifact(burnGuard)
    TransferGuard.loadArtifact(transferGuard)
    CAT20Sell.loadArtifact(cat20Sell)
    BuyCAT20.loadArtifact(buyCAT20)
    FXPBuyGuard.loadArtifact(fxpBuyGuard)
    FXPSellGuard.loadArtifact(fxpSellGuard)
    FXPCat20Buy.loadArtifact(fxpCat20Buy)
    // FXPCat20Sell.loadArtifact(fxpCat20Sell)
    FXPOpenMinter.loadArtifact(fxpOpenMinter)
})()
export * from './contracts/token/closedMinter'
export * from './contracts/token/cat20'
export * from './contracts/token/burnGuard'
export * from './contracts/token/transferGuard'
export * from './contracts/token/cat20Proto'
export * from './contracts/token/closedMinterProto'
export * from './contracts/token/guardProto'
export * from './contracts/token/openMinter'
export * from './contracts/token/openMinterV2'
export * from './contracts/token/openMinterProto'
export * from './contracts/token/openMinterV2Proto'
export * from './contracts/utils/txUtil'
export * from './contracts/utils/txProof'
export * from './contracts/utils/stateUtils'
export * from './contracts/utils/backtrace'
export * from './contracts/utils/sigHashUtils'
export * from './lib/state'
export * from './lib/proof'
export * from './lib/txTools'
export * from './lib/commit'
export * from './lib/guardInfo'
export * from './contracts/token/cat20Sell'
export * from './contracts/token/buyCAT20'
export * from './contracts/token/FXPCat20Buy'
export * from './contracts/token/FXPCat20Sell'
export * from './contracts/token/FXPOpenMinter'
export * from './contracts/token/FXPBuyGuard'
export * from './contracts/token/FXPSellGuard'
