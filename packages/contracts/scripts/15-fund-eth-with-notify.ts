import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const ethAddr = process.env.ETH_COLLATERAL_ADDR!;
  if (!ethAddr) throw new Error("ETH_COLLATERAL_ADDR missing");
  const depositStr = (process.env.DEPOSIT_ETH ?? "0.00001").trim();
  const deposit = ethers.parseEther(depositStr);

  const [user] = await ethers.getSigners();
  const eth = await ethers.getContractAt("EthCollateralOApp", ethAddr);

  // 1) Create order
  const tx = await eth.connect(user).createOrderId();
  const rc = await tx.wait();
  const evt = rc!.logs
    .map((l) => { try { return eth.interface.parseLog({ data: l.data, topics: [...l.topics] }); } catch { return null; } })
    .find((p) => p && p.name === "OrderCreated");
  if (!evt) throw new Error("OrderCreated not found");
  const orderId = evt!.args[0] as `0x${string}`;
  console.log("Order ID:", orderId);

  // 2) Quote LZ native fee
  const nativeFee: bigint = await (eth as any).quoteOpenNativeFee(user.address, deposit);
  const buffer = nativeFee / 20n; // +5% buffer
  const value = deposit + nativeFee + buffer;

  console.log(`Deposit: ${depositStr} ETH`);
  console.log(`LZ fee (wei): ${nativeFee}`);
  console.log(`msg.value (wei): ${value}`);

  // 3) Fund + notify
  const fundTx = await (eth as any).fundOrderWithNotify(orderId, deposit, { value });
  const fundRc = await fundTx.wait();
  console.log("Funded & notified. Tx:", fundRc!.hash);

  fs.writeFileSync("order-id.txt", orderId);
  console.log("Saved order-id.txt");
}

main().catch((e) => { console.error(e); process.exit(1); });
