const fs = require("fs");
const { TaprootSmartContract } = require("./dist/lib/catTx");
const { FXPBuyGuard, FXPSellGuard } = require("./dist");

const path = `./artifacts/contracts/token/FXPGuardLockingScript.json`;

const basePath = "./src/contracts/token";
const updates = ["FXPOpenMinter.ts", "FXPCat20Buy.ts", "FXPCat20Sell.ts"];

const read = () => {
  return JSON.parse(fs.readFileSync(path).toString("utf8"));
};

const write = (data) => {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
};

const run = () => {
  const data = read();
  const buyContract = TaprootSmartContract.create(new FXPBuyGuard());
  const sellContract = TaprootSmartContract.create(new FXPSellGuard());

  console.log(data);

  for (const update of updates) {
    const content = fs.readFileSync(`${basePath}/${update}`).toString("utf8");
    fs.writeFileSync(
      `${basePath}/${update}`,
      content
        .replace(data.buy, buyContract.lockingScriptHex)
        .replace(data.sell, sellContract.lockingScriptHex)
    );
  }

  write({
    buy: buyContract.lockingScriptHex,
    sell: sellContract.lockingScriptHex,
  });
};

run();
