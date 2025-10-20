import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";

  if (!process.env.ORDER_ID_ETH) {
    throw new Error("Missing ORDER_ID_ETH in .env");
  }

  console.log("=== TEST 5: Withdraw ETH on Ethereum ===\n");

  const [signer] = await ethers.getSigners();
  const userAddress = await signer.getAddress();
  const orderIdEth = process.env.ORDER_ID_ETH;

  console.log("User address:", userAddress);
  console.log("ETH Order ID:", orderIdEth);

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  try {
    console.log("\nChecking order status...");
    const order = await ethCollateral.orders(orderIdEth);
    console.log("Order details:");
    console.log("- Owner:", order.owner);
    console.log("- Amount:", ethers.formatEther(order.amountWei), "ETH");
    console.log("- Funded:", order.funded);
    console.log("- Repaid:", order.repaid);
    console.log("- Liquidated:", order.liquidated);

    if (!order.repaid) {
      console.log("\n⚠️  Order not marked as repaid yet!");
      console.log("This happens when:");
      console.log("1. USD hasn't been repaid on Hedera, OR");
      console.log("2. LayerZero message from Hedera hasn't arrived yet");
      console.log("\nYou can:");
      console.log("- Wait for LayerZero message propagation");
      console.log("- Check LayerZero scan for message status");
      console.log("- For testing: manually mark as repaid (see test-5b script)");
      return;
    }

    const balanceBefore = await ethers.provider.getBalance(userAddress);
    console.log(
      "\nETH balance before:",
      ethers.formatEther(balanceBefore),
      "ETH"
    );

    console.log("\nWithdrawing ETH...");
    const tx = await ethCollateral.withdraw(orderIdEth);

    console.log("Transaction sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await ethers.provider.getBalance(userAddress);
    const received = balanceAfter - balanceBefore;

    console.log("\n🎉 ETH WITHDRAWN!");
    console.log(
      "ETH balance after:",
      ethers.formatEther(balanceAfter),
      "ETH"
    );
    console.log(
      "Net change (minus gas):",
      ethers.formatEther(received),
      "ETH"
    );

    console.log("\n✅ FULL FLOW COMPLETED SUCCESSFULLY!");
    console.log("\n📊 Summary:");
    console.log("1. ✅ Deposited ETH on Ethereum");
    console.log("2. ✅ Created order on Hedera");
    console.log("3. ✅ Withdrew USD on Hedera");
    console.log("4. ✅ Repaid USD on Hedera");
    console.log("5. ✅ Withdrew ETH on Ethereum");
  } catch (error: any) {
    console.error("\n❌ Withdrawal failed:");
    console.error(error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
