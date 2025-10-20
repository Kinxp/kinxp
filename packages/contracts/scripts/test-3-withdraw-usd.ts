import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (
    !process.env.HEDERA_CREDIT_ADDR ||
    !process.env.ORDER_ID_HEDERA ||
    !process.env.USD_TOKEN_ADDR
  ) {
    throw new Error("Missing required environment variables");
  }

  console.log("=== TEST 3: Withdraw USD on Hedera ===\n");

  const [signer] = await ethers.getSigners();
  const userAddress = await signer.getAddress();
  const orderIdHedera = process.env.ORDER_ID_HEDERA;

  console.log("User address:", userAddress);
  console.log("Hedera Order ID:", orderIdHedera);

  const hederaCredit = await ethers.getContractAt(
    "HederaCreditOApp",
    process.env.HEDERA_CREDIT_ADDR
  );

  const token = await ethers.getContractAt(
    "IERC20",
    process.env.USD_TOKEN_ADDR
  );

  try {
    const balanceBefore = await token.balanceOf(userAddress);
    console.log(
      "\nUSD balance before:",
      ethers.formatUnits(balanceBefore, 6),
      "hUSD"
    );

    const order = await hederaCredit.orders(orderIdHedera);
    console.log("\nOrder details:");
    console.log("- User:", order.user);
    console.log("- Collateral:", ethers.formatEther(order.collateralAmount), "ETH");
    console.log("- Active:", order.isActive);

    if (!order.isActive) {
      throw new Error("Order is not active!");
    }

    console.log("\n⚠️  Note: Using empty price update for testing");
    console.log("In production, fetch real Pyth price data");

    const priceUpdateData: string[] = [];
    const updateFee = 0;

    console.log("\nWithdrawing USD...");
    const tx = await hederaCredit.withdrawCredit(
      orderIdHedera,
      priceUpdateData,
      { value: updateFee }
    );

    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await token.balanceOf(userAddress);
    const received = balanceAfter - balanceBefore;

    console.log("\n🎉 USD WITHDRAWN!");
    console.log(
      "USD balance after:",
      ethers.formatUnits(balanceAfter, 6),
      "hUSD"
    );
    console.log(
      "Amount received:",
      ethers.formatUnits(received, 6),
      "hUSD"
    );

    console.log("\n📝 NEXT STEPS:");
    console.log("Test repayment flow:");
    console.log("- Run: npm run test-4");
  } catch (error: any) {
    console.error("\n❌ Withdrawal failed:");
    console.error(error.message);

    if (error.message.includes("Pyth")) {
      console.log("\n💡 TIP: You need valid Pyth price data");
      console.log("For testing, you can modify the contract to skip price checks");
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
