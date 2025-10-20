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

  console.log("=== TEST 4: Repay USD on Hedera ===\n");

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
    const balance = await token.balanceOf(userAddress);
    console.log(
      "\nCurrent USD balance:",
      ethers.formatUnits(balance, 6),
      "hUSD"
    );

    if (balance === 0n) {
      throw new Error("No USD to repay! Run test-3 with withdraw first");
    }

    const order = await hederaCredit.orders(orderIdHedera);
    console.log("\nOrder details:");
    console.log("- Debt:", ethers.formatUnits(order.debtAmount, 6), "hUSD");
    console.log("- Active:", order.isActive);

    const repayAmount = order.debtAmount;
    console.log("\nRepaying:", ethers.formatUnits(repayAmount, 6), "hUSD");

    console.log("\nApproving token spending...");
    const approveTx = await token.approve(
      process.env.HEDERA_CREDIT_ADDR,
      repayAmount
    );
    await approveTx.wait();
    console.log("✅ Approval confirmed");

    console.log("\nRepaying USD...");
    const tx = await hederaCredit.repayCredit(orderIdHedera);

    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await token.balanceOf(userAddress);
    console.log(
      "\n🎉 USD REPAID!",
      "\nRemaining USD balance:",
      ethers.formatUnits(balanceAfter, 6),
      "hUSD"
    );

    const orderAfter = await hederaCredit.orders(orderIdHedera);
    console.log("Order active:", orderAfter.isActive);

    console.log("\n📝 NEXT STEPS:");
    console.log("1. Verify repayment on HashScan:");
    console.log(`   https://hashscan.io/testnet/transaction/${tx.hash}`);
    console.log("2. Backend should detect this and release ETH on Ethereum");
    console.log("3. Run: npm run test-5");
  } catch (error: any) {
    console.error("\n❌ Repayment failed:");
    console.error(error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
