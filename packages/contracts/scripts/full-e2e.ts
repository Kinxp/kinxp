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
  ContractId
} from "@hashgraph/sdk";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  getAddress,
  parseEther
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

function banner(title: string) {
  console.log("\n" + "═".repeat(94));
  console.log(`▶ ${title}`);
  console.log("═".repeat(94) + "\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value.trim();
}

function requireAddress(name: string): Hex {
  return getAddress(requireEnv(name)) as Hex;
}

function requireEid(name: string): number {
  const raw = requireEnv(name);
  const eid = Number(raw);
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return eid;
}

function sepoliaTx(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function layerzeroTx(hash: string) {
  return `https://testnet.layerzeroscan.com/tx/${hash}`;
}

function hashscanTx(hash: string) {
  return `https://hashscan.io/testnet/transaction/${hash}`;
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
  // Use the v2 API endpoint with correct format
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceId}&encoding=hex&parsed=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch Pyth price update (${res.status}): ${errorText}`);
  }
  const data = (await res.json()) as any;
  
  // Extract binary data
  if (!data?.binary?.data || data.binary.data.length === 0) {
    throw new Error("No binary price update data in response");
  }
  const priceUpdateBytes = "0x" + data.binary.data[0];
  
  // Extract parsed price data
  if (!data?.parsed || data.parsed.length === 0) {
    throw new Error("No parsed price data in response");
  }
  const parsedEntry = data.parsed[0];
  if (!parsedEntry?.price?.price || parsedEntry.price.expo === undefined) {
    throw new Error("Parsed price data incomplete");
  }
  
  const price = BigInt(parsedEntry.price.price);
  const expo = Number(parsedEntry.price.expo);
  return { priceUpdateBytes, price, expo };
}

async function waitForHederaOrderOpen(
  hederaCredit: Contract,
  orderId: Hex,
  maxAttempts = 50
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const order = await hederaCredit.horders(orderId);
      if (order && order.open) {
        return order;
      }
    } catch (err) {
      console.warn(
        `  [${attempt + 1}/${maxAttempts}] Hedera mirror read failed: ${
          (err as Error).message
        }`
      );
    }
    console.log(
      `  [${attempt + 1}/${maxAttempts}] Waiting 6s for Hedera mirror...`
    );
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  throw new Error("Timed out waiting for Hedera order mirror");
}

async function waitForEthRepaid(
  ethCollateral: Contract,
  orderId: Hex,
  maxAttempts = 20
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const order = await ethCollateral.orders(orderId);
    if (order.repaid) {
      return;
    }
    console.log(`  [${attempt + 1}/${maxAttempts}] Waiting 6s for LayerZero REPAID...`);
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  throw new Error("Timed out waiting for Ethereum repayment message");
}

async function main() {
  banner("Full cross-chain flow");

  const txs: TxRecord[] = [];

  const depositEth = parseFloat(process.env.DEPOSIT_ETH ?? "0.00001");
  const depositWei = parseEther(depositEth.toString());
  const borrowSafetyBps = Number(process.env.BORROW_TARGET_BPS ?? "8000");

  const ethEndpoint = requireAddress("LZ_ENDPOINT_ETHEREUM");
  const ethEid = requireEid("LZ_EID_ETHEREUM");
  const hederaEndpoint = requireAddress("LZ_ENDPOINT_HEDERA");
  const hederaEid = requireEid("LZ_EID_HEDERA");
  const pythContract = requireAddress("PYTH_CONTRACT_HEDERA");
  const priceFeedId = requireEnv("PYTH_ETHUSD_PRICE_ID") as Hex;

  const ethProvider = new JsonRpcProvider(requireEnv("ETH_RPC_URL"));
  const ethSigner = new Wallet(requireEnv("DEPLOYER_KEY"), ethProvider);

  const hederaRpc = requireEnv("HEDERA_RPC_URL");
  const hederaProvider = new JsonRpcProvider(hederaRpc);

  const hederaOperatorKeyHex = requireEnv("HEDERA_ECDSA_KEY").replace(/^0x/, "");
  const hederaOperatorId = AccountId.fromString(requireEnv("HEDERA_ACCOUNT_ID"));
  const hederaOperatorKey = PrivateKey.fromStringECDSA(hederaOperatorKeyHex);
  const hederaOperatorWallet = new Wallet(hederaOperatorKeyHex, hederaProvider);

  const borrowerKeyHex = requireEnv("DEPLOYER_KEY").replace(/^0x/, "");
  const borrowerWallet = new Wallet(borrowerKeyHex, hederaProvider);

  const hederaClient = Client.forTestnet();
  hederaClient.setOperator(hederaOperatorId, hederaOperatorKey);
  hederaClient.setDefaultMaxTransactionFee(new Hbar(5));

  console.log("Ethereum deployer:", await ethSigner.getAddress());
  console.log(
    "  Balance:",
    formatEther(await ethProvider.getBalance(await ethSigner.getAddress())),
    "ETH"
  );
  console.log("Hedera operator:", hederaOperatorId.toString());
  console.log("Borrower (shared key):", await borrowerWallet.getAddress());

  banner("Deploying EthCollateralOApp");
  const EthCollateralFactory = await ethers.getContractFactory("EthCollateralOApp");
  const ethCollateral = await EthCollateralFactory.deploy(ethEndpoint);
  const ethDeployTx = ethCollateral.deploymentTransaction()?.hash;
  if (ethDeployTx) {
    txs.push({ label: "deploy EthCollateralOApp", hash: ethDeployTx, chain: "sepolia" });
  }
  await ethCollateral.waitForDeployment();
  const ethCollateralAddr = (await ethCollateral.getAddress()) as Hex;
  console.log("  → EthCollateralOApp:", ethCollateralAddr);

  banner("Deploying Hedera contracts");
  const controllerArtifact = await artifacts.readArtifact("UsdHtsController");
  const controllerFactory = new ContractFactory(
    controllerArtifact.abi,
    controllerArtifact.bytecode,
    hederaOperatorWallet
  );
  const controller = await controllerFactory.deploy();
  const controllerDeployTx = controller.deploymentTransaction()?.hash;
  if (controllerDeployTx) {
    txs.push({ label: "deploy UsdHtsController", hash: controllerDeployTx, chain: "hedera" });
  }
  await controller.waitForDeployment();
  const controllerAddr = (await controller.getAddress()) as Hex;
  console.log("  → UsdHtsController:", controllerAddr);

  const creditArtifact = await artifacts.readArtifact("HederaCreditOApp");
  const creditFactory = new ContractFactory(
    creditArtifact.abi,
    creditArtifact.bytecode,
    hederaOperatorWallet
  );
  const hederaCredit = await creditFactory.deploy(
    hederaEndpoint,
    await hederaOperatorWallet.getAddress(),
    controllerAddr,
    pythContract,
    priceFeedId
  );
  const creditDeployTx = hederaCredit.deploymentTransaction()?.hash;
  if (creditDeployTx) {
    txs.push({ label: "deploy HederaCreditOApp", hash: creditDeployTx, chain: "hedera" });
  }
  await hederaCredit.waitForDeployment();
  const hederaCreditAddr = (await hederaCredit.getAddress()) as Hex;
  console.log("  → HederaCreditOApp:", hederaCreditAddr);

  banner("Configuring LayerZero peers");
  const txSetHederaEid = await ethCollateral.setHederaEid(hederaEid);
  txs.push({ label: "EthCollateral.setHederaEid", hash: txSetHederaEid.hash, chain: "sepolia" });
  await txSetHederaEid.wait();

  const hedPeerBytes = ethers.zeroPadValue(hederaCreditAddr, 32);
  const txSetHederaPeer = await ethCollateral.setPeer(hederaEid, hedPeerBytes);
  txs.push({ label: "EthCollateral.setPeer", hash: txSetHederaPeer.hash, chain: "sepolia" });
  await txSetHederaPeer.wait();

  const txSetEthEid = await hederaCredit.setEthEid(ethEid);
  txs.push({ label: "HederaCredit.setEthEid", hash: txSetEthEid.hash, chain: "hedera" });
  await txSetEthEid.wait();

  const ethPeerBytes = ethers.zeroPadValue(ethCollateralAddr, 32);
  const txSetEthPeer = await hederaCredit.setPeer(ethEid, ethPeerBytes);
  txs.push({ label: "HederaCredit.setPeer", hash: txSetEthPeer.hash, chain: "hedera" });
  await txSetEthPeer.wait();

  banner("Creating order on Ethereum");
  const txCreateOrder = await ethCollateral.createOrderId();
  txs.push({ label: "createOrderId", hash: txCreateOrder.hash, chain: "sepolia" });
  const createReceipt = await txCreateOrder.wait();
  const createEvent = createReceipt.logs
    .map((log: any) => {
      try {
        return ethCollateral.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log: any) => log?.name === "OrderCreated");
  if (!createEvent) {
    throw new Error("OrderCreated event not found");
  }
  const orderId = createEvent.args.orderId as Hex;
  console.log("  → Order ID:", orderId);

  banner("Funding order with LayerZero notify");
  const nativeFee: bigint = await ethCollateral.quoteOpenNativeFee(
    await ethSigner.getAddress(),
    depositWei
  );
  const buffer = nativeFee / 20n;
  let totalValue = depositWei + nativeFee + buffer;

  const tryStatic = async (value: bigint) => {
    try {
      await ethCollateral.fundOrderWithNotify.staticCall(orderId, depositWei, {
        value
      });
      return true;
    } catch (err: any) {
      try {
        const parsed = ethCollateral.interface.parseError(err.data);
        if (parsed?.name === "NotEnoughNative") {
          const required = BigInt(parsed.args[0].toString());
          const bump = required / 20n + 1_000_000_000n;
          totalValue = required + bump;
          console.log(
            "  Static call required more value, bumping to",
            formatEther(totalValue),
            "ETH"
          );
          await ethCollateral.fundOrderWithNotify.staticCall(orderId, depositWei, {
            value: totalValue
          });
          return true;
        }
      } catch {
        /* ignore */
      }
      throw err;
    }
  };

  await tryStatic(totalValue);

  const txFund = await ethCollateral.fundOrderWithNotify(orderId, depositWei, {
    value: totalValue,
    gasLimit: 600_000
  });
  txs.push({ label: "fundOrderWithNotify", hash: txFund.hash, chain: "layerzero" });
  const fundReceipt = await txFund.wait();
  console.log("  → Gas used:", fundReceipt.gasUsed?.toString());
  console.log("  LayerZero packet:", layerzeroTx(txFund.hash));

  banner("Waiting for Hedera mirror");
  const hOrder = await waitForHederaOrderOpen(hederaCredit, orderId);
  console.log("  Hedera borrower:", hOrder.borrower);
  console.log("  Hedera collateral:", formatEther(hOrder.ethAmountWei), "ETH");

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
    .setAutoRenewPeriod(7776000)
    .setMaxTransactionFee(new Hbar(20))
    .freezeWith(hederaClient);

  const tokenCreateSign = await tokenCreateTx.sign(hederaOperatorKey);
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
  console.log("  → EVM address:", tokenAddress);

  banner("Linking token to controller");
  const txSetToken = await controller.setExistingUsdToken(tokenAddress, 6);
  txs.push({ label: "controller.setExistingUsdToken", hash: txSetToken.hash, chain: "hedera" });
  await txSetToken.wait();

  const txAssociate = await controller.associateToken(tokenAddress);
  txs.push({ label: "controller.associateToken", hash: txAssociate.hash, chain: "hedera" });
  await txAssociate.wait();

  banner("Associating borrower account with HTS token (via EVM)");
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = [
    "function associateToken(address account, address token) external returns (int64)"
  ];
  const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  const associateTx = await hts.associateToken(
    await borrowerWallet.getAddress(),
    tokenAddress,
    { gasLimit: 1_000_000 }
  );
  txs.push({
    label: "borrower.associateToken (EVM)",
    hash: associateTx.hash,
    chain: "hedera"
  });
  const associateReceipt = await associateTx.wait();
  console.log("  → Gas used:", associateReceipt.gasUsed?.toString() ?? "n/a");

  banner("Transferring supply key to controller");
  const controllerContractId = ContractId.fromEvmAddress(0, 0, controllerAddr);
  const supplyUpdateTx = await new TokenUpdateTransaction()
    .setTokenId(tokenId)
    .setSupplyKey(controllerContractId)
    .freezeWith(hederaClient);
  const supplyUpdateSign = await supplyUpdateTx.sign(hederaOperatorKey);
  const supplyUpdateSubmit = await supplyUpdateSign.execute(hederaClient);
  const supplyReceipt = await supplyUpdateSubmit.getReceipt(hederaClient);
  txs.push({
    label: "transferSupplyKey",
    hash: supplyUpdateSubmit.transactionId.toString(),
    chain: "hedera"
  });
  console.log("  → Status:", supplyReceipt.status.toString());

  banner("Transferring controller ownership to HederaCreditOApp");
  const txTransferOwner = await controller.transferOwnership(hederaCreditAddr);
  txs.push({ label: "controller.transferOwnership", hash: txTransferOwner.hash, chain: "hedera" });
  await txTransferOwner.wait();

  banner("Fetching Pyth price update");
  const { priceUpdateBytes, price, expo } = await fetchPythUpdate(priceFeedId);
  const scaledPrice = scalePrice(price, expo);
  console.log("  Raw price:", price.toString());
  console.log("  Expo:", expo);
  console.log("  Scaled price (1e18):", scaledPrice.toString());

  banner("Computing borrow amount");
  const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
  const ltvBps = await hederaCredit.ltvBps();
  const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10_000n;
  const borrowTarget18 = (maxBorrow18 * BigInt(borrowSafetyBps)) / 10_000n;
  const usdDecimals = 6;
  const decimalsDiff = 18 - usdDecimals;
  const borrowAmount =
    decimalsDiff >= 0
      ? borrowTarget18 / 10n ** BigInt(decimalsDiff)
      : borrowTarget18 * 10n ** BigInt(-decimalsDiff);
  if (borrowAmount <= 0n) {
    throw new Error("Borrow amount computed as zero; adjust parameters");
  }
  console.log("  Max borrow (1e18):", maxBorrow18.toString());
  console.log("  Borrow target (1e18):", borrowTarget18.toString());
  console.log("  Borrow amount (uint64):", borrowAmount.toString());

  const pyth = new Contract(pythContract, IPYTH_ABI, hederaOperatorWallet);
  const priceUpdateData = [priceUpdateBytes];
  const updateFee: bigint = await pyth.getUpdateFee(priceUpdateData);
  console.log("  Pyth update fee:", formatEther(updateFee), "HBAR");

  banner("Borrowing USD on Hedera");
  const borrowerCredit = hederaCredit.connect(borrowerWallet);
  // Hedera requires value to be 0 or >= 10_000_000_000 wei (1 tinybar)
  const minTinybar = 10_000_000_000n;
  const borrowValue = updateFee > 0n ? (updateFee < minTinybar ? minTinybar : updateFee) : 0n;
  console.log("  Adjusted value for tx:", formatEther(borrowValue), "HBAR");
  
  const borrowTx = await borrowerCredit.borrow(
    orderId,
    borrowAmount,
    priceUpdateData,
    300,
    {
      value: borrowValue,
      gasLimit: 1_500_000
    }
  );
  txs.push({ label: "borrow", hash: borrowTx.hash, chain: "hedera" });
  const borrowReceipt = await borrowTx.wait();
  console.log("  → Gas used:", borrowReceipt.gasUsed?.toString() ?? "n/a");

  const token = new Contract(tokenAddress, ERC20_ABI, borrowerWallet);
  const borrowerBalanceAfterBorrow = await token.balanceOf(
    await borrowerWallet.getAddress()
  );
  console.log(
    "  Borrower balance:",
    formatUnits(borrowerBalanceAfterBorrow, usdDecimals),
    "hUSD"
  );

  banner("Preparing tokens for repayment");
  const transferTx = await token.transfer(controllerAddr, borrowAmount);
  txs.push({ label: "transfer hUSD to controller", hash: transferTx.hash, chain: "hedera" });
  await transferTx.wait();

  banner("Repaying on Hedera (with notify)");
  const repayTx = await borrowerCredit.repay(orderId, borrowAmount, true, {
    gasLimit: 1_500_000
  });
  txs.push({ label: "repay", hash: repayTx.hash, chain: "hedera" });
  const repayReceipt = await repayTx.wait();
  console.log("  → Gas used:", repayReceipt.gasUsed?.toString() ?? "n/a");

  banner("Waiting for Ethereum repayment flag");
  await waitForEthRepaid(ethCollateral, orderId);

  banner("Withdrawing ETH collateral");
  const withdrawTx = await ethCollateral.withdraw(orderId);
  txs.push({ label: "withdraw", hash: withdrawTx.hash, chain: "sepolia" });
  const withdrawReceipt = await withdrawTx.wait();
  console.log("  → Gas used:", withdrawReceipt.gasUsed?.toString() ?? "n/a");

  banner("Explorer URLs");
  console.table(
    txs.map((tx) => {
      switch (tx.chain) {
        case "sepolia":
          return { step: tx.label, url: sepoliaTx(tx.hash) };
        case "hedera":
          return { step: tx.label, url: hashscanTx(tx.hash) };
        case "layerzero":
          return { step: tx.label, url: layerzeroTx(tx.hash) };
      }
    })
  );

  banner("Balances");
  const borrowerUsd = await token.balanceOf(await borrowerWallet.getAddress());
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
    formatEther(await ethProvider.getBalance(await ethSigner.getAddress())),
    "ETH"
  );
  console.log(
    "  Hedera operator balance:",
    formatEther(await hederaProvider.getBalance(await hederaOperatorWallet.getAddress())),
    "HBAR"
  );
  console.log(
    "  Borrower (Hedera) balance:",
    formatEther(await hederaProvider.getBalance(await borrowerWallet.getAddress())),
    "HBAR"
  );

  console.log("\n✅ Full E2E flow completed successfully.");
}

main().catch((err) => {
  console.error("\n❌ full-e2e.ts failed");
  console.error(err);
  process.exitCode = 1;
});