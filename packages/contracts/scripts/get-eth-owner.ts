import { ethers } from "hardhat";

async function main() {
  const addr = process.env.ETH_COLLATERAL_ADDR!;
  const contract = await ethers.getContractAt("EthCollateralOApp", addr);
  console.log("owner", await contract.owner());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
