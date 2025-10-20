import { ethers } from "hardhat";

async function main() {
  const rawEndpoint = process.env.LZ_ENDPOINT_ETHEREUM;
  if (!rawEndpoint) {
    throw new Error("Missing LZ_ENDPOINT_ETHEREUM environment variable");
  }

  const endpoint = rawEndpoint.trim();
  if (!ethers.isAddress(endpoint) || endpoint === ethers.ZeroAddress) {
    throw new Error(`Invalid LZ_ENDPOINT_ETHEREUM: ${endpoint}`);
  }

  const Eth = await ethers.getContractFactory("EthCollateralOApp");
  const eth = await Eth.deploy(endpoint);
  await eth.waitForDeployment();

  console.log("EthCollateralOApp:", await eth.getAddress());
  console.log("Contract owner:", await eth.owner());
  console.log("Signer:", await eth.runner!.getAddress?.());

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
