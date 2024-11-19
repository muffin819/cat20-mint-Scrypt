import { hash160 } from 'scrypt-ts'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import { btc } from '../../src/lib/btc'

export type KeyInfo = {
    addr: btc.Address
    seckey: btc.PrivateKey
    pubkey: btc.PublicKey
    pubKeyPrefix: string
    pubkeyX: string
    xAddress: string
}

export function getPrivKey() {
    dotenv.config({
        path: '.env',
    })
    const privKeyStr = process.env.PRIVATE_KEY
    if (privKeyStr) {
        return privKeyStr
    } else {
        const privKey = btc.PrivateKey.fromRandom(btc.Networks.testnet)
        fs.writeFileSync('.env', `PRIVATE_KEY="${privKey.toWIF()}"`)
        return privKey.toWIF()
    }
}

export function getP2TRKeyInfoFromWif(wif: string): KeyInfo {
    const seckey = new btc.PrivateKey(wif, btc.Networks.testnet)
    const { tweakedPrivKey } = seckey.createTapTweak()
    const privkey = btc.PrivateKey.fromBuffer(tweakedPrivKey)
    const pubkey = privkey.toPublicKey()
    const addrP2TR = seckey.toAddress(null, btc.Address.PayToTaproot)
    const pubKeyPrefix = pubkey.toString().slice(0, 2)
    const pubkeyX = btc.Script.fromAddress(addrP2TR)
        .getPublicKeyHash()
        .toString('hex')
    const xAddress = hash160(pubkeyX)
    const res = {
        addr: addrP2TR,
        seckey: privkey,
        pubkey: pubkey,
        pubKeyPrefix: '',
        pubkeyX: pubkeyX,
        xAddress: xAddress,
    }

    return res
}

export function getKeyInfoFromWif(wif: string): KeyInfo {
    const seckey = new btc.PrivateKey(wif, btc.Networks.testnet)
    const pubkey = seckey.toPublicKey()
    const addrP2WPKH = seckey.toAddress(
        null,
        btc.Address.PayToWitnessPublicKeyHash
    )
    const pubKeyPrefix = pubkey.toString().slice(0, 2)
    const pubkeyX = pubkey.toString().slice(2)
    const xAddress = hash160(pubkey.toString())
    return {
        addr: addrP2WPKH,
        seckey: seckey,
        pubkey: pubkey,
        pubKeyPrefix: pubKeyPrefix,
        pubkeyX: pubkeyX,
        xAddress: xAddress,
    }
}

export function getLegacyKeyInfoFromWif(wif: string): KeyInfo {
    const seckey = new btc.PrivateKey(wif, btc.Networks.testnet)
    const pubkey = seckey.toPublicKey()
    const addrP2WPKH = seckey.toAddress(null, btc.Address.PayToPublicKeyHash)
    const pubKeyPrefix = pubkey.toString().slice(0, 2)
    const pubkeyX = pubkey.toString().slice(2)
    const xAddress = hash160(pubkey.toString())
    return {
        addr: addrP2WPKH,
        seckey: seckey,
        pubkey: pubkey,
        pubKeyPrefix: pubKeyPrefix,
        pubkeyX: pubkeyX,
        xAddress: xAddress,
    }
}
