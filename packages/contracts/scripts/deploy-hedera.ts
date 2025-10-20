import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = await signer.getAddress();

  console.log(`Deploying contracts with account: ${owner}`);
  const balance = await ethers.provider.getBalance(owner);
  console.log(`Account balance: ${ethers.formatEther(balance)} HBAR`);

  if (balance < ethers.parseEther("10")) {
    console.warn(
      "\nWARNING: Your HBAR balance is low. If deployment fails, please use the Hedera Testnet Faucet: https://portal.hedera.com/faucet\n"
    );
  }

  const controllerFactory = await ethers.getContractFactory("UsdHtsController");
  const controller = await controllerFactory.deploy();
  await controller.waitForDeployment();
  const controllerAddress = await controller.getAddress();
  console.log("\n✅ UsdHtsController deployed to:", controllerAddress);
  console.log("   -> Add this to .env: USD_CONTROLLER_ADDR=" + controllerAddress);

  const lzEndpoint = process.env.LZ_ENDPOINT_HEDERA ?? ethers.ZeroAddress;
  const pyth = process.env.PYTH_CONTRACT_HEDERA;
  const priceId = process.env.PYTH_ETHUSD_PRICE_ID;

  if (!pyth || !priceId) {
    throw new Error(
      "PYTH_CONTRACT_HEDERA and PYTH_ETHUSD_PRICE_ID must be set in your .env file"
    );
  }

  const hederaFactory = await ethers.getContractFactory("HederaCreditOApp");
  const hedera = await hederaFactory.deploy(
    lzEndpoint,
    owner,
    ethers.ZeroAddress,
    pyth,
    priceId
  );
  await hedera.waitForDeployment();
  const hederaAddress = await hedera.getAddress();
  console.log("\n✅ HederaCreditOApp deployed to:", hederaAddress);
  console.log("   -> Add this to .env: HEDERA_CREDIT_ADDR=" + hederaAddress);

  if (process.env.LZ_EID_ETHEREUM) {
    const eidTx = await hedera.setEthEid(Number(process.env.LZ_EID_ETHEREUM));
    await eidTx.wait();
    console.log("\n✅ Set Ethereum EID:", process.env.LZ_EID_ETHEREUM);
  }

  console.log("\n🎉 Step 1 complete!");
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Add USD_CONTROLLER_ADDR to your .env file");
  console.log("2. Run: npm run create-hts-token");
  console.log("3. Run: npm run link-token-to-controller");
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
