// one-off script: scripts/hedera-set-existing-usd.ts
import { ethers } from "hardhat";
async function main() {
  const controller = await ethers.getContractAt("UsdHtsController", process.env.USD_CONTROLLER_ADDR!);
  const token = process.env.USD_TOKEN_ADDR!; // the HTS token you created (EVM-format)
  const decimals = 6;
  const tx = await (controller as any).setExistingUsdToken(token, decimals);
  await tx.wait();
  console.log("Registered USD token:", token);
}
main().catch(e => { console.error(e); process.exit(1); });
