#!/bin/bash

npx scrypt-cli compile -t tsconfig-fxpTS.json -i src/contracts/token/FXPBuyGuard.ts,src/contracts/token/FXPSellGuard.ts
node compile-fxp-guard.js
npx scrypt-cli compile
