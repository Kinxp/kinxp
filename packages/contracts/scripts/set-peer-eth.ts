import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function getAddressFromEnv(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw || !ethers.isAddress(raw)) {
    throw new Error(`Missing or invalid ${name} in .env`);
  }
  return ethers.getAddress(raw);
}

function getEidFromEnv(name: string): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`Missing ${name} in .env`);
  }
  const eid = Number(raw);
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return eid;
}

async function main() {
  const ethCollateralAddr = getAddressFromEnv("ETH_COLLATERAL_ADDR");
  const hederaPeerAddr = getAddressFromEnv("HEDERA_CREDIT_ADDR");
  const hederaEid = getEidFromEnv("LZ_EID_HEDERA");

  console.log("=== Setting Hedera Peer on Ethereum ===\n");
  console.log("EthCollateral:", ethCollateralAddr);
  console.log("Hedera peer:", hederaPeerAddr);
  console.log("Hedera EID:", hederaEid);

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ethCollateralAddr
  );

  const peerBytes32 = ethers.zeroPadValue(hederaPeerAddr, 32);
  console.log("Peer as bytes32:", peerBytes32);

  const tx = await ethCollateral.setPeer(hederaEid, peerBytes32);
  console.log("Transaction sent:", tx.hash);
  await tx.wait();

  const stored = await ethCollateral.peers(hederaEid);
  console.log("\nVerification:");
  console.log("Stored peer:", stored);
  console.log("Match:", stored === peerBytes32 ? "✅" : "❌");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
