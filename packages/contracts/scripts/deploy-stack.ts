import {
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  EntityIdHelper,
  TokenId,
} from "@hashgraph/sdk";
import { formatUnits, parseEther } from "ethers";
import { artifacts, ethers as hreEthers } from "hardhat";
import fs from "fs";
import path from "path";
import {
  banner,
  borrowerWallet,
  borrowerHederaKey,
  canonicalAddressFromAlias,
  configureDefaultReserve,
  deployEthCollateralOApp,
  deployHederaController,
  deployHederaCreditOApp,
  deployReserveRegistry,
  ensureOperatorHasHbar,
  hashscanTx,
  hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
  linkContractsWithLayerZero,
  associateAccountWithTokenSdk,
  transferOwnership,
} from "./util";
import { UsdHtsController } from "../typechain-types";
import { TokenInfoQuery } from "@hashgraph/sdk";

const FRONTEND_ENV_PATH = path.resolve(__dirname, "..", "..", "web", ".env");
const FRONTEND_ENV_EXAMPLE_PATH = path.resolve(__dirname, "..", "..", "web", ".env.example");
const FRONTEND_CONFIG_PATH = path.resolve(__dirname, "..", "..", "web", "src", "config.ts");

const TREASURY_MINT = 10_000_000_000n; // 10,000 tokens (6 decimals)
const USER_MINT = 1_000_000_000n; // 1,000 tokens

interface SimpleTokenResult {
  contractAddress: string;
  tokenAddress: string;
  tokenId: TokenId;
  simpleToken: any;
}

async function deploySimpleToken(): Promise<SimpleTokenResult> {
  banner("Deploy SimpleHtsToken + Create hUSD");

  const tokenArtifact = await artifacts.readArtifact("SimpleHtsToken");
  const contractCreate = new ContractCreateFlow()
    .setGas(3_000_000)
    .setBytecode(tokenArtifact.bytecode)
    .setConstructorParameters(new ContractFunctionParameters());

  const createResponse = await contractCreate.execute(hederaClient);
  const receipt = await createResponse.getReceipt(hederaClient);
  const contractId = receipt.contractId!;
  const contractAddress =
    "0x" +
    EntityIdHelper.toSolidityAddress([
      contractId.realm!,
      contractId.shard!,
      contractId.num!,
    ]);

  const simpleToken = await hreEthers.getContractAt(
    "SimpleHtsToken",
    contractAddress,
    hederaOperatorWallet
  );

  const createTx = await simpleToken.createToken({
    value: parseEther("15"),
    gasLimit: 2_500_000,
  });
  const createReceipt = await createTx.wait();
  console.log(`  ✓ Token created tx: ${hashscanTx(createReceipt.hash)}`);

  const tokenAddress = await simpleToken.token();
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  console.log(`  → Token address: ${tokenAddress}`);
  console.log(`  → Token ID: ${tokenId}`);

  try {
    const info = await new TokenInfoQuery().setTokenId(tokenId).execute(hederaClient);
    console.log(
      `  Token supply: ${info.totalSupply?.toString() ?? "0"} (decimals ${info.decimals})`
    );
  } catch (err) {
    console.warn("  ⚠ Unable to fetch token info:", (err as Error).message);
  }

  return {
    contractAddress,
    tokenAddress,
    tokenId,
    simpleToken,
  };
}

async function mintInitialBalances(
  simpleToken: any,
  controllerAddr: string,
  tokenId: TokenId
) {
  banner("Associating Hedera accounts with token");

  await associateAccountWithTokenSdk(
    hederaOperatorId,
    hederaOperatorKey,
    tokenId,
    hederaClient,
    "Operator"
  );

  const borrowerAddress = await borrowerWallet.getAddress();
  const borrowerCanonical = await canonicalAddressFromAlias(borrowerAddress);
  const borrowerAccount = AccountId.fromSolidityAddress(borrowerCanonical);
  await associateAccountWithTokenSdk(
    borrowerAccount,
    borrowerHederaKey,
    tokenId,
    hederaClient,
    "Borrower"
  );

  banner("Minting hUSD balances");
  const operatorAddress = await hederaOperatorWallet.getAddress();
  const mintTargets = [
    { label: "Controller Treasury", address: controllerAddr, amount: TREASURY_MINT },
    { label: "Borrower / Ethereum Account", address: borrowerAddress, amount: USER_MINT },
    { label: "Hedera Operator", address: operatorAddress, amount: USER_MINT },
  ];

  for (const target of mintTargets) {
    console.log(`  → Minting ${formatUnits(target.amount, 6)} hUSD to ${target.label}`);
    const mintTx = await simpleToken.mintTo(target.address, target.amount, {
      gasLimit: 2_500_000,
    });
    await mintTx.wait();
  }
}

function updateEnvFile(filePath: string, values: Record<string, string>) {
  let contents = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(contents)) {
      contents = contents.replace(regex, line);
    } else {
      contents += `\n${line}`;
    }
  }
  fs.writeFileSync(filePath, contents);
}

function updateConfigDefaults(values: Record<string, string>) {
  let contents = fs.readFileSync(FRONTEND_CONFIG_PATH, "utf8");

  const replacements: Array<{ pattern: RegExp; replacement: string }> = [
    {
      pattern: /(VITE_ETH_COLLATERAL_OAPP \|\| ')[^']+/,
      replacement: `$1${values.VITE_ETH_COLLATERAL_OAPP}`,
    },
    {
      pattern: /(VITE_HEDERA_CREDIT_OAPP \|\| ')[^']+/,
      replacement: `$1${values.VITE_HEDERA_CREDIT_OAPP}`,
    },
    {
      pattern: /(RESERVE_REGISTRY_ADDR = ')[^']+/,
      replacement: `$1${values.RESERVE_REGISTRY_ADDR}`,
    },
    {
      pattern: /(VITE_HUSD_TOKEN_ADDR \|\| ')[^']+/,
      replacement: `$1${values.VITE_HUSD_TOKEN_ADDR}`,
    },
    {
      pattern: /(HUSD_TOKEN_ID \|\| ')[^']+/,
      replacement: `$1${values.VITE_HUSD_TOKEN_ID}`,
    },
    {
      pattern: /(VITE_USD_CONTROLLER \|\| ')[^']+/,
      replacement: `$1${values.VITE_USD_CONTROLLER}`,
    },
  ];

  for (const { pattern, replacement } of replacements) {
    contents = contents.replace(pattern, replacement);
  }

  fs.writeFileSync(FRONTEND_CONFIG_PATH, contents);
}

async function main() {
  banner("KinXP Automated Redeploy");

  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();
  await ensureOperatorHasHbar(hederaOperatorWalletAddress);

  banner("Deploying contracts");
  const { ethCollateralAddr, ethCollateral } = await deployEthCollateralOApp();
  console.log("  EthCollateralOApp:", ethCollateralAddr);

  const { controllerAddr, controllerId, controller } = await deployHederaController(
    hederaClient,
    hederaOperatorWallet
  );
  console.log("  UsdHtsController:", controllerAddr);

  const { registryAddr, registryId, registry } = await deployReserveRegistry(
    hederaClient,
    hederaOperatorWallet
  );
  console.log("  ReserveRegistry:", registryAddr);

  await configureDefaultReserve(registry, controllerAddr, hederaOperatorWalletAddress);

  const { hederaCreditAddr, hederaCredit } = await deployHederaCreditOApp(
    hederaOperatorWallet,
    hederaClient,
    registryAddr
  );
  console.log("  HederaCreditOApp:", hederaCreditAddr);

  await linkContractsWithLayerZero(ethCollateral, hederaCreditAddr, hederaCredit, ethCollateralAddr);

  const simpleToken = await deploySimpleToken();

  banner("Linking token + controller");
  await (await controller.setUsdToken(simpleToken.tokenAddress, 6)).wait();
  await (await controller.associateToken()).wait();
  await mintInitialBalances(simpleToken.simpleToken, controllerAddr, simpleToken.tokenId);

  banner("Transferring controller ownership to HederaCredit");
  await transferOwnership(controller as UsdHtsController, hederaCreditAddr);

  const envValues = {
    VITE_ETH_COLLATERAL_OAPP: ethCollateralAddr.toLowerCase(),
    VITE_HEDERA_CREDIT_OAPP: hederaCreditAddr.toLowerCase(),
    VITE_USD_CONTROLLER: controllerAddr.toLowerCase(),
    VITE_HUSD_TOKEN_ADDR: simpleToken.tokenAddress.toLowerCase(),
    VITE_HUSD_TOKEN_ID: simpleToken.tokenId.toString(),
  };
  const configValues = {
    ...envValues,
    RESERVE_REGISTRY_ADDR: registryAddr.toLowerCase(),
  };

  updateEnvFile(FRONTEND_ENV_PATH, envValues);
  updateEnvFile(FRONTEND_ENV_EXAMPLE_PATH, envValues);
  updateConfigDefaults(configValues);

  banner("Deployment summary");
  console.log("  EthCollateral:", ethCollateralAddr);
  console.log("  HederaCredit:", hederaCreditAddr);
  console.log("  Controller:", controllerAddr);
  console.log("  ReserveRegistry:", registryAddr);
  console.log("  hUSD token:", simpleToken.tokenAddress, "/", simpleToken.tokenId.toString());
  console.log("  SimpleHtsToken contract:", simpleToken.contractAddress);
  console.log("\n✅ Environment + config files updated.");
}

main().catch((err) => {
  console.error("❌ Deploy script failed");
  console.error(err);
  process.exitCode = 1;
});
