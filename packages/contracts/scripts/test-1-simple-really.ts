import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";
  const DEPOSIT_ETH = process.env.DEPOSIT_ETH || "0.00001";

  console.log("=== TEST 1: Simple Deposit (Disabling LayerZero) ===\n");

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  const depositAmount = ethers.parseEther(DEPOSIT_ETH);

  try {
    console.log("Disabling LayerZero temporarily...");
    const disableTx = await ethCollateral.setHederaEid(0);
    await disableTx.wait();
    console.log("✅ LayerZero disabled\n");

    console.log("Creating order ID...");
    const createTx = await ethCollateral.createOrderId();
    const createReceipt = await createTx.wait();

    const createEvent = createReceipt.logs
      .map((log: any) => {
        try {
          return ethCollateral.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "OrderCreated");

    if (!createEvent) {
      throw new Error("OrderCreated event not found");
    }

    const orderId = createEvent.args.orderId;
    console.log("✅ Order ID:", orderId);

    console.log("\nFunding order...");
    const fundTx = await ethCollateral.fundOrder(orderId, {
      value: depositAmount
    });

    const fundReceipt = await fundTx.wait();
    console.log("✅ Order funded!");
    console.log("TX:", fundTx.hash);

    console.log("\n📋 SAVE THIS:");
    console.log(`ORDER_ID_ETH=${orderId}`);

    console.log("\n✅ SUCCESS! Order created and funded.");
    console.log("\n📝 NEXT: Run test-2 to create order on Hedera");
    console.log("\n⚠️  To re-enable LayerZero later:");
    console.log("await ethCollateral.setHederaEid(40285)");
  } catch (error: any) {
    console.error("\n❌ Failed:", error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
