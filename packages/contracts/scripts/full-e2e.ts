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
  getLayerZeroRepayFee,
  getPriceUpdateFee, hederaBorrow, hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
  layerzeroTx,
  linkContractsWithLayerZero,
  linkControllerToToken, printBalances, repayTokens, scalePrice,
  transferOwnership,
  transferSupplyKey,
  waitForEthRepaid,
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

  banner("Preparing repayment");
  const repayAmount = borrowAmount;
  console.log("  Repay amount:", formatUnits(repayAmount, 6), "hUSD");
  const treasuryAddress = hederaOperatorWalletAddress;

  banner("Returning hUSD to treasury");
  await repayTokens(tokenAddress, treasuryAddress, repayAmount);
  console.log("  Tokens transferred back to treasury");

  banner("Quoting LayerZero fee for repay notify");
  const { fee: repayValue, feeWei: repayValueWei } = await getLayerZeroRepayFee(hederaCredit, orderId);
  console.log("  Sending value:", formatUnits(repayValue, 8), "HBAR (", repayValueWei, " wei)");

  banner("Checking balances prior to repay");
  await printBalances(tokenAddress, hederaOperatorWalletAddress, await borrowerWallet.getAddress(), controllerAddr);

  banner("Attempting repay static call...");
  try {
    await borrowerCredit.repay.staticCall(orderId, repayAmount, true, {
      value: repayValueWei,
      gasLimit: 1_500_000,
    });
    console.log("  ✓ Static call passed");
  } catch (err: any) {
    const iface = hederaCredit.interface;
    let decoded: any = null;
    if (err.data) {
      try {
        decoded = iface.parseError(err.data);
      } catch (_) {
        // ignore parse failure; we'll rethrow below if unexpected
      }
    }
    if (decoded && (decoded.name === "LzFeeTooLow" || decoded.name === "NotEnoughNative")) {
      console.warn(
        `  Static call expected revert (${decoded.name}) because msg.value cannot be forwarded in static calls`
      );
      console.warn("  Required native fee:", decoded.args?.[0]?.toString?.() ?? "n/a");
      if (decoded.args?.length > 1) {
        console.warn("  Provided native fee:", decoded.args?.[1]?.toString?.() ?? "n/a");
      }
    } else {
      console.error("  Static call failed:", err.shortMessage ?? err.message);
      if (err.data) console.error("  Error data:", err.data);
      throw err;
    }
  }

  banner("Repaying on Hedera");
  const repayTx = await borrowerCredit.repay(orderId, repayAmount, true, {
    value: repayValueWei,
    gasLimit: 1_500_000,
  });
  await repayTx.wait();
  console.log("  Repay succeeded");

  banner("DEBUG: Checking balances AFTER repay");
  await printBalances(tokenAddress, hederaOperatorWalletAddress, await borrowerWallet.getAddress(), controllerAddr);

  banner("Waiting for Ethereum repay flag");
  let ethereumRepaid = false;
  try {
    await waitForEthRepaid(ethCollateral, orderId);
    ethereumRepaid = true;
    console.log("  Ethereum order marked repaid");
  } catch (err) {
    console.warn("  ⚠ Timed out waiting for Ethereum repay flag. LayerZero executor may be offline.");
  }

  banner("Withdrawing ETH on Ethereum");
  try {
    const withdrawTx = await ethCollateral.withdraw(orderId);
    await withdrawTx.wait();
    console.log("  ETH withdrawn");
  } catch (err) {
    console.warn("  ⚠ Withdraw reverted. Order likely still pending the LayerZero repay signal.");
    throw err;
  }

  console.log("\n✅ E2E TEST SUCCESSFUL - REPAY & WITHDRAW COMPLETE!");
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});
