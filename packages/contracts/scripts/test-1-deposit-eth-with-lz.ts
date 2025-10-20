// scripts/test-1-deposit-eth-with-lz.ts
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR =
    process.env.ETH_COLLATERAL_ADDR ||
    "0x0000000000000000000000000000000000000000"; // override in .env
  const DEPOSIT_ETH = (process.env.DEPOSIT_ETH || "0.00001").trim();

  console.log("=== TEST 1: Deposit ETH on Ethereum (with LayerZero) ===\n");

  // signer + balance
  const [signer] = await ethers.getSigners();
  const userAddress = await signer.getAddress();
  const balance = await ethers.provider.getBalance(userAddress);
  console.log("User address:", userAddress);
  console.log("ETH balance:", ethers.formatEther(balance), "ETH");

  const depositAmount = ethers.parseEther(DEPOSIT_ETH);
  console.log("Depositing:", ethers.formatEther(depositAmount), "ETH");

  if (
    !ETH_COLLATERAL_ADDR ||
    ETH_COLLATERAL_ADDR === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("ETH_COLLATERAL_ADDR missing. Put it in packages/contracts/.env");
  }

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  try {
    const hederaEid: bigint = await (ethCollateral as any).hederaEid();
    console.log("\nHedera EID:", hederaEid.toString());

    // Step 1: create order
    console.log("\n=== Step 1: Creating Order ID ===");
    const createTx = await ethCollateral.createOrderId();
    console.log("Transaction sent:", createTx.hash);
    const createReceipt = await createTx.wait();

    const createEvent = createReceipt.logs
      .map((log: any) => {
        try {
          return ethCollateral.interface.parseLog({ data: log.data, topics: [...log.topics] });
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "OrderCreated");
    if (!createEvent) throw new Error("OrderCreated event not found");

    const orderId: `0x${string}` =
      (createEvent.args?.orderId as `0x${string}`) ??
      (createEvent.args?.[0] as `0x${string}`);
    console.log("✅ Order ID:", orderId);

    if (hederaEid === 0n) {
      console.log("\n⚠️  Hedera EID is 0 — LayerZero disabled");
      console.log("Using simple fundOrder without LZ...");
      const fundTx = await ethCollateral.fundOrder(orderId, { value: depositAmount });
      console.log("Transaction sent:", fundTx.hash);
      await fundTx.wait();
      console.log("✅ Order funded!");
      console.log("\n📋 SAVE THIS:");
      console.log(`ORDER_ID_ETH=${orderId}`);
      return;
    }

    // Step 2: LZ path — quote fee
    console.log("\n=== Step 2: Funding with LayerZero ===");
    const nativeFee: bigint = await (ethCollateral as any).quoteOpenNativeFee(
      userAddress,
      depositAmount
    );
    const buffer = nativeFee / 20n; // 5%
    let totalValue = depositAmount + nativeFee + buffer;

    console.log("Amounts:");
    console.log("  - Deposit:", ethers.formatEther(depositAmount), "ETH");
    console.log("  - LZ Fee (quote):", ethers.formatEther(nativeFee), "ETH");
    console.log("  - Buffer (5%):", ethers.formatEther(buffer), "ETH");
    console.log("  - Total:", ethers.formatEther(totalValue), "ETH");

    if (balance < totalValue) {
      throw new Error(
        `Insufficient balance. Need ${ethers.formatEther(totalValue)} ETH, have ${ethers.formatEther(balance)} ETH`
      );
    }

    // --- helper to staticCall and decode NotEnoughNative(required) ---
    const tryStatic = async (value: bigint) => {
      try {
        await (ethCollateral as any).fundOrderWithNotify.staticCall(
          orderId,
          depositAmount,
          { value }
        );
        return { ok: true as const, value };
      } catch (e: any) {
        let required: bigint | null = null;
        try {
          const decoded = ethCollateral.interface.parseError(e.data);
          if (decoded?.name === "NotEnoughNative" && decoded.args?.length) {
            required = BigInt(decoded.args[0].toString());
            console.error("❌ Static call NotEnoughNative. Required:", required.toString(), "wei");
          } else {
            console.error("❌ Static call failed:", e.message);
          }
        } catch {
          console.error("❌ Static call failed:", e?.message || e);
        }
        return { ok: false as const, required };
      }
    };

    // 1st attempt: quote + buffer
    let pre = await tryStatic(totalValue);

    if (!pre.ok && pre.required) {
      const bump = pre.required / 20n + 1_000_000_000n; // +5% + safety cushion
      totalValue = pre.required + bump;
      console.log(
        "🔁 Retrying static call with additional buffer:",
        bump.toString(),
        "wei (total",
        totalValue.toString(),
        "wei)"
      );
      pre = await tryStatic(totalValue);
    }

    if (!pre.ok) {
      throw new Error(
        "Pre-flight check failed. Transaction would revert. Increase msg.value using the 'required' amount if provided."
      );
    }
    console.log("✅ Static call passed");

    // Send real tx
    console.log("\nSending real transaction...");
    const fundTx = await (ethCollateral as any).fundOrderWithNotify(
      orderId,
      depositAmount,
      {
        value: totalValue,
        gasLimit: 600_000,
      }
    );
    console.log("Transaction sent:", fundTx.hash);
    const fundReceipt = await fundTx.wait();
    if (fundReceipt.status === 0) throw new Error("Transaction reverted");

    console.log("✅ Transaction confirmed!");
    console.log("Gas used:", fundReceipt.gasUsed.toString());

    const fundEvent = fundReceipt.logs
      .map((log: any) => {
        try {
          return ethCollateral.interface.parseLog({ data: log.data, topics: [...log.topics] });
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "OrderFunded");

    if (fundEvent) {
      console.log("\n🎉 ORDER FUNDED WITH LAYERZERO!");
      console.log("Order ID:", fundEvent.args.orderId);
      console.log("Amount:", ethers.formatEther(fundEvent.args.amountWei), "ETH");
    }

    console.log("\n🔗 Check LayerZero message status:");
    console.log(`https://testnet.layerzeroscan.com/tx/${fundTx.hash}`);

    console.log("\n📋 SAVE THIS:");
    console.log(`ORDER_ID_ETH=${orderId}`);
  } catch (error: any) {
    console.error("\n❌ Failed!");
    console.error("Error:", error.message);

    if (error.receipt) {
      console.log("\nTransaction mined but reverted");
      console.log("TX:", error.receipt.hash);
      console.log(`https://sepolia.etherscan.io/tx/${error.receipt.hash}`);
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
