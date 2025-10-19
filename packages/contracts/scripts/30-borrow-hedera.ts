import { ethers } from "hardhat";

async function fetchPythUpdate(priceId: string): Promise<string[]> {
  const base = process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";
  const url = `${base}/v2/updates/price/latest?ids[]=${priceId}&encoding=hex`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes fetch failed: ${res.status} ${res.statusText}`);
  const j = await res.json() as any;
  // As of Hermes v2, updates are returned under binary.data (array of 0x-hex strings)
  const updates: string[] = j?.binary?.data;
  if (!Array.isArray(updates) || updates.length === 0) throw new Error("Hermes returned no updates");
  return updates;
}

async function main() {
  const hederaAddr = process.env.HEDERA_CREDIT_ADDR!;
  const controllerAddr = process.env.HEDERA_CONTROLLER_ADDR!;
  const pythAddr = process.env.PYTH_CONTRACT_HEDERA!;
  const priceId = process.env.PYTH_ETHUSD_PRICE_ID!;
  const usd = BigInt(process.env.BORROW_USD ?? "200");
  const maxAge = Number(process.env.MAX_AGE_SECS ?? "600");

  if (!hederaAddr || !pythAddr || !priceId) throw new Error("Hedera/Pyth envs missing");

  // IMPORTANT: Before borrowing, associate USD token in your wallet (HashPack / Snap).
  // Otherwise the HTS mint+transfer will revert.

  const [borrower] = await ethers.getSigners();
  const hed = await ethers.getContractAt("HederaCreditOApp", hederaAddr);
  const pyth = await ethers.getContractAt("@pythnetwork/pyth-sdk-solidity/IPyth.sol:IPyth", pythAddr);

  // Load the previously created order id
  const orderId = (await import("fs")).readFileSync("order-id.txt", "utf8").trim() as `0x${string}`;

  // 1) Pull fresh updateData from Hermes
  const updateData = await fetchPythUpdate(priceId);        // bytes[] for Solidity
  // 2) Quote Pyth fee and pass it as msg.value
  const fee = await pyth.getUpdateFee(updateData);

  // 3) Borrow
  const tx = await (hed as any).borrow(orderId, usd, updateData, maxAge, { value: fee });
  const rcpt = await tx.wait();
  console.log(`Borrowed ${usd} (controller decimals) for order ${orderId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
