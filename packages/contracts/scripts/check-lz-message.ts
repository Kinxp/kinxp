import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (!process.env.HEDERA_CREDIT_ADDR || !process.env.ORDER_ID_ETH) {
    throw new Error("Missing HEDERA_CREDIT_ADDR or ORDER_ID_ETH in .env");
  }

  console.log("=== Checking LayerZero Message Delivery ===\n");

  const orderIdEth = process.env.ORDER_ID_ETH;
  console.log("ETH Order ID:", orderIdEth);

  const hederaCredit = await ethers.getContractAt(
    "HederaCreditOApp",
    process.env.HEDERA_CREDIT_ADDR
  );

  try {
    console.log("\nChecking if order exists on Hedera...");
    const order = await hederaCredit.orders(orderIdEth);

    console.log("\nOrder on Hedera:");
    console.log("- User:", order.user || "Not set");
    console.log(
      "- Collateral Amount:",
      order.collateralAmount
        ? ethers.formatEther(order.collateralAmount) + " ETH"
        : "0"
    );
    console.log("- Is Active:", order.isActive || false);

    if (order.user && order.user !== ethers.ZeroAddress) {
      console.log("\n✅ LayerZero message delivered successfully!");
      console.log("Order exists on Hedera.");
      console.log("\n📝 You can skip test-2 and go directly to test-3!");
    } else {
      console.log("\n⚠️  Order not found on Hedera yet.");
      console.log("\nPossible reasons:");
      console.log("1. LayerZero message still in transit (wait 5-10 min)");
      console.log("2. Message delivery failed");
      console.log("3. HederaCreditOApp doesn't handle _lzReceive correctly");
      console.log("\n💡 Solution: Manually create order with test-2");
    }
  } catch (error: any) {
    console.error("\n❌ Error checking order:", error.message);
    console.log("\n💡 This might mean:");
    console.log("- Order doesn't exist on Hedera yet");
    console.log("- Run test-2 to manually create it");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
