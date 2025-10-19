import { ethers } from "hardhat";

async function main() {
  const hederaAddr = process.env.HEDERA_CREDIT_ADDR!;
  const ethAddr = process.env.ETH_COLLATERAL_ADDR!;
  const eidEth = Number(process.env.LZ_EID_ETHEREUM);
  if (!hederaAddr || !ethAddr || !eidEth) throw new Error("LZ peer envs missing");

  const hed = await ethers.getContractAt("HederaCreditOApp", hederaAddr);
  if ("setEthEid" in hed) await (await (hed as any).setEthEid(eidEth)).wait();

  const peer = ethers.zeroPadValue(ethAddr as `0x${string}`, 32);
  await (await (hed as any).setPeer(eidEth, peer)).wait();
  console.log("HederaCreditOApp peer set (-> Sepolia)");
}

main().catch((e) => { console.error(e); process.exit(1); });
