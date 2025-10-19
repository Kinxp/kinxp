import { ethers } from "hardhat";

async function main() {
  const ethAddr = process.env.ETH_COLLATERAL_ADDR!;
  const hederaAddr = process.env.HEDERA_CREDIT_ADDR!;
  const eidHedera = Number(process.env.LZ_EID_HEDERA);
  if (!ethAddr || !hederaAddr || !eidHedera) throw new Error("LZ peer envs missing");

  const eth = await ethers.getContractAt("EthCollateralOApp", ethAddr);
  // optional "setHederaEid" if present in your contract
  if ("setHederaEid" in eth) await (await (eth as any).setHederaEid(eidHedera)).wait();

  const peer = ethers.zeroPadValue(hederaAddr as `0x${string}`, 32);
  await (await (eth as any).setPeer(eidHedera, peer)).wait();
  console.log("EthCollateralOApp peer set (-> Hedera)");
}

main().catch((e) => { console.error(e); process.exit(1); });
