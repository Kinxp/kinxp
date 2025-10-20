import { ethers } from "hardhat";

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";
  const HEDERA_EID = 40285;

  console.log("=== Enabling LayerZero ===\n");

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  console.log("Setting Hedera EID to:", HEDERA_EID);
  const tx = await ethCollateral.setHederaEid(HEDERA_EID);

  console.log("Transaction sent:", tx.hash);
  await tx.wait();

  console.log("✅ LayerZero enabled!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
