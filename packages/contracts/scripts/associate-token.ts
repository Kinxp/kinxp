import { ethers } from "hardhat";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (
    !process.env.HEDERA_ACCOUNT_ID ||
    !process.env.HEDERA_ECDSA_KEY ||
    !process.env.USD_CONTROLLER_ADDR ||
    !process.env.USD_TOKEN_ADDR
  ) {
    throw new Error("Missing required environment variables");
  }

  const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(
    process.env.HEDERA_ECDSA_KEY.replace(/^0x/, "")
  );

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(100));

  const controllerAddress = process.env.USD_CONTROLLER_ADDR;
  const tokenAddress = process.env.USD_TOKEN_ADDR;

  console.log("Associating token with UsdHtsController...");
  console.log(`- Controller: ${controllerAddress}`);
  console.log(`- Token: ${tokenAddress}`);

  try {
    const controller = await ethers.getContractAt(
      "UsdHtsController",
      controllerAddress
    );

    const tx = await controller.associateToken(tokenAddress);
    console.log("\nTransaction sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Token associated successfully!");
    console.log("Gas used:", receipt.gasUsed.toString());

    console.log("\n📋 NEXT STEP:");
    console.log("Run: npm run transfer-token-control");
  } catch (error: any) {
    console.error("\n❌ Association failed:");
    console.error(error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error("\n❌ SCRIPT FAILED:");
  console.error(error);
  process.exitCode = 1;
});
