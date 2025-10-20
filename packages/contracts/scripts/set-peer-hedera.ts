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
  const hederaCreditAddr = getAddressFromEnv("HEDERA_CREDIT_ADDR");
  const ethCollateralAddr = getAddressFromEnv("ETH_COLLATERAL_ADDR");
  const ethEid = getEidFromEnv("LZ_EID_ETHEREUM");

  console.log("=== Setting Ethereum Peer on Hedera ===\n");
  console.log("HederaCredit:", hederaCreditAddr);
  console.log("EthCollateral:", ethCollateralAddr);
  console.log("Ethereum EID:", ethEid);

  const hederaCredit = await ethers.getContractAt(
    "HederaCreditOApp",
    hederaCreditAddr
  );

  const peerBytes32 = ethers.zeroPadValue(ethCollateralAddr, 32);
  console.log("Peer as bytes32:", peerBytes32);

  const tx = await hederaCredit.setPeer(ethEid, peerBytes32);
  console.log("Transaction sent:", tx.hash);
  await tx.wait();

  const stored = await hederaCredit.peers(ethEid);
  console.log("\nVerification:");
  console.log("Stored peer:", stored);
  console.log("Match:", stored === peerBytes32 ? "✅" : "❌");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
