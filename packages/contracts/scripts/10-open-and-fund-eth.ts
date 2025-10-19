// scripts/10-open-and-fund-eth.ts
import { ethers } from "hardhat";

function as0x(s: string) { return (s.startsWith("0x") ? s : ("0x"+s)) as `0x${string}`; }

async function main() {
  const ethAddr = process.env.ETH_COLLATERAL_ADDR!;
  if (!ethAddr) throw new Error("ETH_COLLATERAL_ADDR missing in .env");

  const depositStr = (process.env.DEPOSIT_ETH ?? "0.5").trim();
  const value = ethers.parseEther(depositStr);
  if (value <= 0n) throw new Error(`DEPOSIT_ETH must be > 0, got ${depositStr}`);

  const [user] = await ethers.getSigners();
  console.log("Signer:", user.address);

  const eth = await ethers.getContractAt("EthCollateralOApp", ethAddr);

  // 1) Create order (read id from event to avoid any mismatch)
  const tx = await eth.connect(user).createOrderId();
const rc = await tx.wait();
  const iface = eth.interface;
  let orderId: `0x${string}` | null = null;

  for (const log of rc!.logs) {
    try {
      const parsed = iface.parseLog({ data: log.data, topics: [...log.topics] });
      if (parsed?.name === "OrderCreated") {
        orderId = parsed.args[0] as `0x${string}`; // bytes32 indexed orderId
        break;
      }
    } catch {}
  }
  if (!orderId) throw new Error("OrderCreated event not found in receipt");
  console.log("Order ID:", orderId);

  // 2) Sanity: read back the order owner
  const o = await (eth as any).orders(orderId);
  console.log("Order owner on-chain:", o.owner);
  if (o.owner.toLowerCase() !== user.address.toLowerCase()) {
    throw new Error("Order owner != current signer (did you use a different account?)");
  }

  console.log(`Funding with ${depositStr} ETH...`);
  try {
    const fundTx = await eth.connect(user).fundOrder(orderId, { value });
    const fundRc = await fundTx.wait();
    console.log("Funded. Tx hash:", fundRc!.hash);
  } catch (err: any) {
    // Try to extract revert reason if present
    const m = (err?.error?.message || err?.shortMessage || err?.message || "").toString();
    console.error("fundOrder reverted. Details:", m);
    if (m.includes("not owner")) console.error("→ This signer is not the order owner.");
    if (m.includes("already funded")) console.error("→ You already funded this orderId.");
    if (m.includes("no ETH")) console.error("→ You didn’t send value (or it was 0).");
    throw err;
  }

  // Save id for later steps
  const fs = await import("fs");
  fs.writeFileSync("order-id.txt", orderId);
  console.log("Saved order-id.txt");
}

main().catch((e) => { console.error(e); process.exit(1); });
