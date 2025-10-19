import { ethers } from "hardhat";

function b32ToAddr(b32: string): string {
  // last 20 bytes
  return ethers.getAddress("0x" + b32.slice(66 - 40));
}

async function main() {
  const addr = process.env.ETH_COLLATERAL_ADDR!;
  if (!addr) throw new Error("ETH_COLLATERAL_ADDR missing");
  const eth = await ethers.getContractAt("EthCollateralOApp", addr);

  const endpoint = await (eth as any).endpoint();
  const hederaEid: number = Number(await (eth as any).hederaEid());
  console.log("Eth OApp @", addr);
  console.log("  endpoint:", endpoint);
  console.log("  hederaEid:", hederaEid);

  if (hederaEid !== 0) {
    const peerB32: string = await (eth as any).peers(hederaEid);
    const hasPeer = peerB32 !== "0x" + "00".repeat(32);
    console.log("  peer[hederaEid]:", peerB32, hasPeer ? "(set)" : "(unset)");
    if (hasPeer) console.log("  peer decoded:", b32ToAddr(peerB32));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
