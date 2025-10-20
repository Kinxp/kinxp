import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";

  if (!process.env.ORDER_ID_ETH) {
    throw new Error("Missing ORDER_ID_ETH in .env");
  }

  console.log("=== TEST 6: Liquidation Scenario ===\n");

  const [signer] = await ethers.getSigners();
  const adminAddress = await signer.getAddress();
  const orderIdEth = process.env.ORDER_ID_ETH;

  console.log("Admin address:", adminAddress);
  console.log("ETH Order ID:", orderIdEth);

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  try {
    const order = await ethCollateral.orders(orderIdEth);
    console.log("\nOrder status:");
    console.log("- Amount:", ethers.formatEther(order.amountWei), "ETH");
    console.log("- Funded:", order.funded);
    console.log("- Repaid:", order.repaid);
    console.log("- Liquidated:", order.liquidated);

    if (order.repaid) {
      console.log("\n⚠️  Order already repaid, cannot liquidate");
      return;
    }

    if (order.liquidated) {
      console.log("\n⚠️  Order already liquidated");
      return;
    }

    console.log("\nLiquidating position...");
    console.log("Sending ETH to admin:", adminAddress);

    const tx = await ethCollateral.adminLiquidate(orderIdEth, adminAddress);

    console.log("Transaction sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", receipt.gasUsed.toString());

    const event = receipt.logs
      .map((log: any) => {
        try {
          return ethCollateral.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "Liquidated");

    if (event) {
      console.log("\n🎉 LIQUIDATION COMPLETED!");
      console.log("Order ID:", event.args.orderId);
      console.log("Amount:", ethers.formatEther(event.args.amountWei), "ETH");

      console.log("\n📝 What happened:");
      console.log("1. ETH collateral seized");
      console.log("2. Order marked as liquidated");
      console.log("3. User can no longer withdraw ETH");
      console.log("4. User keeps the borrowed USD on Hedera");
    }
  } catch (error: any) {
    console.error("\n❌ Liquidation failed:");
    console.error(error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
