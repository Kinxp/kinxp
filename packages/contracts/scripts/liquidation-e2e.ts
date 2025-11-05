import {
  formatEther,
  formatUnits,
} from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  approveTokens,
  associateToken,
  banner,
  borrowerWallet,
  configureDefaultReserve,
  createHtsToken,
  createOrderEthereum,
  DEFAULT_RESERVE_ID,
  deployEthCollateralOApp,
  deployHederaController,
  deployHederaCreditOApp,
  deployReserveRegistry,
  ethSigner,
  depositWei,
  fetchPythUpdate,
  fundOrderEthereum,
  getBorrowAmount,
  getPriceUpdateFee,
  hederaBorrow,
  hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
  layerzeroTx,
  linkContractsWithLayerZero,
  linkControllerToToken,
  liquidateOrderEthereum,
  printBalances,
  printEthBalances,
  scalePrice,
  transferOwnership,
  transferSupplyKey,
  waitForHederaOrderLiquidated,
  ensureHederaOrderOpen
} from "./util";

async function main() {
  banner("Full cross-chain flow - DEBUG VERSION");

  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress()

  console.log("Ethereum deployer:", await ethSigner.getAddress());
  console.log("  Balance:", formatEther(await ethSigner.provider!.getBalance(await ethSigner.getAddress())), "ETH");
  console.log("Hedera operator:", hederaOperatorId.toString());
  console.log("Hedera operator EVM:", hederaOperatorWalletAddress);
  console.log("Borrower (shared key):", await borrowerWallet.getAddress());

  // ──────────────────────────────────────────────────────────────────────────────
  // Deploy contracts
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Deploying EthCollateralOApp");
  const { ethCollateralAddr, ethCollateral } = await deployEthCollateralOApp();
  console.log("  → EthCollateralOApp:", ethCollateralAddr);

  banner("Deploying Hedera contracts");
  const { controllerAddr, controllerId, controller } = await deployHederaController(hederaClient, hederaOperatorWallet);
  console.log(`  → UsdHtsController: ${controllerAddr}, (${controllerId})`);

  banner("Deploying ReserveRegistry");
  const { registryAddr, registry } = await deployReserveRegistry(hederaClient, hederaOperatorWallet);
  console.log(`  → ReserveRegistry: ${registryAddr}`);

  banner("Registering default reserve");
  await configureDefaultReserve(registry, controllerAddr, hederaOperatorWalletAddress);
  console.log(`  ✓ Reserve ${DEFAULT_RESERVE_ID} registered`);

  const { hederaCreditAddr, creditId, hederaCredit } = await deployHederaCreditOApp(hederaOperatorWallet, hederaClient, registryAddr);
  console.log(`  → HederaCreditOApp: ${hederaCreditAddr}, (${creditId})`);

  // ──────────────────────────────────────────────────────────────────────────────
  // LZ peer wiring
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Configuring LayerZero peers");
  await linkContractsWithLayerZero(ethCollateral, hederaCreditAddr, hederaCredit, ethCollateralAddr);

  // ──────────────────────────────────────────────────────────────────────────────
  // Create + fund order on Ethereum
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating order on Ethereum");
  const orderId = await createOrderEthereum(ethCollateral);
  console.log("  → Order ID:", orderId);

  banner("Funding order with LayerZero notify");
  const txFund = await fundOrderEthereum(ethCollateral, ethSigner, orderId);
  console.log("  LayerZero packet:", layerzeroTx(txFund.hash));

  banner("Waiting for Hedera mirror");
  const hOrder = await ensureHederaOrderOpen(
    hederaCredit,
    orderId,
    DEFAULT_RESERVE_ID,
    await borrowerWallet.getAddress(),
    depositWei
  );
  console.log("  ✓ Order synced to Hedera");

  // ──────────────────────────────────────────────────────────────────────────────
  // Create HTS token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating HTS token");
  const { tokenId, tokenAddress } = await createHtsToken(hederaOperatorId, hederaOperatorKey, hederaClient);
  console.log("  → Token ID:", tokenId.toString());
  console.log("  → EVM address:", tokenAddress);
  console.log("  → Treasury:", hederaOperatorId.toString(), "=", hederaOperatorWalletAddress);

  // ──────────────────────────────────────────────────────────────────────────────
  // Configure controller & token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Linking token to controller");
  await linkControllerToToken(controller, tokenAddress, hederaOperatorWalletAddress);
  console.log("  ✓ Treasury set to:", hederaOperatorWalletAddress);
  console.log("  ✓ Controller associated with token");

  banner("Associating borrower with token");
  await associateToken(borrowerWallet, tokenAddress);
  console.log("  ✓ Borrower associated");

  banner("Transferring supply key to controller");
  await transferSupplyKey(tokenId, controllerId, hederaClient, hederaOperatorKey);
  console.log("  ✓ Supply key transferred");

  banner("Transferring controller ownership");
  await transferOwnership(controller, hederaCreditAddr);
  console.log("  ✓ Controller owned by OApp");

  banner("Approve controller to spend tokens from the treasury");
  const approveReceipt = await approveTokens(tokenId, hederaOperatorId, controllerId, creditId, hederaClient, hederaOperatorKey);
  console.log(`  ✓ Approval transaction status: ${approveReceipt.status}`);

  // ──────────────────────────────────────────────────────────────────────────────
  // Test borrow
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Fetching Pyth price");
  const { priceUpdateData, price, expo } = await fetchPythUpdate();
  const scaledPrice = scalePrice(price, expo);
  console.log("  ETH/USD:", formatUnits(scaledPrice, 18));

  banner("Computing borrow amount");
  const borrowAmount = await getBorrowAmount(scaledPrice, hederaCredit);
  console.log("  Borrow amount:", formatUnits(borrowAmount, 6), "hUSD");

  const { priceUpdateFee } = await getPriceUpdateFee(priceUpdateData);

  banner("Checking balances BEFORE borrow");
  await printBalances(tokenAddress, hederaOperatorWalletAddress, await borrowerWallet.getAddress(), controllerAddr);

  banner("Borrowing");
  const borrowerCredit = await hederaBorrow(hederaCredit, orderId, borrowAmount, priceUpdateData, priceUpdateFee);
  console.log("  ✓ Borrow succeeded");

  banner("Checking balances AFTER borrow");
  await printBalances(tokenAddress, hederaOperatorWalletAddress, await borrowerWallet.getAddress(), controllerAddr);

  banner("Checking ETH balances before liquidation");
  await printEthBalances(ethCollateral, ethSigner);

  banner("Liquidating order on Ethereum");
  const txLiquidate = await liquidateOrderEthereum(ethCollateral, ethSigner, orderId);
  if (txLiquidate?.status === 1) {
    console.log(`  ✓ Liquidation transaction successful!`);
  } else {
    throw new Error('Liquidation transaction failed!');
  }
  
  banner("Checking ETH balances after liquidation");
  await printEthBalances(ethCollateral, ethSigner);

  banner("Waiting for liquidation message on Hedera");
  const order = await waitForHederaOrderLiquidated(hederaCredit, orderId);
  if (!order.open) {
    console.log(`  ✓ Order on Hedera closed!`);
  } else {
    throw new Error('Order on Hedera not closed, even though it was liquidated!')
  }

  console.log("\n✅ E2E TEST SUCCESSFUL - LIQUIDATION COMPLETE!");
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});
