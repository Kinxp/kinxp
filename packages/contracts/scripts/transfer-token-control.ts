import {
  AccountId,
  Client,
  ContractId,
  Hbar,
  PrivateKey,
  TokenId,
  TokenUpdateTransaction
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (
    !process.env.HEDERA_ACCOUNT_ID ||
    !process.env.HEDERA_ECDSA_KEY ||
    !process.env.USD_CONTROLLER_ADDR ||
    !process.env.USD_TOKEN_ID
  ) {
    throw new Error("Missing required environment variables");
  }

  const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(
    process.env.HEDERA_ECDSA_KEY.replace(/^0x/, "")
  );

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(100));

  const tokenId = TokenId.fromString(process.env.USD_TOKEN_ID);
  const controllerAddress = process.env.USD_CONTROLLER_ADDR;
  const controllerContractId = ContractId.fromEvmAddress(
    0,
    0,
    controllerAddress
  );

  console.log("Transferring token control to UsdHtsController...");
  console.log(`- Token ID: ${tokenId.toString()}`);
  console.log(`- Controller Contract: ${controllerContractId.toString()}`);

  try {
    const tokenUpdateTx = await new TokenUpdateTransaction()
      .setTokenId(tokenId)
      .setSupplyKey(controllerContractId)
      .setTreasuryAccountId(operatorId)
      .freezeWith(client);

    const tokenUpdateSign = await tokenUpdateTx.sign(operatorKey);
    const tokenUpdateSubmit = await tokenUpdateSign.execute(client);
    const tokenUpdateReceipt = await tokenUpdateSubmit.getReceipt(client);

    console.log("\n✅ Token control transferred successfully!");
    console.log(`Status: ${tokenUpdateReceipt.status.toString()}`);

    console.log("\n🎉 SETUP COMPLETE!");
    console.log("\nThe UsdHtsController can now:");
    console.log("- Mint tokens (via supply key)");
    console.log("- Burn tokens (via supply key)");
    console.log("\nYour operator account remains the treasury.");
  } catch (error: any) {
    console.error("\n❌ Token control transfer failed:");
    console.error(`Error: ${error.message}`);
    if (error.status) {
      console.error(`Status: ${error.status.toString()}`);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("\n❌ SCRIPT FAILED:");
  console.error(error);
  process.exitCode = 1;
});
