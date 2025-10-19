import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables to give better feedback
dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = await signer.getAddress();
  
  console.log(`Deploying contracts with account: ${owner}`);
  const balance = await ethers.provider.getBalance(owner);
  console.log(`Account balance: ${ethers.formatEther(balance)} HBAR`);

  if (balance < ethers.parseEther("10")) {
      console.warn("\nWARNING: Your HBAR balance is low. If deployment fails, please use the Hedera Testnet Faucet: https://portal.hedera.com/faucet\n");
  }

  // 1. Deploy the UsdHtsController contract.
  const controllerFactory = await ethers.getContractFactory("UsdHtsController");
  const controller = await controllerFactory.deploy();
  await controller.waitForDeployment();
  const controllerAddress = await controller.getAddress();
  console.log("\n✅ UsdHtsController deployed to:", controllerAddress);
  console.log("   -> Add this address to your .env file as USD_CONTROLLER_ADDR");
  
  // 2. Deploy the HederaCreditOApp.
  const lzEndpoint = process.env.LZ_ENDPOINT_HEDERA ?? ethers.ZeroAddress;
  const pyth = process.env.PYTH_CONTRACT_HEDERA;
  const priceId = process.env.PYTH_ETHUSD_PRICE_ID;

  if (!pyth || !priceId) {
    throw new Error("PYTH_CONTRACT_HEDERA and PYTH_ETHUSD_PRICE_ID must be set in your .env file");
  }

  const hederaFactory = await ethers.getContractFactory("HederaCreditOApp");
  const hedera = await hederaFactory.deploy(
    lzEndpoint,
    owner,
    ethers.ZeroAddress, // The token address will be set later by another script
    pyth,
    priceId
  );
  await hedera.waitForDeployment();
  const hederaAddress = await hedera.getAddress();
  console.log("\n✅ HederaCreditOApp deployed to:", hederaAddress);
  console.log("   -> Add this address to your .env file as HEDERA_CREDIT_ADDR");

  if (process.env.LZ_EID_ETHEREUM) {
    const eidTx = await hedera.setEthEid(Number(process.env.LZ_EID_ETHEREUM));
    await eidTx.wait();
    console.log("\n✅ Set Ethereum EID:", process.env.LZ_EID_ETHEREUM);
  }

  console.log("\n🎉 Deployment complete! Please run the `create-hts-token` script next.");
}

main().catch((error) => {
  if (error.message.includes("Insufficient funds")) {
    console.error("\n❌ DEPLOYMENT FAILED: INSUFFICIENT HBAR.");
    console.error("Please fund your account using the Hedera Testnet Faucet:");
    console.error("https://portal.hedera.com/faucet");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});