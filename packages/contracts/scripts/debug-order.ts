// ============================================
// scripts/debug-order.ts
// Debug what's wrong with the order
// ============================================
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const ETH_COLLATERAL_ADDR = "0xFD0CeDeB9e6534b73A6b802345878Dfc348D1ef7";
  const ORDER_ID = "0x0b532d2134a67cbe1bb013ab5bec8f835f86eb509a3ac276bb206398960b985a";

  console.log("=== Debug Order ===\n");

  const [signer] = await ethers.getSigners();
  const userAddress = await signer.getAddress();
  console.log("User address:", userAddress);
  console.log("Order ID:", ORDER_ID);

  const ethCollateral = await ethers.getContractAt(
    "EthCollateralOApp",
    ETH_COLLATERAL_ADDR
  );

  try {
    // Read the order
    console.log("\nReading order from contract...");
    const order = await ethCollateral.orders(ORDER_ID);
    
    console.log("\nOrder Details:");
    console.log("- Owner:", order.owner);
    console.log("- Amount Wei:", order.amountWei.toString());
    console.log("- Funded:", order.funded);
    console.log("- Repaid:", order.repaid);
    console.log("- Liquidated:", order.liquidated);

    console.log("\n=== CHECKS ===");
    console.log("Owner matches user?", order.owner.toLowerCase() === userAddress.toLowerCase());
    console.log("Already funded?", order.funded);
    console.log("Amount is zero?", order.amountWei === 0n);

    // Check user's nonce
    const nonce = await ethCollateral.nonces(userAddress);
    console.log("\nUser nonce:", nonce.toString());

    // Try to simulate the funding call
    console.log("\n=== SIMULATING fundOrder CALL ===");
    try {
      await ethCollateral.fundOrder.staticCall(ORDER_ID, {
        value: ethers.parseEther("0.00001")
      });
      console.log("✅ Static call succeeded - should work in real tx");
    } catch (simError: any) {
      console.log("❌ Static call failed:");
      console.log(simError.message);
      
      // Try to decode the revert reason
      if (simError.data) {
        console.log("\nRevert data:", simError.data);
        
        // Try to decode custom error or revert string
        try {
          const iface = ethCollateral.interface;
          const decoded = iface.parseError(simError.data);
          console.log("Decoded error:", decoded);
        } catch (e) {
          // Try decoding as string
          try {
            const reason = ethers.toUtf8String("0x" + simError.data.slice(138));
            console.log("Revert reason:", reason);
          } catch (e2) {
            console.log("Could not decode error");
          }
        }
      }
    }

    // Check contract state
    console.log("\n=== CONTRACT STATE ===");
    const contractBalance = await ethers.provider.getBalance(ETH_COLLATERAL_ADDR);
    console.log("Contract ETH balance:", ethers.formatEther(contractBalance), "ETH");

    const hederaEid = await ethCollateral.hederaEid();
    console.log("Hedera EID:", hederaEid.toString());

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});