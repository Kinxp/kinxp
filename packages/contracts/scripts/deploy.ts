import { ethers } from "hardhat";

async function main(){
  const buyer = "0x0000000000000000000000000000000000000001";
  const seller = "0x0000000000000000000000000000000000000002";
  const arbiter = "0x0000000000000000000000000000000000000003";
  const amounts = [ethers.parseEther("0.1"), ethers.parseEther("0.2")];

  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const esc = await Escrow.deploy(buyer, seller, arbiter, amounts, { value: amounts[0] + amounts[1] });
  await esc.waitForDeployment();
  console.log("Escrow:", await esc.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });
