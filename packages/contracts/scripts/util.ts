import {
  AccountAllowanceApproveTransaction,
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  Hbar,
  PrivateKey,
  TokenCreateTransaction,
  TokenUpdateTransaction,
  Client,
  TokenSupplyType,
  TokenType,
  EntityIdHelper,
  ContractId,
  TokenId
} from "@hashgraph/sdk";
import {
  Contract,
  formatUnits,
  getAddress,
  JsonRpcProvider,
  parseEther,
  Wallet,
  zeroPadValue
} from "ethers";
import { artifacts, ethers } from "hardhat";
import { EthCollateralOApp, HederaCreditOApp, UsdHtsController } from "../typechain-types";
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
const priceFeedId = requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex;

const ethProvider = new JsonRpcProvider(requireEnv("ETH_RPC_URL"));
export const ethSigner = new Wallet(requireEnv("DEPLOYER_KEY"), ethProvider);

const hederaRpc = requireEnv("HEDERA_RPC_URL");
const hederaProvider = new JsonRpcProvider(hederaRpc);

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

const depositEth = parseFloat(process.env.DEPOSIT_ETH ?? "0.00001");
const depositWei = parseEther(depositEth.toString());
const borrowSafetyBps = Number(process.env.BORROW_TARGET_BPS ?? "8000");

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

export async function deployHederaController(hederaClient: Client, hederaOperatorWallet: Wallet) {
  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");

  const controllerCreate = new ContractCreateFlow()
    .setGas(10000000)
    .setBytecode(controllerArtifact.bytecode);
  const controllerCreateResponse = await controllerCreate.execute(hederaClient);
  const controllerReceipt = await controllerCreateResponse.getReceipt(hederaClient);
  const controllerId = controllerReceipt.contractId!;
  const controllerAddr = '0x' + EntityIdHelper.toSolidityAddress([
    (controllerReceipt.contractId?.realm)!,
    (controllerReceipt.contractId?.shard)!,
    (controllerReceipt.contractId?.num)!
  ]);

  const controller = await ethers.getContractAt("UsdHtsController", controllerAddr, hederaOperatorWallet);
  return { controllerAddr, controllerId, controller };
}

export async function deployHederaCreditOApp(hederaOperatorWallet: Wallet, controllerAddr: string, hederaClient: Client) {
  const creditArtifact = await artifacts.readArtifact("HederaCreditOApp");

  const creditParams = new ContractFunctionParameters()
    .addAddress(hederaEndpoint)
    .addAddress(await hederaOperatorWallet.getAddress())
    .addAddress(controllerAddr)
    .addAddress(pythContract)
    .addBytes32(Buffer.from(priceFeedId.replace(/^0x/, ""), 'hex'));

  const creditCreate = new ContractCreateFlow()
    .setGas(10000000)
    .setBytecode(creditArtifact.bytecode)
    .setConstructorParameters(creditParams);

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
  const ethCollateral = await EthCollateralFactory.deploy(ethEndpoint);
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
  const nativeFee: bigint = await ethCollateral.quoteOpenNativeFee(await ethSigner.getAddress(), depositWei);
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

export async function associateToken(borrowerWallet: Wallet, tokenAddress: string) {
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = ["function associateToken(address account, address token) external returns (int64)"];
  const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  await (await hts.associateToken(await borrowerWallet.getAddress(), tokenAddress, { gasLimit: 1000000 })).wait();
}

export async function linkControllerToToken(controller: UsdHtsController, tokenAddress: string, hederaOperatorWalletAddress: string) {
  await (await controller.setExistingUsdToken(tokenAddress, 6)).wait();
  await (await controller.setTreasury(hederaOperatorWalletAddress)).wait();
  await (await controller.associateToken(tokenAddress)).wait();
}

export async function approveTokens(tokenId: TokenId, hederaOperatorId: AccountId, controllerId: ContractId, hederaClient: Client, hederaOperatorKey: PrivateKey) {
  const approveTx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(tokenId, hederaOperatorId, controllerId, 1000000000)
    .freezeWith(hederaClient);
  const signApproveTx = await approveTx.sign(hederaOperatorKey);
  const approveResponse = await signApproveTx.execute(hederaClient);
  const approveReceipt = await approveResponse.getReceipt(hederaClient);
  return approveReceipt;
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

export async function printBalances(tokenAddress: string, hederaOperatorWalletAddress: string, borrowerAddress: string, controllerAddr: string) {
  const token = new Contract(tokenAddress, ERC20_ABI, hederaProvider);
  const treasuryBal = await token.balanceOf(hederaOperatorWalletAddress);
  const borrowerBal = await token.balanceOf(borrowerAddress);
  const controllerBal = await token.balanceOf(controllerAddr);
  console.log("  Treasury balance:", formatUnits(treasuryBal, 6), "hUSD");
  console.log("  Borrower balance:", formatUnits(borrowerBal, 6), "hUSD");
  console.log("  Controller balance:", formatUnits(controllerBal, 6), "hUSD");
}

export async function hederaBorrow(hederaCredit: HederaCreditOApp, orderId: string, borrowAmount: bigint, priceUpdateData: string[], borrowValue: any) {
  const borrowerCredit = hederaCredit.connect(borrowerWallet);
  const borrowTx = await borrowerCredit.borrow(orderId, borrowAmount, priceUpdateData, 300, {
    value: borrowValue,
    gasLimit: 1500000,
  });
  await borrowTx.wait();
  return borrowerCredit;
}

export async function repayTokens(tokenAddress: string, treasuryAddress: string, repayAmount: bigint) {
  const token = new Contract(tokenAddress, ERC20_ABI, borrowerWallet);
  const repayTransferTx = await token.transfer(treasuryAddress, repayAmount, { gasLimit: 1000000 });
  await repayTransferTx.wait();
}

export async function getLayerZeroRepayFee(hederaCredit: HederaCreditOApp, orderId: string) {
  const repayFee = await hederaCredit.quoteRepayFee(orderId);
  return getMinFee(repayFee);
}

export async function liquidateOrderEthereum(ethCollateral: EthCollateralOApp, ethSigner: Wallet, orderId: string) {
  const feeQuote = await ethCollateral.quoteLiquidationFee(orderId);
  const { fee } = getMinFee(feeQuote);
  const tx = await ethCollateral.adminLiquidate(orderId, await ethSigner.getAddress(), { value: fee });
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