// scripts/deploy-usd-controller.ts
import hre from "hardhat";
import { TokenId } from "@hashgraph/sdk";
import {
  banner,
  deployHederaController,
  hederaClient,
  hederaOperatorWallet,
  logControllerMintStatus,
} from "./util";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contract with the account:", await deployer.getAddress());
  console.log("Hedera operator EVM:", await hederaOperatorWallet.getAddress());

  // 1) Deploy the controller contract (uses Hedera SDK ContractCreateFlow under the hood)
  banner("Deploying UsdHtsController");
  const { controllerAddr, controllerId, controller } = await deployHederaController(
    hederaClient,
    hederaOperatorWallet
  );
  await controller.waitForDeployment?.(); // harmless if undefined
  console.log("UsdHtsController deployed at:", controllerAddr, `(${controllerId.toString()})`);

  // 2) Create the HTS fungible token via controller.createUsdToken()
  //    Send HBAR directly with the transaction to pay for HTS fees
  const NAME = "Hedera Stable USD";
  const SYMBOL = "hUSD";
  const DECIMALS = 6;
  const MEMO = "hUSD";

  const HBAR_TO_SEND = "20"; // Send HBAR with the createUsdToken call
  console.log(`Calling createUsdToken() with ${HBAR_TO_SEND} HBAR to create the HTS fungible token...`);
  
  const tx = await controller.createUsdToken(
    NAME,
    SYMBOL,
    DECIMALS,
    MEMO,
    { 
      value: ethers.parseEther(HBAR_TO_SEND) 
    }
  );
  const rcpt = await tx.wait();
  console.log("createUsdToken() tx hash:", rcpt.hash);

  // 3) Read back the created token address + cosmetics
  const controllerAddress = await controller.getAddress();
  console.log("UsdHtsController (runtime) address:", controllerAddress);

  const tokenAddress: string = await controller.usdToken();
  console.log("Underlying HTS fungible token (ERC-20 facade) address:", tokenAddress);

  try {
    const tokenId = TokenId.fromSolidityAddress(tokenAddress);
    console.log("Token ID:", tokenId.toString());
  } catch {
    // ignore if conversion fails
  }

  const tokenName: string = await controller.usdTokenName();
  const tokenSymbol: string = await controller.usdTokenSymbol();
  const tokenDecimals: number = await controller.usdDecimals();
  console.log(`Token: ${tokenName} (${tokenSymbol}) decimals: ${tokenDecimals}`);

  // Optional: quick controller status snapshot
  await logControllerMintStatus(controller, controllerAddress);
}

main().catch(console.error);