import {
  Client,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  AccountId,
  ContractId, // <--- IMPORT THE CORRECT TYPE
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (
    !process.env.HEDERA_ACCOUNT_ID ||
    !process.env.HEDERA_ECDSA_KEY ||
    !process.env.USD_CONTROLLER_ADDR
  ) {
    // This check is now more specific in the deploy script, but good to keep.
    throw new Error(
      `Please ensure HEDERA_ACCOUNT_ID, HEDERA_ECDSA_KEY, and USD_CONTROLLER_ADDR are set in packages/contracts/.env`
    );
  }

  const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(
    process.env.HEDERA_ECDSA_KEY.replace(/^0x/, "") // Safely remove 0x prefix
  );

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  const controllerAddress = process.env.USD_CONTROLLER_ADDR;
  
  // Create an AccountId for the treasury
  const controllerAccountId = AccountId.fromEvmAddress(0, 0, controllerAddress);

  // FIX: Create a ContractId to use as the Supply Key
  const controllerContractId = ContractId.fromEvmAddress(0, 0, controllerAddress);

  console.log("Creating HTS token with the following properties:");
  console.log(`- Treasury Account: ${controllerAccountId.toString()}`);
  console.log(`- Supply Key: Contract ID ${controllerContractId.toString()}`);
  console.log(`- Auto-Renew Account: ${operatorId.toString()}`);

  const tx = await new TokenCreateTransaction()
    .setTokenName("Hedera Stable USD (KINXP)")
    .setTokenSymbol("hUSD")
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(controllerAccountId) // Correctly use AccountId here
    .setSupplyKey(controllerContractId) // FIX: Correctly use ContractId for the key
    .setAutoRenewAccountId(operatorId)
    .setAutoRenewPeriod(7776000)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const tokenId = receipt.tokenId;

  if (!tokenId) {
    throw new Error("Token creation failed! Receipt did not contain a token ID.");
  }

  const tokenAddress = tokenId.toSolidityAddress();
  console.log(`\n✅ SUCCESS! Token created.`);
  console.log(`- Token ID: ${tokenId.toString()}`);
  console.log(`- Token EVM Address: ${tokenAddress}`);

  console.log(
    "\nACTION REQUIRED: Please add the following line to your .env file:"
  );
  console.log(`USD_TOKEN_ADDR=${tokenAddress}`);
}

main().catch((error) => {
  console.error("\n❌ SCRIPT FAILED:");
  console.error(error);
  process.exitCode = 1;
});