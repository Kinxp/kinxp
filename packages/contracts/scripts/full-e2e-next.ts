import { artifacts, ethers } from "hardhat";
import {
  AccountId,
  Client,
  ContractId,
  Hbar,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TokenUpdateTransaction
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
  parseUnits
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
  "function transfer(address to, uint256 amount) returns (bool)"
];

const IPYTH_ABI = [
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)"
];

function parseArgs(): Record<string, string> {
  const argv = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const [key, value] = arg.split("=");
    if (key && value) {
      out[key.replace(/^--/, "")] = value;
    }
  }
  return out;
}

function requireArg(args: Record<string, string>, key: string): string {
  const val = args[key];
  if (!val) {
    throw new Error(`Missing required argument --${key}`);
  }
  return val;
}

function banner(title: string) {
  console.log("\n" + "═".repeat(94));
  console.log(`▶ ${title}`);
  console.log("═".repeat(94) + "\n");
}

function sepoliaTx(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function layerzeroTx(hash: string) {
  return `https://testnet.layerzeroscan.com/tx/${hash}`;
}

function hashscanTx(txId: string) {
  return `https://hashscan.io/testnet/transaction/${txId}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value.trim();
}

function scalePrice(price: bigint, expo: number): bigint {
  const targetDecimals = 18;
  const expDiff = targetDecimals + expo;
  if (expDiff === 0) {
    return price;
  }
  if (expDiff > 0) {
    return price * 10n ** BigInt(expDiff);
  }
  return price / 10n ** BigInt(-expDiff);
}

async function fetchPythUpdate(priceId: Hex) {
  const url = `https://hermes.pyth.network/api/latest_price_updates?ids[]=${priceId}&binary=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Pyth price update: ${res.statusText}`);
  }
  const data = (await res.json()) as any;
  const updateEntry = data?.binary?.price_updates?.find(
    (entry: any) =>
      entry?.price_feed_id?.toLowerCase() === priceId.toLowerCase()
  );
  if (!updateEntry?.price_update) {
    throw new Error("Price update not found in Hermes response");
  }
  const priceUpdateBytes = "0x" + Buffer.from(updateEntry.price_update, "base64").toString("hex");
  const parsedEntry = data?.parsed?.price_updates?.find(
    (entry: any) =>
      entry?.price_feed_id?.toLowerCase() === priceId.toLowerCase()
  );
  if (!parsedEntry?.price?.price || parsedEntry.price.expo === undefined) {
    throw new Error("Parsed price data missing");
  }
  const price = BigInt(parsedEntry.price.price);
  const expo = Number(parsedEntry.price.expo);
  return { priceUpdateBytes, price, expo };
}

async function waitForEthRepaid(
  ethCollateral: Contract,
  orderId: Hex,
  maxAttempts = 20
) {
  for (let i = 0; i < maxAttempts; i++) {
    const order = await ethCollateral.orders(orderId);
    if (order.repaid) {
      return;
    }
    console.log(`  [${i + 1}/${maxAttempts}] Waiting for LayerZero REPAID message...`);
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  throw new Error("Timed out waiting for Ethereum repayment flag");
}

async function main() {
  banner("Cross-chain flow continuation");

  const args = parseArgs();
  const ethCollateralAddr = getAddress(requireArg(args, "ethCollateral")) as Hex;
  const hederaCreditAddr = getAddress(requireArg(args, "hederaCredit")) as Hex;
  const controllerAddr = getAddress(requireArg(args, "usdController")) as Hex;
  const previousLzTx = requireArg(args, "lzTx");
  const orderId = requireArg(args, "orderId") as Hex;

  const depositEth = parseFloat(args.depositEth ?? process.env.DEPOSIT_ETH ?? "0.00001");
  const usdDecimals = Number(args.usdDecimals ?? "6");
  const borrowSafetyBps = Number(args.borrowBps ?? "8000"); // 80% of max by default

  const hederaRpc = requireEnv("HEDERA_RPC_URL");
  const hederaKeyHex = requireEnv("HEDERA_ECDSA_KEY").replace(/^0x/, "");
  const hederaAccountId = requireEnv("HEDERA_ACCOUNT_ID");
  const ethRpc = requireEnv("ETH_RPC_URL");
  const ethPrivKey = requireEnv("DEPLOYER_KEY");
  const pythContractAddr = getAddress(requireEnv("PYTH_CONTRACT_HEDERA")) as Hex;
  const priceFeedId = requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex;

  const hederaProvider = new JsonRpcProvider(hederaRpc);
  const hederaSigner = new Wallet(hederaKeyHex, hederaProvider);
  const sepoliaProvider = new JsonRpcProvider(ethRpc);
  const sepoliaSigner = new Wallet(ethPrivKey, sepoliaProvider);

  const txs: TxRecord[] = [
    {
      label: "fundOrderWithNotify",
      hash: previousLzTx,
      chain: "layerzero"
    }
  ];

  const hederaClient = Client.forTestnet();
  hederaClient.setOperator(
    AccountId.fromString(hederaAccountId),
    PrivateKey.fromStringECDSA(hederaKeyHex)
  );
  hederaClient.setDefaultMaxTransactionFee(new Hbar(5));

  const depositWei = parseEther(depositEth.toString());

  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");
  const hederaCreditArtifact = await artifacts.readArtifact("HederaCreditOApp");
  const ethCollateralArtifact = await artifacts.readArtifact("EthCollateralOApp");

  const controller = new Contract(
    controllerAddr,
    controllerArtifact.abi,
    hederaSigner
  );
  const hederaCredit = new Contract(
    hederaCreditAddr,
    hederaCreditArtifact.abi,
    hederaSigner
  );
  const ethCollateral = new Contract(
    ethCollateralAddr,
    ethCollateralArtifact.abi,
    sepoliaSigner
  );

  banner("Creating HTS token");
  const tokenCreateTx = await new TokenCreateTransaction()
    .setTokenName("Hedera Stable USD (Autogen)")
    .setTokenSymbol("hUSD")
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(usdDecimals)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(AccountId.fromString(hederaAccountId))
    .setSupplyKey(PrivateKey.fromStringECDSA(hederaKeyHex))
    .setAdminKey(PrivateKey.fromStringECDSA(hederaKeyHex))
    .setAutoRenewAccountId(AccountId.fromString(hederaAccountId))
    .freezeWith(hederaClient);

  const tokenCreateSign = await tokenCreateTx.sign(
    PrivateKey.fromStringECDSA(hederaKeyHex)
  );
  const tokenCreateSubmit = await tokenCreateSign.execute(hederaClient);
  const tokenCreateReceipt = await tokenCreateSubmit.getReceipt(hederaClient);
  const tokenId = tokenCreateReceipt.tokenId;
  if (!tokenId) {
    throw new Error("Token creation failed");
  }
  const tokenAddress = ("0x" + tokenId.toSolidityAddress()) as Hex;
  txs.push({
    label: "createHTSToken",
    hash: tokenCreateSubmit.transactionId.toString(),
    chain: "hedera"
  });
  console.log("  → Token ID:", tokenId.toString());
  console.log("  → Token EVM address:", tokenAddress);

  banner("Linking HTS token to controller");
  const setTokenTx = await controller.setExistingUsdToken(tokenAddress, usdDecimals);
  txs.push({ label: "setExistingUsdToken", hash: setTokenTx.hash, chain: "hedera" });
  await setTokenTx.wait();

  const associateTx = await controller.associateToken(tokenAddress);
  txs.push({ label: "associateToken", hash: associateTx.hash, chain: "hedera" });
  await associateTx.wait();

  banner("Transferring HTS supply key to controller");
  const controllerContractId = ContractId.fromEvmAddress(0, 0, controllerAddr);
  const supplyUpdateTx = await new TokenUpdateTransaction()
    .setTokenId(tokenId)
    .setSupplyKey(controllerContractId)
    .freezeWith(hederaClient);
  const supplyUpdateSign = await supplyUpdateTx.sign(
    PrivateKey.fromStringECDSA(hederaKeyHex)
  );
  const supplyUpdateSubmit = await supplyUpdateSign.execute(hederaClient);
  const supplyReceipt = await supplyUpdateSubmit.getReceipt(hederaClient);
  txs.push({
    label: "transferSupplyKey",
    hash: supplyUpdateSubmit.transactionId.toString(),
    chain: "hedera"
  });
  console.log("  → Supply transfer status:", supplyReceipt.status.toString());

  banner("Transferring controller ownership to HederaCreditOApp");
  const ownershipTx = await controller.transferOwnership(hederaCreditAddr);
  txs.push({ label: "controller.transferOwnership", hash: ownershipTx.hash, chain: "hedera" });
  await ownershipTx.wait();

  banner("Fetching Pyth price update");
  const { priceUpdateBytes, price, expo } = await fetchPythUpdate(priceFeedId);
  const priceScaled = scalePrice(price, expo);
  console.log("  → Raw price:", price.toString());
  console.log("  → Expo:", expo);
  console.log("  → Scaled price (1e18):", priceScaled.toString());

  banner("Computing borrow amount");
  const collateralUsd18 = (depositWei * priceScaled) / parseEther("1");
  const ltvBps = await hederaCredit.ltvBps();
  const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10000n;
  const borrowTarget18 = (maxBorrow18 * BigInt(borrowSafetyBps)) / 10000n;
  const borrowAmount = (() => {
    const decimalsDiff = 18 - usdDecimals;
    if (decimalsDiff >= 0) {
      return borrowTarget18 / 10n ** BigInt(decimalsDiff);
    }
    return borrowTarget18 * 10n ** BigInt(-decimalsDiff);
  })();
  if (borrowAmount <= 0n) {
    throw new Error("Calculated borrow amount is zero; increase deposit or adjust borrowBps");
  }
  console.log("  Deposit (ETH):", formatEther(depositWei));
  console.log("  Max borrow (USD 1e18):", maxBorrow18.toString());
  console.log("  Borrow amount (uint64, decimals =", usdDecimals, "):", borrowAmount.toString());

  const pyth = new Contract(pythContractAddr, IPYTH_ABI, hederaSigner);
  const priceUpdateData = [priceUpdateBytes];
  const updateFee: bigint = await pyth.getUpdateFee(priceUpdateData);
  console.log("  Pyth update fee:", formatEther(updateFee), "HBAR");

  banner("Borrowing USD on Hedera");
  const borrowTx = await hederaCredit.borrow(
    orderId,
    borrowAmount,
    priceUpdateData,
    300,
    {
      value: updateFee,
      gasLimit: 1_500_000
    }
  );
  txs.push({ label: "borrow", hash: borrowTx.hash, chain: "hedera" });
  const borrowReceipt = await borrowTx.wait();
  console.log("  → Gas used:", borrowReceipt.gasUsed?.toString() ?? "n/a");

  const token = new Contract(tokenAddress, ERC20_ABI, hederaSigner);
  const borrowerBalanceAfterBorrow = await token.balanceOf(hederaSigner.address);
  console.log(
    "  Borrower balance:",
    formatUnits(borrowerBalanceAfterBorrow, usdDecimals),
    "hUSD"
  );

  banner("Preparing for repayment");
  const transferTx = await token.transfer(controllerAddr, borrowAmount);
  txs.push({ label: "transfer hUSD to controller", hash: transferTx.hash, chain: "hedera" });
  await transferTx.wait();

  const repayTx = await hederaCredit.repay(orderId, borrowAmount, true, {
    gasLimit: 1_500_000
  });
  txs.push({ label: "repay", hash: repayTx.hash, chain: "hedera" });
  const repayReceipt = await repayTx.wait();
  console.log("  → Repay gas:", repayReceipt.gasUsed?.toString() ?? "n/a");

  banner("Waiting for Ethereum repayment message");
  await waitForEthRepaid(ethCollateral, orderId);

  banner("Withdrawing ETH on Ethereum");
  const withdrawTx = await ethCollateral.withdraw(orderId);
  txs.push({ label: "withdraw", hash: withdrawTx.hash, chain: "sepolia" });
  const withdrawReceipt = await withdrawTx.wait();
  console.log("  → Withdraw gas:", withdrawReceipt.gasUsed?.toString() ?? "n/a");

  banner("Explorer URLs");
  const urlTable = txs.map((tx) => {
    switch (tx.chain) {
      case "sepolia":
        return { step: tx.label, url: sepoliaTx(tx.hash) };
      case "hedera":
        return { step: tx.label, url: hashscanTx(tx.hash) };
      case "layerzero":
        return { step: tx.label, url: layerzeroTx(tx.hash) };
      default:
        return { step: tx.label, url: tx.hash };
    }
  });
  console.table(urlTable);

  banner("Balances");
  const borrowerUsd = await token.balanceOf(hederaSigner.address);
  const controllerUsd = await token.balanceOf(controllerAddr);
  console.log(
    "  Borrower USD balance:",
    formatUnits(borrowerUsd, usdDecimals),
    "hUSD"
  );
  console.log(
    "  Controller USD balance:",
    formatUnits(controllerUsd, usdDecimals),
    "hUSD"
  );
  console.log(
    "  Ethereum signer balance:",
    formatEther(await sepoliaProvider.getBalance(sepoliaSigner.address)),
    "ETH"
  );
  console.log(
    "  Hedera signer balance:",
    formatEther(await hederaProvider.getBalance(hederaSigner.address)),
    "HBAR"
  );

  console.log("\n✅ Full flow complete.");
}

main().catch((err) => {
  console.error("\n❌ follow-up flow failed");
  console.error(err);
  process.exitCode = 1;
});
