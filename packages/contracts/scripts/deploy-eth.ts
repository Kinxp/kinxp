import { ethers } from "hardhat";

async function main() {
  const endpoint = process.env.LZ_ENDPOINT_ETHEREUM ?? ethers.ZeroAddress;

  const Eth = await ethers.getContractFactory("EthCollateralOApp");
  const eth = await Eth.deploy(endpoint);
  await eth.waitForDeployment();

  console.log("EthCollateralOApp:", await eth.getAddress());

  if (process.env.LZ_EID_HEDERA) {
    const tx = await eth.setHederaEid(Number(process.env.LZ_EID_HEDERA));
    await tx.wait();
    console.log("set hedera EID:", process.env.LZ_EID_HEDERA);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
