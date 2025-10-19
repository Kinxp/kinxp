import { ethers } from "hardhat";

async function main() {
  const hederaAddr = process.env.HEDERA_CREDIT_ADDR!;
  const controllerAddr = process.env.HEDERA_CONTROLLER_ADDR!;
  const usdToken = process.env.USD_TOKEN_ADDR!;
  const repayUsd = BigInt(process.env.BORROW_USD ?? "200"); // repay full

  if (!hederaAddr || !controllerAddr || !usdToken) throw new Error(".env missing repayment addresses");

  const [borrower] = await ethers.getSigners();
  const hed = await ethers.getContractAt("HederaCreditOApp", hederaAddr);
  const erc20 = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", usdToken);

  const orderId = (await import("fs")).readFileSync("order-id.txt", "utf8").trim() as `0x${string}`;

  // 1) Approve controller to take your USD tokens for burn on repay
  await (await erc20.connect(borrower).approve(controllerAddr, repayUsd)).wait();

  // 2) Repay (set last arg true to notify ETH via LayerZero if peers are wired)
  const notifyEth = (process.env.REPAY_NOTIFY_LZ ?? "true") === "true";
  const tx = await (hed as any).repay(orderId, repayUsd, notifyEth);
  await tx.wait();
  console.log(`Repaid ${repayUsd} and notifyEth=${notifyEth}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
