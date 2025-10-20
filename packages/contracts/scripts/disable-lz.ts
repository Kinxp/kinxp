import { ethers } from "hardhat";

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";

  console.log("=== Disabling LayerZero ===\n");

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  const currentEid = await ethCollateral.hederaEid();
  console.log("Current Hedera EID:", currentEid.toString());

  if (currentEid === 0n) {
    console.log("✅ Already disabled!");
    return;
  }

  console.log("\nSetting Hedera EID to 0...");
  const tx = await ethCollateral.setHederaEid(0);

  console.log("Transaction sent:", tx.hash);
  await tx.wait();

  console.log("✅ LayerZero disabled!");
  console.log("\nNow you can use fundOrder() without LZ fees.");
  console.log("To re-enable: pnpm --filter @kinxp/contracts run enable-lz");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
