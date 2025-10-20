import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (!process.env.HEDERA_CREDIT_ADDR || !process.env.ORDER_ID_ETH) {
    throw new Error("Missing HEDERA_CREDIT_ADDR or ORDER_ID_ETH in .env");
  }

  console.log("=== TEST 2: Create Order on Hedera ===\n");

  const [signer] = await ethers.getSigners();
  const userAddress = await signer.getAddress();
  const orderIdEth = process.env.ORDER_ID_ETH;

  console.log("User address:", userAddress);
  console.log("ETH Order ID:", orderIdEth);

  const hederaCredit = await ethers.getContractAt(
    "HederaCreditOApp",
    process.env.HEDERA_CREDIT_ADDR
  );

  try {
    console.log("\nCreating order on Hedera...");
    const collateralAmount = ethers.parseEther(
      process.env.DEPOSIT_ETH || "0.00001"
    );

    const tx = await hederaCredit.createOrder(
      userAddress,
      collateralAmount,
      orderIdEth
    );

    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", receipt.gasUsed.toString());

    const event = receipt.logs
      .map((log: any) => {
        try {
          return hederaCredit.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "OrderCreated");

    if (event) {
      const orderIdHedera = event.args.orderId;
      console.log("\n🎉 HEDERA ORDER CREATED!");
      console.log("Order ID:", orderIdHedera.toString());
      console.log("User:", event.args.user);
      console.log(
        "Collateral:",
        ethers.formatEther(event.args.collateralAmount),
        "ETH"
      );

      console.log("\n📋 SAVE THIS ORDER ID:");
      console.log(`ORDER_ID_HEDERA=${orderIdHedera.toString()}`);

      console.log("\n📝 NEXT STEPS:");
      console.log("1. Add ORDER_ID_HEDERA to your .env file");
      console.log("2. Verify on HashScan (Hedera):");
      console.log(`   https://hashscan.io/testnet/transaction/${tx.hash}`);
      console.log("3. Run: npm run test-3");
    }
  } catch (error: any) {
    console.error("\n❌ Order creation failed:");
    console.error(error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
