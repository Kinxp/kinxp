import {
  AccountAllowanceApproveTransaction,
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenUpdateTransaction,
  TransferTransaction,
  Client,
  TokenSupplyType,
  TokenType,
  EntityIdHelper,
  ContractId,
  TokenId
} from "@hashgraph/sdk";
import { Buffer } from "buffer";
import {
  Contract,
  formatUnits,
  getAddress,
  JsonRpcProvider,
  parseEther,
  TransactionReceipt,
  Wallet,
  zeroPadValue
} from "ethers";
import { artifacts, ethers } from "hardhat";
import { EthCollateralOApp, HederaCreditOApp, ReserveRegistry, ReserveRegistry__factory, UsdHtsController, UsdHtsController__factory } from "../typechain-types";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const HEDERA_MIN_VALUE = 1n; // Minimum LayerZero fee in tinybars
const HBAR_WEI_PER_TINYBAR = 10_000_000_000n;

const ethEndpoint = requireAddress("LZ_ENDPOINT_ETHEREUM");
const ethEid = requireEid("LZ_EID_ETHEREUM");
const hederaEndpoint = requireAddress("LZ_ENDPOINT_HEDERA");
const hederaEid = requireEid("LZ_EID_HEDERA");

const pythContract = requireAddress("PYTH_CONTRACT_HEDERA");
export const PYTH_CONTRACT_ADDRESS = pythContract;
const priceFeedId = requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex;

const ethProvider = new JsonRpcProvider(requireEnv("ETH_RPC_URL"));
export const ethSigner = new Wallet(requireEnv("DEPLOYER_KEY"), ethProvider);

const hederaRpc = requireEnv("HEDERA_RPC_URL");
const hederaProvider = new JsonRpcProvider(hederaRpc);
const hederaMirrorUrl =
  process.env.HEDERA_MIRROR_URL?.trim() ?? "https://testnet.mirrornode.hedera.com";

// Hedera keys
const hederaOperatorKeyHex = requireEnv("HEDERA_ECDSA_KEY").replace(/^0x/, "");
export const hederaOperatorId = AccountId.fromString(requireEnv("HEDERA_ACCOUNT_ID"));
export const hederaOperatorKey = PrivateKey.fromStringECDSA(hederaOperatorKeyHex);
export const hederaOperatorWallet = new Wallet(hederaOperatorKeyHex, hederaProvider);

// Hedera SDK client (for HTS admin ops)
export const hederaClient = Client.forTestnet()
  .setOperator(hederaOperatorId, hederaOperatorKey)
  .setDefaultMaxTransactionFee(new Hbar(5));

// Borrower = same ECDSA for simplicity
const borrowerKeyHex = requireEnv("DEPLOYER_KEY").replace(/^0x/, "");
export const borrowerWallet = new Wallet(borrowerKeyHex, hederaProvider);
export const borrowerHederaKey = PrivateKey.fromStringECDSA(borrowerKeyHex);

export async function canonicalAddressFromAlias(evmAddress: string): Promise<Hex> {
  const alias = evmAddress.toLowerCase();
  const res = await fetch(`${hederaMirrorUrl}/api/v1/accounts/${alias}`);
  if (!res.ok) {
    throw new Error(`Mirror lookup failed (${res.status}): ${await res.text()}`);
  }
  const data: any = await res.json();
  const accountId = data?.account ?? data?.accounts?.[0]?.account;
  if (!accountId) throw new Error(`Mirror lookup for ${alias} returned no account`);
  const canonical = AccountId.fromString(accountId).toSolidityAddress();
  console.log("  DEBUG: canonicalAddressFromAlias:", canonical);

  return (`0x${canonical}`) as Hex;
 
}

const depositEth = parseFloat(process.env.DEPOSIT_ETH ?? "0.00001");
export const depositWei = parseEther(depositEth.toString());
const borrowSafetyBps = Number(process.env.BORROW_TARGET_BPS ?? "8000");
const operatorMinHbar = process.env.HEDERA_OPERATOR_MIN_HBAR ?? "20";
const operatorTopUpTargetHbar = process.env.HEDERA_OPERATOR_TOP_UP_HBAR ?? "40";
const OPERATOR_MIN_BALANCE_WEI = parseEther(operatorMinHbar);
const OPERATOR_TOP_UP_TARGET_WEI = parseEther(operatorTopUpTargetHbar);
// Optional origination fee charged on borrow (basis points). Default 0 so end-to-end tests
// don't fail when the borrower tries to repay exactly what they received.
const originationFeeBps = Number(process.env.ORIGINATION_FEE_BPS ?? "0");
export const SKIP_LAYERZERO = (process.env.SKIP_LAYERZERO ?? "false").toLowerCase() === "true";
export const ORIGINATION_FEE_BPS = originationFeeBps;
export const DEFAULT_RESERVE_ID = ethers.encodeBytes32String("ETH-hUSD") as Hex;
const reserveRegistryInterface = ReserveRegistry__factory.createInterface();
const controllerInterface = UsdHtsController__factory.createInterface();

export const sepoliaTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const layerzeroTx = (h: string) => `https://testnet.layerzeroscan.com/tx/${h}`;
export const hashscanTx = (h: string) => `https://hashscan.io/testnet/transaction/${h}`;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
export const IPYTH_ABI = [
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
];

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable ${name}`);
  return value.trim();
}

export function requireAddress(name: string): Hex {
  return getAddress(requireEnv(name)) as Hex;
}

export function requireEid(name: string): number {
  const raw = requireEnv(name);
  const eid = Number(raw);
  if (!Number.isInteger(eid) || eid <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return eid;
}

function logSection(title: string) {
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════");
  console.log(`▶ ${title}`);
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════");
}

export async function deployHederaController(hederaClient: Client, hederaOperatorWallet: Wallet) {
  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");
  const controllerParams = new ContractFunctionParameters().addAddress(await hederaOperatorWallet.getAddress());

  const controllerCreate = new ContractCreateFlow()
    .setGas(2500000)
    .setBytecode(controllerArtifact.bytecode)
    .setConstructorParameters(controllerParams);
  const controllerCreateResponse = await controllerCreate.execute(hederaClient);
  const controllerReceipt = await controllerCreateResponse.getReceipt(hederaClient);
  const controllerId = controllerReceipt.contractId!;
  const controllerAddr = '0x' + EntityIdHelper.toSolidityAddress([
    (controllerId.realm)!,
    (controllerId.shard)!,
    (controllerId.num)!
  ]);

  const controller = await ethers.getContractAt("UsdHtsController", controllerAddr, hederaOperatorWallet);
  return { controllerAddr, controllerId, controller };
}

export async function deployReserveRegistry(hederaClient: Client, ownerWallet: Wallet) {
  const registryArtifact = await artifacts.readArtifact("ReserveRegistry");
  const registryParams = new ContractFunctionParameters().addAddress(await ownerWallet.getAddress());
  const registryCreate = new ContractCreateFlow()
  .setGas(2500000)
  .setBytecode(registryArtifact.bytecode)
    .setConstructorParameters(registryParams);

  const registryCreateResponse = await registryCreate.execute(hederaClient);
  const registryReceipt = await registryCreateResponse.getReceipt(hederaClient);
  const registryId = registryReceipt.contractId!;
  const registryAddr = '0x' + EntityIdHelper.toSolidityAddress([
    (registryId.realm)!,
    (registryId.shard)!,
    (registryId.num)!
  ]);
  const registry = await ethers.getContractAt("ReserveRegistry", registryAddr, ownerWallet) as ReserveRegistry;
  try {
    const currentOwner = await (registry as any).owner?.();
    console.log("  → ReserveRegistry owner:", currentOwner ?? "<owner() unavailable>");
  } catch (err) {
    console.warn("  ! Unable to read registry owner:", formatRevertError(err));
  }
  return { registryAddr, registryId, registry };
}

export async function configureDefaultReserve(
  registry: ReserveRegistry,
  controllerAddr: string,
  protocolTreasury: string
) {
  // This helper wires up a single reserve for the scripts. If you want to charge
  // an origination fee during manual runs, set ORIGINATION_FEE_BPS in the env; the
  // default is 0 so that the borrower receives exactly what they will later repay.
  const riskConfig = {
    maxLtvBps: 7000,
    liquidationThresholdBps: 8000,
    liquidationBonusBps: 10500,
    closeFactorBps: 5000,
    reserveFactorBps: 1000,
    liquidationProtocolFeeBps: 500
  };

  const interestConfig = {
    baseRateBps: 200,
    slope1Bps: 400,
    slope2Bps: 900,
    optimalUtilizationBps: 8000,
    originationFeeBps: originationFeeBps
  };

  const oracleConfig = {
    priceId: priceFeedId,
    heartbeatSeconds: 600,
    maxStalenessSeconds: 900,
    maxConfidenceBps: 300,
    maxDeviationBps: 800
  };

  const bundle = {
    metadata: {
      reserveId: DEFAULT_RESERVE_ID,
      label: "ETH-hUSD",
      controller: controllerAddr,
      protocolTreasury,
      debtTokenDecimals: 6,
      active: true,
      frozen: false
    },
    risk: riskConfig,
    interest: interestConfig,
    oracle: oracleConfig
  };

  console.log("  → Reserve metadata controller:", controllerAddr);
  console.log("  → Reserve metadata treasury:", protocolTreasury);
  console.log("  → Reserve interest originationFeeBps:", originationFeeBps);

  try {
    await registry.registerReserve.staticCall(bundle);
    console.log("  ✓ registerReserve static call passed");
  } catch (err) {
    console.error("  ✗ registerReserve static call reverted:", formatRevertError(err));
    throw err;
  }

  try {
    const tx = await registry.registerReserve(bundle, { gasLimit: 3_000_000n });
    await tx.wait();
  } catch (err) {
    console.error("  ✗ registerReserve transaction reverted:", formatRevertError(err));
    const raw =
      (err as any)?.data ??
      (err as any)?.error?.data ??
      (err as any)?.error?.error?.data ??
      "none";
    console.error("    raw revert data:", raw);
    throw err;
  }
}

export async function deployHederaCreditOApp(
  hederaOperatorWallet: Wallet,
  hederaClient: Client,
  registryAddr: string,
  defaultReserveId: Hex = DEFAULT_RESERVE_ID
) {
  const creditArtifact = await artifacts.readArtifact("HederaCreditOApp");

  const creditParams = new ContractFunctionParameters()
    .addAddress(hederaEndpoint)
    .addAddress(await hederaOperatorWallet.getAddress())
    .addAddress(registryAddr)
    .addAddress(pythContract)
    .addBytes32(Buffer.from(defaultReserveId.replace(/^0x/, ""), 'hex'));

  const creditCreate = new ContractCreateFlow()
    .setBytecode(creditArtifact.bytecode)
    .setConstructorParameters(creditParams);
  creditCreate.setGas(5_000_000)


  const creditCreateResponse = await creditCreate.execute(hederaClient);
  const creditReceipt = await creditCreateResponse.getReceipt(hederaClient);
  const creditId = creditReceipt.contractId!;
  const hederaCreditAddr = '0x' + EntityIdHelper.toSolidityAddress([
    (creditReceipt.contractId?.realm)!,
    (creditReceipt.contractId?.shard)!,
    (creditReceipt.contractId?.num)!
  ]);

  const hederaCredit = await ethers.getContractAt("HederaCreditOApp", hederaCreditAddr, hederaOperatorWallet);
  return { hederaCreditAddr, creditId, hederaCredit };
}

export async function linkContractsWithLayerZero(ethCollateral: EthCollateralOApp, hederaCreditAddr: string, hederaCredit: HederaCreditOApp, ethCollateralAddr: string) {
  await (await ethCollateral.setHederaEid(hederaEid)).wait();
  const hedPeerBytes = zeroPadValue(hederaCreditAddr, 32);
  await (await ethCollateral.setPeer(hederaEid, hedPeerBytes)).wait();
  await (await hederaCredit.setEthEid(ethEid)).wait();
  const ethPeerBytes = zeroPadValue(ethCollateralAddr, 32);
  await (await hederaCredit.setPeer(ethEid, ethPeerBytes)).wait();
}

export async function deployEthCollateralOApp() {
  const EthCollateralFactory = await ethers.getContractFactory("EthCollateralOApp");
  const ethCollateral = await EthCollateralFactory.deploy(ethEndpoint, DEFAULT_RESERVE_ID);
  await ethCollateral.waitForDeployment();
  const ethCollateralAddr = (await ethCollateral.getAddress()) as Hex;
  return { ethCollateralAddr, ethCollateral };
}

export type Hex = `0x${string}`;

export function banner(title: string) {
  console.log("\n" + "═".repeat(94));
  console.log(`▶ ${title}`);
  console.log("═".repeat(94) + "\n");
}

export function scalePrice(price: bigint, expo: number): bigint {
  const targetDecimals = 18;
  const expDiff = targetDecimals + expo;
  if (expDiff === 0) return price;
  if (expDiff > 0) return price * 10n ** BigInt(expDiff);
  return price / 10n ** BigInt(-expDiff);
}

export async function fetchPythUpdate() {
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceFeedId}&encoding=hex&parsed=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Pyth price update (${res.status}): ${await res.text()}`);
  const data: any = await res.json();
  if (!data?.binary?.data?.length) throw new Error("No binary price update data in response");
  const priceUpdateBytes = "0x" + data.binary.data[0];
  const priceUpdateData = [priceUpdateBytes];

  if (!data?.parsed?.length) throw new Error("No parsed price data in response");
  const parsed = data.parsed[0];
  if (!parsed?.price?.price || parsed.price.expo === undefined) throw new Error("Parsed price data incomplete");

  return { priceUpdateData, price: BigInt(parsed.price.price), expo: Number(parsed.price.expo) };
}

export async function waitForHederaOrderOpen(hederaCredit: HederaCreditOApp, orderId: Hex, maxAttempts = 60) {
  const testFn = async () => {
      const order = await hederaCredit.horders(orderId);
      if (order && order.open) return order;
  }
  return waitForHedera(testFn, maxAttempts);
}

export async function ensureHederaOrderOpen(
  hederaCredit: HederaCreditOApp,
  orderId: Hex,
  reserveId: Hex,
  borrowerAlias: string,
  borrowerCanonical: string,
  collateralWei: bigint,
  maxAttempts = 60
) {
  if (SKIP_LAYERZERO) {
    console.warn("  LayerZero skipped (SKIP_LAYERZERO=true): simulating Hedera mirror via adminMirrorOrder");
    const tx = await hederaCredit.adminMirrorOrder(orderId, reserveId, borrowerAlias, borrowerCanonical, collateralWei);
    await tx.wait();
    return positionsAwaitable(hederaCredit, orderId);
  }
  try {
    return await waitForHederaOrderOpen(hederaCredit, orderId, maxAttempts);
  } catch (err) {
    console.warn("  Hedera mirror timeout – invoking adminMirrorOrder fallback");
    const tx = await hederaCredit.adminMirrorOrder(orderId, reserveId, borrowerAlias, borrowerCanonical, collateralWei);
    await tx.wait();
    return await waitForHederaOrderOpen(hederaCredit, orderId, 10);
  }
}

async function positionsAwaitable(hederaCredit: HederaCreditOApp, orderId: Hex) {
  const order = await hederaCredit.horders(orderId);
  if (!order || !order.open) {
    throw new Error("failed to mirror order even with SKIP_LAYERZERO");
  }
  return order;
}

export async function waitForHederaOrderLiquidated(hederaCredit: HederaCreditOApp, orderId: Hex, maxAttempts = 60) {
  const testFn = async () => {
    const order = await hederaCredit.horders(orderId);
    if (order && !order.open) return order;
  }
  return waitForHedera(testFn, maxAttempts);
}

async function waitForHedera<T>(testFn: () => Promise<T | undefined>, maxAttempts: number): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const testValue = await testFn();
      if (testValue !== undefined) {
        return testValue;
      }
    } catch (err) {
      console.warn(`  [${attempt + 1}/${maxAttempts}] Hedera mirror read failed: ${(err as Error).message}`);
    }
    console.log(`  [${attempt + 1}/${maxAttempts}] Waiting 6s for Hedera mirror...`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error("Timed out waiting for Hedera order mirror");
}

export async function waitForEthRepaid(ethCollateral: EthCollateralOApp, orderId: Hex, maxAttempts = 40) {
  if (SKIP_LAYERZERO) {
    console.warn("  LayerZero skipped (SKIP_LAYERZERO=true): assuming Ethereum repay flag eventually arrives");
    return { } as any;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const order = await ethCollateral.orders(orderId);
      if (order?.repaid) return order;
    } catch (err) {
      console.warn(`  [${attempt + 1}/${maxAttempts}] Ethereum order read failed: ${(err as Error).message}`);
    }
    console.log(`  [${attempt + 1}/${maxAttempts}] Waiting 6s for Ethereum repayment flag...`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error("Timed out waiting for Ethereum repayment flag");
}

export async function fundOrderEthereum(ethCollateral: EthCollateralOApp, ethSigner: Wallet, orderId: string) {
  const nativeFee: bigint = await ethCollateral.quoteOpenNativeFeeWithReserve(DEFAULT_RESERVE_ID, depositWei);
  let totalValue = depositWei + nativeFee + (nativeFee / 10n);

  const txFund = await ethCollateral.fundOrderWithNotify(orderId, depositWei, {
    value: totalValue,
    gasLimit: 600000,
  });
  await txFund.wait();
  return txFund;
}

export async function createOrderEthereum(ethCollateral: EthCollateralOApp) {
  const txCreateOrder = await ethCollateral.createOrderId();
  const createReceipt = await txCreateOrder.wait();
  const createEvent = createReceipt!.logs
    .map((log: any) => { try { return ethCollateral.interface.parseLog(log); } catch { return null; } })
    .find((log: any) => log?.name === "OrderCreated");
  if (!createEvent) throw new Error("OrderCreated event not found");
  const orderId = createEvent.args.orderId as Hex;
  return orderId;
}

export async function createHtsToken(hederaOperatorId: AccountId, hederaOperatorKey: PrivateKey, hederaClient: Client) {
  const tokenCreateTx = new TokenCreateTransaction()
    .setTokenName("Hedera Stable USD (Autogen)")
    .setTokenSymbol("hUSD")
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(hederaOperatorId)
    .setSupplyKey(hederaOperatorKey)
    .setAdminKey(hederaOperatorKey)
    .setAutoRenewAccountId(hederaOperatorId)
    .setAutoRenewPeriod(7776000)
    .setMaxTransactionFee(new Hbar(20))
    .freezeWith(hederaClient);

  const tokenCreateSign = await tokenCreateTx.sign(hederaOperatorKey);
  const tokenCreateSubmit = await tokenCreateSign.execute(hederaClient);
  const tokenCreateReceipt = await tokenCreateSubmit.getReceipt(hederaClient);
  const tokenId = tokenCreateReceipt.tokenId;
  if (!tokenId) throw new Error("Token creation failed");
  const tokenAddress = ("0x" + tokenId.toSolidityAddress()) as Hex;
  return { tokenId, tokenAddress };
}

export async function associateToken(
  borrowerWallet: Wallet, 
  tokenAddress: string,
  targetAddress?: string // If provided, associate this specific address instead
) {
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = ["function associateToken(address account, address token) external returns (int64)"];
  const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  
  const addressToAssociate = targetAddress || await borrowerWallet.getAddress();
  
  const tx = await hts.associateToken(addressToAssociate, tokenAddress, { 
    gasLimit: 2500000
 
  });
  const receipt = await tx.wait();
  
  console.log(`  ✓ Associated ${addressToAssociate} with token ${tokenAddress}`);
  return receipt;
}

export async function associateAccountWithTokenSdk(
  accountId: AccountId,
  accountKey: PrivateKey,
  tokenId: TokenId,
  client: Client,
  label = "account"
) {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([tokenId])
    .freezeWith(client);
  const signed = await tx.sign(accountKey);
  try {
    const response = await signed.execute(client);
    const receipt = await response.getReceipt(client);
    const status = receipt.status?.toString?.() ?? "<unknown>";
    if (status === "TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT") {
      console.log(`  ${label}: token already associated (${status})`);
    } else {
      console.log(`  ${label}: token association status ${status}`);
    }
    return receipt;
  } catch (err) {
    const status = (err as any)?.status?.toString?.();
    if (status === "TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT") {
      console.log(`  ${label}: token already associated (${status})`);
      return null;
    }
    console.error(`  ✗ ${label}: token association failed`, formatRevertError(err));
    throw err;
  }
}

export async function linkControllerToToken(
  controller: UsdHtsController,
  tokenAddress: string,
  decimals = 6
) {
  await (await controller.setExistingUsdToken(tokenAddress, decimals)).wait();
  await (await controller.associateToken(tokenAddress)).wait();
}

export async function ensureOperatorHasHbar(
  operatorAddress: string,
  logs: (msg: string) => void = console.log
) {
  const currentBalance = await hederaProvider.getBalance(operatorAddress);
  if (currentBalance >= OPERATOR_MIN_BALANCE_WEI) {
    logs(
      `  Hedera operator balance OK (${formatUnits(currentBalance, 18)} HBAR)`
    );
    return { funded: false, currentBalance };
  }

  const deployerAddress = await borrowerWallet.getAddress();
  const deployerBalance = await hederaProvider.getBalance(deployerAddress);
  const target = OPERATOR_TOP_UP_TARGET_WEI > OPERATOR_MIN_BALANCE_WEI
    ? OPERATOR_TOP_UP_TARGET_WEI
    : OPERATOR_MIN_BALANCE_WEI * 2n;
  const desiredBalance = target > currentBalance ? target : OPERATOR_MIN_BALANCE_WEI;
  const requiredAmount = desiredBalance - currentBalance;

  if (deployerBalance <= requiredAmount) {
    throw new Error(
      `Deployer Hedera balance (${formatUnits(deployerBalance, 18)} HBAR) is too low to top-up operator by ${formatUnits(requiredAmount, 18)} HBAR`
    );
  }

  logs(
    `  Funding Hedera operator with ${formatUnits(requiredAmount, 18)} HBAR from deployer (${deployerAddress})`
  );
  const tx = await borrowerWallet.sendTransaction({
    to: operatorAddress,
    value: requiredAmount,
    gasLimit: 50_000,
  });
  const receipt = await tx.wait();
  logs(`  ✓ Top-up tx hash: ${receipt.hash ?? tx.hash}`);

  return {
    funded: true,
    amount: requiredAmount,
    txHash: receipt.hash ?? tx.hash,
    currentBalance: desiredBalance,
  };
}

function evmAddressToAccountId(evmAddress: string): AccountId {
  const shard = hederaOperatorId.shard ?? 0;
  const realm = hederaOperatorId.realm ?? 0;
  return AccountId.fromEvmAddress(shard, realm, evmAddress);
}

export async function approveTokens(
  tokenAddress: string,
  controllerAddr: string
) {
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  const controllerContractId = ContractId.fromSolidityAddress(controllerAddr);
  const allowanceAmount = 1_000_000_000_000n; // 1e12 token units
  console.log("  DEBUG: setting HTS allowance for controller", controllerContractId.toString());
  const tx = await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenId, hederaOperatorId, controllerContractId, allowanceAmount)
    .freezeWith(hederaClient);
  const signed = await tx.sign(hederaOperatorKey);
  const response = await signed.execute(hederaClient);
  const receipt = await response.getReceipt(hederaClient);
  console.log("  DEBUG: allowance tx status:", receipt.status?.toString?.() ?? receipt.status);
  return receipt;
}

export async function logControllerMintStatus(
  controller: UsdHtsController,
  creditAddress: string
) {
  try {
    let debugData: any;
    const callStatic: any = (controller.callStatic as any) || {};
    if (typeof callStatic.debugMintStatus === "function") {
      debugData = await callStatic.debugMintStatus(creditAddress);
    } else {
      const provider = controller.runner?.provider ?? hederaOperatorWallet.provider;
      if (!provider) throw new Error("no provider available for controller debug call");
      const target = await controller.getAddress();
      const raw = await provider.call({
        to: target,
        data: controller.interface.encodeFunctionData("debugMintStatus", [creditAddress]),
      });
      [debugData] = controller.interface.decodeFunctionResult("debugMintStatus", raw);
    }
    console.log("  DEBUG: controller mint status");
    console.log("    owner:", debugData.owner);
    console.log("    treasuryAccount:", debugData.treasury);
    console.log("    usdToken:", debugData.usdToken);
    console.log("    paused:", debugData.paused);
    console.log("    mintCap:", debugData.mintCap.toString());
    console.log("    totalMinted:", debugData.totalMinted.toString());
    console.log("    totalBurned:", debugData.totalBurned.toString());
    console.log("    tokenInitialized:", debugData.tokenInitialized);
  } catch (err) {
    console.warn("  ⚠ Unable to fetch controller mint status:", (err as Error).message ?? err);
  }
}

export async function revokeTokenAllowances(
  tokenId: TokenId,
  hederaOperatorId: AccountId,
  controllerId: ContractId,
  creditId: ContractId,
  hederaClient: Client,
  hederaOperatorKey: PrivateKey
) {
  const revokeTx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenId, hederaOperatorId, controllerId, 0)
    .approveTokenAllowance(tokenId, hederaOperatorId, creditId, 0)
    .freezeWith(hederaClient);
  const signed = await revokeTx.sign(hederaOperatorKey);
  const response = await signed.execute(hederaClient);
  return await response.getReceipt(hederaClient);
}

export async function clearAllTokenAllowances(
  hederaOperatorId: AccountId,
  hederaClient: Client,
  hederaOperatorKey: PrivateKey
): Promise<number> {
  const account = hederaOperatorId.toString();
  let next: string | null = `/api/v1/accounts/${account}/allowances/tokens?limit=100`;
  const allowances: Array<{ tokenId: TokenId; spender: AccountId }> = [];

  while (next) {
    const url = next.startsWith("http") ? next : `${hederaMirrorUrl}${next}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Mirror allowances fetch failed (${res.status}): ${await res.text()}`);
    }
    const data: any = await res.json();
    const items = (data?.allowances ?? []) as Array<{ token_id: string; spender: string }>;
    for (const entry of items) {
      try {
        const tokenId = TokenId.fromString(entry.token_id);
        const spender = AccountId.fromString(entry.spender);
        allowances.push({ tokenId, spender });
      } catch {
        // Skip malformed entries
      }
    }
    const linkNext = data?.links?.next as string | undefined;
    next = linkNext && linkNext.length > 0 ? linkNext : null;
  }

  if (allowances.length === 0) return 0;

  let cleared = 0;
  for (let i = 0; i < allowances.length; i += 20) {
    const chunk = allowances.slice(i, i + 20);
    const tx = new AccountAllowanceApproveTransaction();
    for (const { tokenId, spender } of chunk) {
      tx.approveTokenAllowance(tokenId, hederaOperatorId, spender, 0);
    }
    const frozen = tx.freezeWith(hederaClient);
    const signed = await frozen.sign(hederaOperatorKey);
    await (await signed.execute(hederaClient)).getReceipt(hederaClient);
    cleared += chunk.length;
  }
  return cleared;
}

export async function transferOwnership(controller: UsdHtsController, hederaCreditAddr: string) {
  await (await controller.transferOwnership(hederaCreditAddr)).wait();
}

export async function transferSupplyKey(tokenId: TokenId, controllerId: ContractId, hederaClient: Client, hederaOperatorKey: PrivateKey) {
  const supplyUpdateTx = new TokenUpdateTransaction()
    .setTokenId(tokenId)
    .setSupplyKey(controllerId)
    .freezeWith(hederaClient);
  const supplyUpdateSign = await supplyUpdateTx.sign(hederaOperatorKey);
  await (await supplyUpdateSign.execute(hederaClient)).getReceipt(hederaClient);
}

export async function getBorrowAmount(scaledPrice: bigint, hederaCredit: HederaCreditOApp) {
  const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
  const ltvBps = await hederaCredit.ltvBps();
  const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10000n;
  const borrowTarget18 = (maxBorrow18 * BigInt(borrowSafetyBps)) / 10000n;
  const borrowAmount = borrowTarget18 / 10n ** 12n; // Convert to 6 decimals
  return borrowAmount;
}

export async function getPriceUpdateFee(priceUpdateData: string[]) {
  const pythContract2 = new Contract(pythContract, IPYTH_ABI, hederaOperatorWallet);
  const pythFee = await pythContract2.getUpdateFee(priceUpdateData);
  const priceUpdateFee = pythFee < 10000000000n ? 10000000000n : pythFee;
  return { priceUpdateFee };
}

export async function printBalances(
  tokenAddress: string,
  treasuryAddress: string,
  borrowerAddress: string,
  protocolAddress: string
) {
  const token = new Contract(tokenAddress, ERC20_ABI, hederaProvider);
  const treasuryBal = await token.balanceOf(treasuryAddress);
  const borrowerBal = await token.balanceOf(borrowerAddress);
  const protocolBal = await token.balanceOf(protocolAddress);
  // console.log("  Treasury balance:", formatUnits(treasuryBal, 6), "hUSD");
  console.log("  Borrower balance:", formatUnits(borrowerBal, 6), "hUSD");
  console.log("  Treasury/ Controller balance:", formatUnits(protocolBal, 6), "hUSD");
}

export async function hederaBorrow(
  hederaCredit: HederaCreditOApp,
  orderId: string,
  borrowAmount: bigint,
  priceUpdateData: string[],
  borrowValue: any
) {
  const borrowerCredit = hederaCredit.connect(borrowerWallet);
  let staticOk = true;
  try {
    await borrowerCredit.borrow.staticCall(orderId, borrowAmount, priceUpdateData, 300, {
      value: borrowValue,
    });
  } catch (err) {
    staticOk = false;
    console.warn("  ⚠ Borrow static call reverted:", formatRevertError(err));
    console.warn("    Continuing anyway to capture on-chain revert data per debug mode.");
  }
  if (staticOk) {
    console.log("  ✓ Borrow static call passed");
  }
  const borrowTx = await borrowerCredit.borrow(orderId, borrowAmount, priceUpdateData, 300, {
    value: borrowValue,
    gasLimit: 1_500_000,
  });
  const borrowTxHash = borrowTx.hash;
  console.log("  Hedera borrow tx (pending):", hashscanTx(borrowTxHash));
  let receipt: TransactionReceipt | null = null;
  try {
    receipt = await borrowTx.wait();
    console.log("  ✓ Borrow transaction confirmed");
  } catch (err) {
    console.error("  ✗ Borrow transaction reverted:", formatRevertError(err));
    throw err;
  }
  return { borrowerCredit, receipt, txHash: borrowTxHash };
}

export async function logMintAttemptEvents(
  receipt: TransactionReceipt | null,
  controller: UsdHtsController,
  label = "MintAttempt",
  txHash?: string
) {
  const controllerAddr = (await controller.getAddress()).toLowerCase();
  const mintEvent = controller.interface.getEvent("MintAttempt");
  const mintTopic = mintEvent.topicHash;

  const rawLogs = (receipt?.logs ?? []).length > 0
    ? receipt!.logs!
    : await fetchMirrorLogs(txHash);

  if (!rawLogs || rawLogs.length === 0) {
    console.warn("  ⚠ No MintAttempt logs found (receipt/mirror empty).");
    return;
  }

  for (const log of rawLogs) {
    const addr = (log.address ?? "").toLowerCase();
    if (addr !== controllerAddr) continue;
    const topics: string[] = log.topics ?? [];
    if (!topics.length || topics[0] !== mintTopic) continue;
    const parsed = controller.interface.parseLog({
      topics,
      data: log.data ?? "0x",
    });
    const {
      caller,
      to,
      amount,
      rcMint,
      rcTransfer,
      totalMintedBefore,
      totalMintedAfter
    } =
      parsed.args as any;
    console.log(`  ${label}: caller=${caller} to=${to} amount=${amount.toString()}`);
    console.log(
      `    rcMint=${rcMint.toString()} rcTransfer=${rcTransfer.toString()} mintedBefore=${totalMintedBefore.toString()} mintedAfter=${totalMintedAfter.toString()}`
    );
  }
}

async function fetchMirrorLogs(txHash?: string) {
  if (!txHash) return [];
  const hashHex = txHash.replace(/^0x/, "");
  const hashBase64 = Buffer.from(hashHex, "hex").toString("base64");
  const url = `${hederaMirrorUrl}/api/v1/contracts/results/${encodeURIComponent(hashBase64)}/logs`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ Mirror logs fetch failed (${res.status})`);
      return [];
    }
    const data: any = await res.json();
    return (data?.logs ?? []).map((entry: any) => ({
      address: entry?.address ?? "",
      topics: entry?.topics ?? [],
      data: entry?.data ?? "0x",
    }));
  } catch (err) {
    console.warn("  ⚠ Mirror logs fetch error:", err);
    return [];
  }
}

export async function repayTokens(tokenAddress: string, borrowerCanonical: string, repayAmount: bigint) {
  if (repayAmount === 0n) return;
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  const borrowerAccountId = AccountId.fromSolidityAddress(borrowerCanonical);
  const signedAmount = Number(repayAmount);
  if (!Number.isFinite(signedAmount)) {
    throw new Error(`repay amount too large: ${repayAmount.toString()}`);
  }
  const tx = await new TransferTransaction()
    .addTokenTransfer(tokenId, borrowerAccountId, -signedAmount)
    .addTokenTransfer(tokenId, hederaOperatorId, signedAmount)
    .freezeWith(hederaClient);
  const signed = await tx.sign(borrowerHederaKey);
  const response = await signed.execute(hederaClient);
  await response.getReceipt(hederaClient);
}

export async function topUpBorrowerFromTreasury(tokenAddress: string, borrowerAddress: string, amount: bigint) {
  if (amount === 0n) return;
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  const borrowerAccountId = evmAddressToAccountId(borrowerAddress);
  const signedAmount = Number(amount);
  if (!Number.isFinite(signedAmount)) {
    throw new Error(`top-up amount too large: ${amount.toString()}`);
  }
  const tx = await new TransferTransaction()
    .addTokenTransfer(tokenId, hederaOperatorId, -signedAmount)
    .addTokenTransfer(tokenId, borrowerAccountId, signedAmount)
    .freezeWith(hederaClient);
  const signed = await tx.sign(hederaOperatorKey);
  const response = await signed.execute(hederaClient);
  await response.getReceipt(hederaClient);
}

export async function getTokenBalance(tokenAddress: string, ownerAddress: string) {
  const token = new Contract(tokenAddress, ERC20_ABI, hederaProvider);
  return (await token.balanceOf(ownerAddress)) as bigint;
}

export async function getLayerZeroRepayFee(hederaCredit: HederaCreditOApp, orderId: string) {
  const repayFee = await hederaCredit.quoteRepayFee(orderId);
  return getMinFee(repayFee);
}

export async function liquidateOrderEthereum(ethCollateral: EthCollateralOApp, ethSigner: Wallet, orderId: string) {
  const order = await ethCollateral.orders(orderId);
  const feeQuote = await ethCollateral.quoteLiquidationFee(orderId, await ethSigner.getAddress(), order.amountWei);
  const { fee } = getMinFee(feeQuote);
  const tx = await ethCollateral.adminLiquidate(orderId, await ethSigner.getAddress(), order.amountWei, { value: fee });
  return tx.wait();
}

function getMinFee(actualFee: bigint) {
  const fee = actualFee < HEDERA_MIN_VALUE ? HEDERA_MIN_VALUE : actualFee;
  const feeWei = fee * HBAR_WEI_PER_TINYBAR;
  return { fee, feeWei };
}

export async function printEthBalances(contract: EthCollateralOApp, wallet: Wallet) {
  console.log(`  Wallet balance: ${await wallet.provider!.getBalance(await wallet.getAddress())}`);
  console.log(`  Contract balance: ${await wallet.provider!.getBalance(await contract.getAddress())}`);
}

export function formatRevertError(err: any): string {
  if (!err) return "unknown error";

  const extractData = (value: any): string | undefined => {
    if (!value) return undefined;
    if (typeof value === "string" && value.startsWith("0x")) return value;
    if (typeof value.data === "string" && value.data.startsWith("0x")) return value.data;
    return undefined;
  };

  const dataHex = extractData(err) || extractData(err?.error);
  if (dataHex) {
    for (const iface of [reserveRegistryInterface, controllerInterface]) {
      try {
        const decoded = iface.parseError(dataHex);
        return `${decoded.name}(${decoded.args.join(", ")})`;
      } catch (_) {
        // try next interface
      }
    }
  }

  if (err.shortMessage) return err.shortMessage;
  if (err.reason) return err.reason;
  if (err.data?.message) return err.data.message;
  if (err.error?.message) return err.error.message;
  if (err.message) return err.message;
  return JSON.stringify(err, null, 2);
}
