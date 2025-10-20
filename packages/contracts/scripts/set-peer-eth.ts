import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";
  const HEDERA_EID = 40285;

  if (!process.env.HEDERA_CREDIT_ADDR) {
    throw new Error("Missing HEDERA_CREDIT_ADDR in .env");
  }

  console.log("=== Setting Hedera Peer on Ethereum ===\n");

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  const hederaCreditAddr = process.env.HEDERA_CREDIT_ADDR;
  console.log("Hedera Credit Address:", hederaCreditAddr);
  console.log("Hedera EID:", HEDERA_EID);

  const peerBytes32 = ethers.zeroPadValue(hederaCreditAddr, 32);
  console.log("Peer as bytes32:", peerBytes32);

  try {
    console.log("\nSetting peer...");
    const tx = await ethCollateral.setPeer(HEDERA_EID, peerBytes32);

    console.log("Transaction sent:", tx.hash);
    await tx.wait();

    console.log("✅ Peer set successfully!");

    const peer = await ethCollateral.peers(HEDERA_EID);
    console.log("\nVerification:");
    console.log("Stored peer:", peer);
    console.log("Expected peer:", peerBytes32);
    console.log("Match:", peer === peerBytes32 ? "✅" : "❌");
  } catch (error: any) {
    console.error("\n❌ Failed:", error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
