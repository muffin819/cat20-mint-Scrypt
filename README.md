
## Fractal-Cat20-sCrypt-smart-contract
The smart contract for the Cat Protocol utilizes sCrypt to implement cat20 minting service on the Fractal Bitcoin network. It is basic of a launchpad for the Fractal CAT20 token, allowing users to mint CAT20 tokens.
 
## Overview
The Fractal-Cat20-sCrypt-smart-contract project leverages the Fractal Bitcoin network's capabilities to implement a smart contract for the Cat Protocol using sCrypt. This project enables users to mint CAT20 tokens. The implementation takes advantage of the OP_CAT opcode to enhance Bitcoin's functionality, providing features akin to those seen in smart contracts on other blockchain platforms.

## Features
Minting of CAT20 Tokens: Utilize the sCrypt-based smart contract to mint new CAT20 tokens on the Fractal Bitcoin network.
Integration of OP_CAT: The smart contract makes use of the OP_CAT opcode to improve contract programmability and execution.

## Contract Structure
### Mint Function: Implements the logic to mint new CAT20 tokens by verifying appropriate proofs and executing the creation script.
### Transfer Function: Handles the transfer of existing tokens between users, ensuring compliance with the protocol's specified rules.
Below is a simplified version of the sCrypt contract code structure:

public mint(
        //
        curTxoStateHashes: TxoStateHashes,
        // contract logic args
        tokenMint: CAT20State,
        nextMinterAmounts: FixedArray<int32, typeof MAX_NEXT_MINTERS>,

        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,

        // satoshis locked in minter utxo
        minterSatoshis: ByteString,
        // satoshis locked in token utxo
        tokenSatoshis: ByteString,
        // unlock utxo state info
        preState: OpenMinterState,
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
            OpenMinterProto.stateHash(preState),
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

        // split to multiple minters
        let openMinterOutputs = toByteString('')
        let curStateHashes = toByteString('')
        let curStateCnt = 0n
        let totalAmount = 0n
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const amount = nextMinterAmounts[i]
            if (amount > 0n) {
                totalAmount += amount
                curStateCnt += 1n
                openMinterOutputs += TxUtil.buildOutput(
                    preScript,
                    minterSatoshis
                )
                curStateHashes += hash160(
                    OpenMinterProto.stateHash({
                        tokenScript: preState.tokenScript,
                        isPremined: true,
                        remainingSupply: amount,
                    })
                )
            }
        }
        // mint token
        let tokenOutput = toByteString('')
        if (tokenMint.amount > 0n) {
            totalAmount += tokenMint.amount
            curStateCnt += 1n
            curStateHashes += hash160(
                CAT20Proto.stateHash({
                    amount: tokenMint.amount,
                    ownerAddr: tokenMint.ownerAddr,
                })
            )
            tokenOutput = TxUtil.buildOutput(
                preState.tokenScript,
                tokenSatoshis
            )
        }
        if (!preState.isPremined && this.premine > 0n) {
            // premine need checksig
            assert(
                hash160(preminerPubKeyPrefix + preminerPubKey) ==
                    this.premineAddr
            )
            assert(this.checkSig(preminerSig, preminerPubKey))
            // first unlock mint
            assert(totalAmount == preState.remainingSupply + this.premine)
            assert(this.max == preState.remainingSupply + this.premine)
            assert(tokenMint.amount == this.premine)
        } else {
            // not first unlock mint
            assert(totalAmount == preState.remainingSupply)
            assert(tokenMint.amount <= this.limit)
        }
        const stateOutput = StateUtils.getCurrentStateOutput(
            curStateHashes,
            curStateCnt,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + openMinterOutputs + tokenOutput + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }

## Developer Notes
Ensure that you have the appropriate configuration for connecting to the Fractal Bitcoin network.
Review the sCrypt smart contract thoroughly to understand its security assumptions and execution model.

## Contact Info
### Twitter: https://x.com/ProDogeLover/
### Telegram: https://t.me/dogewhiz/
