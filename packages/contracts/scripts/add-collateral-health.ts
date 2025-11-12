import { AccountId, TokenId } from "@hashgraph/sdk";
import { formatEther, formatUnits, parseEther } from "ethers";
import {
  addCollateralEthereum,
  associateAccountWithTokenSdk,
  banner,
  borrowerHederaKey,
  borrowerWallet,
  canonicalAddressFromAlias,
  configureDefaultReserve,
  createOrderEthereum,
  DEFAULT_RESERVE_ID,
  deployEthCollateralOApp,
  deployHederaController,
  deployHederaCreditOApp,
  deployReserveRegistry,
  ensureHederaOrderOpen,
  ensureOperatorHasHbar,
  ethSigner,
  fetchPythUpdate,
  getPriceUpdateFee,
  hederaBorrow,
  hederaClient,
  hederaOperatorWallet,
  linkContractsWithLayerZero,
  scalePrice,
  SKIP_LAYERZERO,
  transferOwnership,
  Hex,
} from "./util";
import { ReserveRegistry__factory } from "../typechain-types";

const ORDER_DEPOSIT_ETH = process.env.ADD_COLLATERAL_DEPOSIT_ETH ?? "0.000005";
const TOP_UP_ETH = process.env.TOP_UP_ETH ?? "0.02";
const BORROW_TARGET_BPS = Number(process.env.ADD_COLLATERAL_BORROW_BPS ?? "6000"); // 60% of borrow headroom
const INITIAL_CONTROLLER_MINT = BigInt(process.env.ADD_COLLATERAL_MINT ?? "10000000000"); // 10k hUSD
const TOKEN_DECIMALS = Number(process.env.ADD_COLLATERAL_TOKEN_DECIMALS ?? "6");
const TOKEN_CONTRACT = process.env.CONTRACT_TOKEN;
const orderDepositWei = parseEther(ORDER_DEPOSIT_ETH);
const topUpWei = parseEther(TOP_UP_ETH);
const WAIT_INTERVAL_MS = 6000;
const WAIT_ATTEMPTS = 40;

async function main() {
  banner("Add Collateral • Health Check");
  console.log(
    "This script opens an order with a tiny deposit, borrows on Hedera, tops up collateral, then repays (admin fallback) and withdraws."
  );
  console.log("You should see LTV drop after the top-up because debt stays constant while collateral rises.\n");

  const borrowerAddress = await borrowerWallet.getAddress();
  const hederaOperatorAddress = await hederaOperatorWallet.getAddress();
  console.log("Borrower (ETH):", await ethSigner.getAddress());
  console.log("Borrower (Hedera EVM):", borrowerAddress);
  console.log("Hedera operator:", hederaOperatorAddress);
  console.log("LayerZero disabled?", SKIP_LAYERZERO);
  console.log("Initial deposit (ETH):", ORDER_DEPOSIT_ETH);
  console.log("Top-up amount (ETH):", TOP_UP_ETH);

  await ensureOperatorHasHbar(hederaOperatorAddress);

  banner("Deploying Ethereum collateral contract");
  const { ethCollateralAddr, ethCollateral } = await deployEthCollateralOApp();
  console.log("  → EthCollateralOApp:", ethCollateralAddr);

  banner("Deploying Hedera controller + registry");
  const { controllerAddr, controller } = await deployHederaController(hederaClient, hederaOperatorWallet);
  const { registryAddr, registry } = await deployReserveRegistry(hederaClient, hederaOperatorWallet);
  console.log("  → ReserveRegistry:", registryAddr);

  banner("Registering default reserve");
  await configureDefaultReserve(registry, controllerAddr, hederaOperatorAddress);

  banner("Deploying Hedera credit OApp");
  const { hederaCreditAddr, hederaCredit } = await deployHederaCreditOApp(
    hederaOperatorWallet,
    hederaClient,
    registryAddr
  );
  console.log("  → HederaCreditOApp:", hederaCreditAddr);

  banner("Linking LayerZero peers");
  await linkContractsWithLayerZero(ethCollateral, hederaCreditAddr, hederaCredit, ethCollateralAddr);

  banner("Creating + funding Ethereum order");
  const orderId = await createOrderEthereum(ethCollateral);
  console.log("  → Order ID:", orderId);
  await fundOrderWithAmount(ethCollateral, orderId, orderDepositWei);

  banner("Waiting for Hedera to mirror order");
  const borrowerCanonical = await canonicalAddressFromAlias(borrowerAddress);
  const borrowerAccountId = AccountId.fromSolidityAddress(borrowerCanonical);

  await ensureHederaOrderOpen(
    hederaCredit,
    orderId,
    DEFAULT_RESERVE_ID,
    borrowerAddress,
    borrowerCanonical,
    orderDepositWei
  );
  console.log("  ✓ Hedera mirror ready");

  await setupTokenAndController(
    controller,
    controllerAddr,
    hederaCreditAddr,
    borrowerAccountId
  );

  banner("Fetching Pyth price + fee data");
  const { priceUpdateData, price, expo } = await fetchPythUpdate();
  const { priceUpdateFee } = await getPriceUpdateFee(priceUpdateData);
  const scaledPrice = scalePrice(price, expo);
  console.log("  → ETH/USD:", formatUnits(scaledPrice, 18));

  const riskConfig = await loadRiskConfig(registryAddr);

  banner("Borrowing on Hedera to create baseline debt");
  const borrowAmount = computeBorrowAmount(orderDepositWei, scaledPrice, riskConfig, BORROW_TARGET_BPS);
  if (borrowAmount === 0n) {
    console.log("  ⚠ Borrow amount evaluated to 0 – increase deposit or TOP_UP_ETH for a meaningful test.");
  } else {
    console.log("  Borrowing:", formatUnits(borrowAmount, 6), "hUSD");
    await hederaBorrow(hederaCredit, orderId, borrowAmount, priceUpdateData, priceUpdateFee);
  }

  banner("Baseline health snapshot");
  const before = await buildHealthSnapshot(hederaCredit, orderId, scaledPrice, riskConfig);
  logHealthSnapshot("Before top-up", before);

  banner(`Adding collateral (${formatEther(topUpWei)} ETH)`);
  await addCollateralEthereum(ethCollateral, ethSigner, orderId, topUpWei, hederaCredit);

  banner("Waiting for Hedera collateral sync");
  await waitForCollateralUpdate(hederaCredit, orderId, before.collateralWei + topUpWei);
  const after = await buildHealthSnapshot(hederaCredit, orderId, scaledPrice, riskConfig);
  logHealthSnapshot("After top-up", after);

  banner("Health delta");
  const deltaMaxBorrow = after.maxBorrowUsd18 - before.maxBorrowUsd18;
  const deltaLiq = after.liquidationThresholdUsd18 - before.liquidationThresholdUsd18;
  console.log("  Δ Collateral:", formatEther(after.collateralWei - before.collateralWei), "ETH");
  console.log("  Δ Max borrow headroom:", formatUnits(deltaMaxBorrow, 18), "USD");
  console.log("  Δ Liquidation threshold:", formatUnits(deltaLiq, 18), "USD");
  console.log("  Current LTV:", Number(after.ltvBps) / 100, "%");

  logLtvExplanation(before, after);

  banner("Repaying (admin fallback) + withdrawing on Ethereum");
  await unlockAndWithdraw(ethCollateral, orderId);
}

async function waitForCollateralUpdate(
  hederaCredit: any,
  orderId: Hex,
  targetWei: bigint
) {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
    const order = await hederaCredit.horders(orderId);
    if (order?.ethAmountWei === targetWei) {
      return;
    }
    console.log(
      `  [${attempt + 1}/${WAIT_ATTEMPTS}] Collateral still ${formatEther(order.ethAmountWei)} ETH – waiting...`
    );
    await delay(WAIT_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for Hedera collateral mirror");
}

async function loadRiskConfig(registryAddr: string) {
  const registry = ReserveRegistry__factory.connect(registryAddr, hederaOperatorWallet);
  return registry.getRiskConfig(DEFAULT_RESERVE_ID);
}

type RiskConfig = Awaited<ReturnType<typeof loadRiskConfig>>;

async function buildHealthSnapshot(
  hederaCredit: any,
  orderId: Hex,
  price1e18: bigint,
  risk: RiskConfig
) {
  const order = await hederaCredit.horders(orderId);
  const collateralWei = order.ethAmountWei as bigint;
  const debtUsd = BigInt(order.borrowedUsd ?? 0n);
  const debtUsd18 = debtUsd * 10n ** 12n;
  const collateralUsd18 = (collateralWei * price1e18) / parseEther("1");
  const maxBorrowUsd18 = (collateralUsd18 * BigInt(risk.maxLtvBps)) / 10_000n;
  const liquidationThresholdUsd18 = (collateralUsd18 * BigInt(risk.liquidationThresholdBps)) / 10_000n;
  const ltvBps =
    collateralUsd18 === 0n ? 0n : (debtUsd18 * 10_000n) / collateralUsd18;
  return {
    collateralWei,
    collateralUsd18,
    debtUsd,
    debtUsd18,
    maxBorrowUsd18,
    liquidationThresholdUsd18,
    ltvBps,
  };
}

function logHealthSnapshot(label: string, snapshot: Awaited<ReturnType<typeof buildHealthSnapshot>>) {
  console.log(`\n${label}:`);
  console.log("  Collateral:", formatEther(snapshot.collateralWei), "ETH");
  console.log("  Collateral USD:", formatUnits(snapshot.collateralUsd18, 18));
  console.log("  Debt:", formatUnits(snapshot.debtUsd, 6), "hUSD");
  console.log("  Max borrow @ LTV:", formatUnits(snapshot.maxBorrowUsd18, 18), "USD");
  console.log("  Liquidation threshold:", formatUnits(snapshot.liquidationThresholdUsd18, 18), "USD");
  console.log("  LTV:", Number(snapshot.ltvBps) / 100, "%");
}

function logLtvExplanation(
  before: Awaited<ReturnType<typeof buildHealthSnapshot>>,
  after: Awaited<ReturnType<typeof buildHealthSnapshot>>
) {
  if (after.debtUsd === 0n) {
    console.log(
      "\nℹ️  LTV remains 0% because there is no outstanding debt. Borrow some USD to see the ratio change."
    );
    return;
  }

  if (after.ltvBps === before.ltvBps) {
    console.log(
      "\nℹ️  LTV stayed constant because both collateral and debt moved proportionally. " +
        "Only changing collateral while debt is fixed will adjust the ratio."
    );
    return;
  }

  const direction = after.ltvBps < before.ltvBps ? "down" : "up";
  console.log(`\nℹ️  LTV moved ${direction} from ${Number(before.ltvBps) / 100}% to ${Number(after.ltvBps) / 100}%.`);
}

function computeBorrowAmount(
  collateralWei: bigint,
  price1e18: bigint,
  risk: RiskConfig,
  targetBps: number
) {
  const wad = parseEther("1");
  const collateralUsd18 = (collateralWei * price1e18) / wad;
  const maxBorrowUsd18 = (collateralUsd18 * BigInt(risk.maxLtvBps)) / 10_000n;
  const targetUsd18 = (maxBorrowUsd18 * BigInt(targetBps)) / 10_000n;
  return targetUsd18 / 1_000_000_000_000n; // convert 1e18 → 1e6 (token decimals)
}

async function unlockAndWithdraw(ethCollateral: any, orderId: Hex) {
  const order = await ethCollateral.orders(orderId);
  if (!order?.funded || order.amountWei === 0n) {
    console.log("  Nothing to withdraw (order already empty).");
    return;
  }

  console.log(
    "  Unlocking",
    formatEther(order.amountWei),
    "ETH via adminMirrorRepayment (LayerZero skipped)."
  );
  await (
    await ethCollateral.adminMirrorRepayment(orderId, DEFAULT_RESERVE_ID, true, order.amountWei)
  ).wait();

  const withdrawTx = await ethCollateral.withdraw(orderId);
  await withdrawTx.wait();
  console.log("  ✓ ETH withdrawn. Tx hash:", withdrawTx.hash);
}

async function setupTokenAndController(
  controller: any,
  controllerAddr: string,
  hederaCreditAddr: string,
  borrowerAccountId: AccountId
) {
  if (!TOKEN_CONTRACT) {
    throw new Error("CONTRACT_TOKEN env var required for add-collateral-health");
  }

  const { ethers: hreEthers } = await import("hardhat");
  const tokenContract = await hreEthers.getContractAt(
    "SimpleHtsToken",
    TOKEN_CONTRACT,
    hederaOperatorWallet
  );
  let tokenAddress = await tokenContract.token();
  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    console.log("  Token not created yet – calling createToken()");
    const createTx = await tokenContract.createToken({
      value: parseEther("15"),
      gasLimit: 2_500_000,
    });
    await createTx.wait();
    tokenAddress = await tokenContract.token();
  }
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);

  banner("Linking HTS token to controller");
  try {
    await (await controller.setUsdToken(tokenAddress, TOKEN_DECIMALS)).wait();
    console.log("  ✓ Token linked to controller");
  } catch (err: any) {
    if ((err?.message ?? "").includes("TokenAlreadyInitialized")) {
      console.log("  ✓ Token already linked");
    } else {
      throw err;
    }
  }

  try {
    await (await controller.associateToken()).wait();
    console.log("  ✓ Controller associated with token");
  } catch (err: any) {
    if ((err?.message ?? "").includes("token already associated")) {
      console.log("  ✓ Controller already associated");
    } else {
      throw err;
    }
  }

  if (INITIAL_CONTROLLER_MINT > 0n) {
    console.log(
      "  Minting",
      formatUnits(INITIAL_CONTROLLER_MINT, TOKEN_DECIMALS),
      "tokens to controller treasury"
    );
    await (
      await tokenContract.mintTo(controllerAddr, INITIAL_CONTROLLER_MINT, {
        gasLimit: 2_500_000,
      })
    ).wait();
  }

  banner("Associating borrower with token");
  await associateAccountWithTokenSdk(
    borrowerAccountId,
    borrowerHederaKey,
    tokenId,
    hederaClient,
    "Borrower"
  );

  banner("Transferring controller ownership to HederaCredit");
  await transferOwnership(controller, hederaCreditAddr);
  console.log("  ✓ Controller ownership transferred");
}

async function fundOrderWithAmount(ethCollateral: any, orderId: Hex, depositAmountWei: bigint) {
  const borrower = ethCollateral.connect(ethSigner);
  if (SKIP_LAYERZERO) {
    const tx = await borrower.fundOrder(orderId, {
      value: depositAmountWei,
      gasLimit: 400_000,
    });
    await tx.wait();
    return;
  }

  const nativeFee = await ethCollateral.quoteOpenNativeFeeWithReserve(
    DEFAULT_RESERVE_ID,
    depositAmountWei
  );
  const buffer = nativeFee / 10n;
  const totalValue = depositAmountWei + nativeFee + buffer;
  const tx = await borrower.fundOrderWithNotify(orderId, depositAmountWei, {
    value: totalValue,
    gasLimit: 650_000,
  });
  await tx.wait();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
