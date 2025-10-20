import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (
    !process.env.HEDERA_ACCOUNT_ID ||
    !process.env.HEDERA_ECDSA_KEY ||
    !process.env.USD_CONTROLLER_ADDR
  ) {
    throw new Error(
      "Please ensure HEDERA_ACCOUNT_ID, HEDERA_ECDSA_KEY, and USD_CONTROLLER_ADDR are set in .env"
    );
  }

  const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(
    process.env.HEDERA_ECDSA_KEY.replace(/^0x/, "")
  );

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(100));

  console.log("Creating HTS token...");
  console.log(`- Operator Account: ${operatorId.toString()}`);
  console.log(`- Treasury: ${operatorId.toString()}`);

  try {
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName("Hedera Stable USD (KINXP)")
      .setTokenSymbol("hUSD")
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(0)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(operatorKey)
      .setAdminKey(operatorKey)
      .setAutoRenewAccountId(operatorId)
      .setAutoRenewPeriod(7776000)
      .freezeWith(client);

    const tokenCreateSign = await tokenCreateTx.sign(operatorKey);
    const tokenCreateSubmit = await tokenCreateSign.execute(client);
    const tokenCreateReceipt = await tokenCreateSubmit.getReceipt(client);
    const tokenId = tokenCreateReceipt.tokenId;

    if (!tokenId) {
      throw new Error("Token creation failed!");
    }

    const tokenAddress = tokenId.toSolidityAddress();
    console.log(`\n✅ Token created successfully!`);
    console.log(`- Token ID: ${tokenId.toString()}`);
    console.log(`- Token EVM Address: 0x${tokenAddress}`);

    console.log("\n📋 ADD TO .env FILE:");
    console.log(`USD_TOKEN_ADDR=0x${tokenAddress}`);
    console.log(`USD_TOKEN_ID=${tokenId.toString()}`);

    console.log("\n⚠️  IMPORTANT NEXT STEPS:");
    console.log("1. Add USD_TOKEN_ADDR and USD_TOKEN_ID to your .env");
    console.log("2. Run: npm run associate-token");
    console.log("3. Run: npm run transfer-token-control");
  } catch (error: any) {
    console.error("\n❌ Token creation failed:");
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
