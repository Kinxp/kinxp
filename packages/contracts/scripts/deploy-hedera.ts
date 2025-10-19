import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = await signer.getAddress();

  const controllerFactory = await ethers.getContractFactory("UsdHtsController");

  // FIX: The constructor for UsdHtsController is now empty.
  // Call deploy() with no arguments.
  const controller = await controllerFactory.deploy();

  await controller.waitForDeployment();
  const controllerAddress = await controller.getAddress();
  console.log("UsdHtsController:", controllerAddress);

  console.log("Funding controller contract with 10 HBAR...");
  const fundTx = await signer.sendTransaction({
    to: controllerAddress,
    value: ethers.parseEther("0.00000000001"),
  });
  await fundTx.wait();
  console.log("Controller funded successfully.");

  const lzEndpoint = process.env.LZ_ENDPOINT_HEDERA ?? ethers.ZeroAddress;
  const pyth = process.env.PYTH_CONTRACT_HEDERA;
  const priceId = process.env.PYTH_ETHUSD_PRICE_ID;

  if (!pyth || !priceId) {
    throw new Error(
      "PYTH_CONTRACT_HEDERA and PYTH_ETHUSD_PRICE_ID must be set"
    );
  }

  const hederaFactory = await ethers.getContractFactory("HederaCreditOApp");
  const hedera = await hederaFactory.deploy(
    lzEndpoint,
    owner,
    controllerAddress,
    pyth,
    priceId
  );
  await hedera.waitForDeployment();
  const hederaAddress = await hedera.getAddress();
  console.log("HederaCreditOApp:", hederaAddress);

  if (process.env.LZ_EID_ETHEREUM) {
    const eidTx = await hedera.setEthEid(Number(process.env.LZ_EID_ETHEREUM));
    await eidTx.wait();
    console.log("set ethereum EID:", process.env.LZ_EID_ETHEREUM);
  }

  console.log("Creating USD HTS token...");
  const createTx = await controller.createToken("USD Stable", "USDd", 6, {
    value: 0, // Don't send HBAR from deployer
    gasLimit: 1_000_000
  });
  await createTx.wait();
  const usdToken = await controller.usdToken();
  const decimals = await controller.usdDecimals();
  console.log("USD HTS token:", usdToken, "decimals:", decimals);

  const transferTx = await controller.transferOwnership(hederaAddress);
  await transferTx.wait();
  console.log("controller ownership transferred to HederaCreditOApp");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});