import { ethers } from "hardhat";

async function main() {
  const ethAddr = process.env.ETH_COLLATERAL_ADDR!;
  const [user] = await ethers.getSigners();
  const eth = await ethers.getContractAt("EthCollateralOApp", ethAddr);
  const orderId = (await import("fs")).readFileSync("order-id.txt", "utf8").trim() as `0x${string}`;

  // If LayerZero notify was used and peers are set, withdraw should succeed now.
  // If it still says "not repaid", either wait for the message or (for demo)
  // use your operator flow to mark repaid on Ethereum.
  const tx = await (eth as any).withdraw(orderId);
  await tx.wait();
  console.log("Withdrawn ETH on Sepolia.");
}

main().catch((e) => { console.error(e); process.exit(1); });
