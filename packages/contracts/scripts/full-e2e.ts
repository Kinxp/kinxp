import { artifacts, ethers } from "hardhat";
import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TokenUpdateTransaction,
  ContractId,
} from "@hashgraph/sdk";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
} from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

type Hex = `0x${string}`;

interface TxRecord {
  label: string;
  hash: string;
  chain: "sepolia" | "hedera" | "layerzero";
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const IPYTH_ABI = [
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
];

function banner(title: string) {
  console.log("\n" + "═".repeat(94));
  console.log(`▶ ${title}`);
  console.log("═".repeat(94) + "\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable ${name}`);
  return value.trim();
}
function requireAddress(name: string): Hex {
  return getAddress(requireEnv(name)) as Hex;
}
function requireEid(name: string): number {
  const raw = requireEnv(name);
  const eid = Number(raw);
  if (!Number.isInteger(eid) || eid <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return eid;
}

const sepoliaTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const layerzeroTx = (h: string) => `https://testnet.layerzeroscan.com/tx/${h}`;
const hashscanTx = (h: string) => `https://hashscan.io/testnet/transaction/${h}`;

function scalePrice(price: bigint, expo: number): bigint {
  const targetDecimals = 18;
  const expDiff = targetDecimals + expo;
  if (expDiff === 0) return price;
  if (expDiff > 0) return price * 10n ** BigInt(expDiff);
  return price / 10n ** BigInt(-expDiff);
}

async function fetchPythUpdate(priceId: Hex) {
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceId}&encoding=hex&parsed=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Pyth price update (${res.status}): ${await res.text()}`);
  const data: any = await res.json();
  if (!data?.binary?.data?.length) throw new Error("No binary price update data in response");
  const priceUpdateBytes = "0x" + data.binary.data[0];

  if (!data?.parsed?.length) throw new Error("No parsed price data in response");
  const parsed = data.parsed[0];
  if (!parsed?.price?.price || parsed.price.expo === undefined) throw new Error("Parsed price data incomplete");

  return { priceUpdateBytes, price: BigInt(parsed.price.price), expo: Number(parsed.price.expo) };
}

async function waitForHederaOrderOpen(hederaCredit: Contract, orderId: Hex, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const order = await hederaCredit.horders(orderId);
      if (order && order.open) return order;
    } catch (err) {
      console.warn(`  [${attempt + 1}/${maxAttempts}] Hedera mirror read failed: ${(err as Error).message}`);
    }
    console.log(`  [${attempt + 1}/${maxAttempts}] Waiting 6s for Hedera mirror...`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error("Timed out waiting for Hedera order mirror");
}

async function main() {
  banner("Full cross-chain flow - DEBUG VERSION");
  const txs: TxRecord[] = [];

  // Params
  const depositEth = parseFloat(process.env.DEPOSIT_ETH ?? "0.00001");
  const depositWei = parseEther(depositEth.toString());
  const borrowSafetyBps = Number(process.env.BORROW_TARGET_BPS ?? "8000");

  // Env
  const ethEndpoint = requireAddress("LZ_ENDPOINT_ETHEREUM");
  const ethEid = requireEid("LZ_EID_ETHEREUM");
  const hederaEndpoint = requireAddress("LZ_ENDPOINT_HEDERA");
  const hederaEid = requireEid("LZ_EID_HEDERA");
  const pythContract = requireAddress("PYTH_CONTRACT_HEDERA");
  const priceFeedId = requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex;

  // Providers
  const ethProvider = new JsonRpcProvider(requireEnv("ETH_RPC_URL"));
  const ethSigner = new Wallet(requireEnv("DEPLOYER_KEY"), ethProvider);

  const hederaRpc = requireEnv("HEDERA_RPC_URL");
  const hederaProvider = new JsonRpcProvider(hederaRpc);

  // Hedera keys
  const hederaOperatorKeyHex = requireEnv("HEDERA_ECDSA_KEY").replace(/^0x/, "");
  const hederaOperatorId = AccountId.fromString(requireEnv("HEDERA_ACCOUNT_ID"));
  const hederaOperatorKey = PrivateKey.fromStringECDSA(hederaOperatorKeyHex);
  const hederaOperatorWallet = new Wallet(hederaOperatorKeyHex, hederaProvider);

  // Borrower = same ECDSA for simplicity
  const borrowerKeyHex = requireEnv("DEPLOYER_KEY").replace(/^0x/, "");
  const borrowerWallet = new Wallet(borrowerKeyHex, hederaProvider);

  // Hedera SDK client (for HTS admin ops)
  const hederaClient = Client.forTestnet();
  hederaClient.setOperator(hederaOperatorId, hederaOperatorKey);
  hederaClient.setDefaultMaxTransactionFee(new Hbar(5));

  console.log("Ethereum deployer:", await ethSigner.getAddress());
  console.log("  Balance:", formatEther(await ethProvider.getBalance(await ethSigner.getAddress())), "ETH");
  console.log("Hedera operator:", hederaOperatorId.toString());
  console.log("Hedera operator EVM:", await hederaOperatorWallet.getAddress());
  console.log("Borrower (shared key):", await borrowerWallet.getAddress());

  // ──────────────────────────────────────────────────────────────────────────────
  // Deploy contracts
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Deploying EthCollateralOApp");
  const EthCollateralFactory = await ethers.getContractFactory("EthCollateralOApp");
  const ethCollateral = await EthCollateralFactory.deploy(ethEndpoint);
  await ethCollateral.waitForDeployment();
  const ethCollateralAddr = (await ethCollateral.getAddress()) as Hex;
  console.log("  → EthCollateralOApp:", ethCollateralAddr);

  banner("Deploying Hedera contracts");
  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");
  const controllerFactory = new ContractFactory(controllerArtifact.abi, controllerArtifact.bytecode, hederaOperatorWallet);
  const controller = await controllerFactory.deploy();
  await controller.waitForDeployment();
  const controllerAddr = (await controller.getAddress()) as Hex;
  console.log("  → UsdHtsController:", controllerAddr);

  const creditArtifact = await artifacts.readArtifact("HederaCreditOApp");
  const creditFactory = new ContractFactory(creditArtifact.abi, creditArtifact.bytecode, hederaOperatorWallet);
  const hederaCredit = await creditFactory.deploy(
    hederaEndpoint,
    await hederaOperatorWallet.getAddress(),
    controllerAddr,
    pythContract,
    priceFeedId
  );
  await hederaCredit.waitForDeployment();
  const hederaCreditAddr = (await hederaCredit.getAddress()) as Hex;
  console.log("  → HederaCreditOApp:", hederaCreditAddr);

  // ──────────────────────────────────────────────────────────────────────────────
  // LZ peer wiring
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Configuring LayerZero peers");
  await (await ethCollateral.setHederaEid(hederaEid)).wait();
  const hedPeerBytes = ethers.zeroPadValue(hederaCreditAddr, 32);
  await (await ethCollateral.setPeer(hederaEid, hedPeerBytes)).wait();
  await (await hederaCredit.setEthEid(ethEid)).wait();
  const ethPeerBytes = ethers.zeroPadValue(ethCollateralAddr, 32);
  await (await hederaCredit.setPeer(ethEid, ethPeerBytes)).wait();

  // ──────────────────────────────────────────────────────────────────────────────
  // Create + fund order on Ethereum
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating order on Ethereum");
  const txCreateOrder = await ethCollateral.createOrderId();
  const createReceipt = await txCreateOrder.wait();
  const createEvent = createReceipt.logs
    .map((log: any) => { try { return ethCollateral.interface.parseLog(log); } catch { return null; } })
    .find((log: any) => log?.name === "OrderCreated");
  if (!createEvent) throw new Error("OrderCreated event not found");
  const orderId = createEvent.args.orderId as Hex;
  console.log("  → Order ID:", orderId);

  banner("Funding order with LayerZero notify");
  const nativeFee: bigint = await ethCollateral.quoteOpenNativeFee(await ethSigner.getAddress(), depositWei);
  let totalValue = depositWei + nativeFee + (nativeFee / 10n);
  
  const txFund = await ethCollateral.fundOrderWithNotify(orderId, depositWei, {
    value: totalValue,
    gasLimit: 600_000,
  });
  await txFund.wait();
  console.log("  LayerZero packet:", layerzeroTx(txFund.hash));

  banner("Waiting for Hedera mirror");
  const hOrder = await waitForHederaOrderOpen(hederaCredit, orderId);
  console.log("  ✓ Order synced to Hedera");

  // ──────────────────────────────────────────────────────────────────────────────
  // Create HTS token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating HTS token");
  const tokenCreateTx = await new TokenCreateTransaction()
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
    .setAutoRenewPeriod(7_776_000)
    .setMaxTransactionFee(new Hbar(20))
    .freezeWith(hederaClient);

  const tokenCreateSign = await tokenCreateTx.sign(hederaOperatorKey);
  const tokenCreateSubmit = await tokenCreateSign.execute(hederaClient);
  const tokenCreateReceipt = await tokenCreateSubmit.getReceipt(hederaClient);
  const tokenId = tokenCreateReceipt.tokenId;
  if (!tokenId) throw new Error("Token creation failed");
  const tokenAddress = ("0x" + tokenId.toSolidityAddress()) as Hex;
  console.log("  → Token ID:", tokenId.toString());
  console.log("  → EVM address:", tokenAddress);
  console.log("  → Treasury:", hederaOperatorId.toString(), "=", await hederaOperatorWallet.getAddress());

  // ──────────────────────────────────────────────────────────────────────────────
  // Configure controller & token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Linking token to controller");
  await (await controller.setExistingUsdToken(tokenAddress, 6)).wait();
  await (await controller.setTreasury(await hederaOperatorWallet.getAddress())).wait();
  console.log("  ✓ Treasury set to:", await hederaOperatorWallet.getAddress());
  await (await controller.associateToken(tokenAddress)).wait();
  console.log("  ✓ Controller associated with token");

  banner("Associating borrower with token");
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = ["function associateToken(address account, address token) external returns (int64)"];
  const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  await (await hts.associateToken(await borrowerWallet.getAddress(), tokenAddress, { gasLimit: 1_000_000 })).wait();
  console.log("  ✓ Borrower associated");

  banner("Transferring supply key to controller");
  const controllerContractId = ContractId.fromEvmAddress(0, 0, controllerAddr);
  const supplyUpdateTx = await new TokenUpdateTransaction()
    .setTokenId(tokenId)
    .setSupplyKey(controllerContractId)
    .freezeWith(hederaClient);
  const supplyUpdateSign = await supplyUpdateTx.sign(hederaOperatorKey);
  await (await supplyUpdateSign.execute(hederaClient)).getReceipt(hederaClient);
  console.log("  ✓ Supply key transferred");

  banner("Transferring controller ownership");
  await (await controller.transferOwnership(hederaCreditAddr)).wait();
  console.log("  ✓ Controller owned by OApp");

  // ──────────────────────────────────────────────────────────────────────────────
  // Test borrow
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Fetching Pyth price");
  const { priceUpdateBytes, price, expo } = await fetchPythUpdate(priceFeedId);
  const scaledPrice = scalePrice(price, expo);
  console.log("  ETH/USD:", formatUnits(scaledPrice, 18));

  banner("Computing borrow amount");
  const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
  const ltvBps = await hederaCredit.ltvBps();
  const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10_000n;
  const borrowTarget18 = (maxBorrow18 * BigInt(borrowSafetyBps)) / 10_000n;
  const borrowAmount = borrowTarget18 / 10n ** 12n; // Convert to 6 decimals
  console.log("  Borrow amount:", formatUnits(borrowAmount, 6), "hUSD");

  const pythContract2 = new Contract(pythContract, IPYTH_ABI, hederaOperatorWallet);
  const priceUpdateData = [priceUpdateBytes];
  const pythFee = await pythContract2.getUpdateFee(priceUpdateData);
  const borrowValue = pythFee < 10_000_000_000n ? 10_000_000_000n : pythFee;

  banner("DEBUG: Checking balances BEFORE borrow");
  const token = new Contract(tokenAddress, ERC20_ABI, borrowerWallet);
  const treasuryBalBefore = await token.balanceOf(await hederaOperatorWallet.getAddress());
  const borrowerBalBefore = await token.balanceOf(await borrowerWallet.getAddress());
  const controllerBalBefore = await token.balanceOf(controllerAddr);
  console.log("  Treasury balance:", formatUnits(treasuryBalBefore, 6), "hUSD");
  console.log("  Borrower balance:", formatUnits(borrowerBalBefore, 6), "hUSD");
  console.log("  Controller balance:", formatUnits(controllerBalBefore, 6), "hUSD");

  banner("Borrowing");
  const borrowerCredit = hederaCredit.connect(borrowerWallet);
  
  try {
    console.log("  Attempting static call...");
    await borrowerCredit.borrow.staticCall(orderId, borrowAmount, priceUpdateData, 300, {
      value: borrowValue,
      gasLimit: 1_500_000,
    });
    console.log("  ✓ Static call passed");
  } catch (err: any) {
    console.error("  ✗ Static call failed:", err.message);
    console.error("  Error data:", err.data);
    throw err;
  }

  const borrowTx = await borrowerCredit.borrow(orderId, borrowAmount, priceUpdateData, 300, {
    value: borrowValue,
    gasLimit: 1_500_000,
  });
  await borrowTx.wait();
  console.log("  ✓ Borrow succeeded");

  banner("DEBUG: Checking balances AFTER borrow");
  const treasuryBalAfter = await token.balanceOf(await hederaOperatorWallet.getAddress());
  const borrowerBalAfter = await token.balanceOf(await borrowerWallet.getAddress());
  const controllerBalAfter = await token.balanceOf(controllerAddr);
  console.log("  Treasury balance:", formatUnits(treasuryBalAfter, 6), "hUSD");
  console.log("  Borrower balance:", formatUnits(borrowerBalAfter, 6), "hUSD");
  console.log("  Controller balance:", formatUnits(controllerBalAfter, 6), "hUSD");

  console.log("\n✅ E2E TEST SUCCESSFUL - BORROW WORKS!");
  console.log("\nNow we know the fix works. The remaining repay/withdraw flow needs similar fixes.");
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});