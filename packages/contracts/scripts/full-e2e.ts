import {
  formatEther,
  formatUnits,
  Contract,
  parseUnits,
  ethers,
} from "ethers";
import { AccountId, TokenId, TokenInfoQuery } from "@hashgraph/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  associateAccountWithTokenSdk,
  banner,
  borrowerWallet,
  configureDefaultReserve,
  createOrderEthereum,
  DEFAULT_RESERVE_ID,
  deployEthCollateralOApp,
  deployHederaController,
  deployHederaCreditOApp,
  deployReserveRegistry,
  ethSigner,
  depositWei,
  ORIGINATION_FEE_BPS,
  fetchPythUpdate,
  fundOrderEthereum,
  getBorrowAmount,
  getLayerZeroRepayFee,
  getPriceUpdateFee,
  PYTH_CONTRACT_ADDRESS,
  hederaBorrow,
  hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
  layerzeroTx,
  linkContractsWithLayerZero,
  ensureOperatorHasHbar,
  printBalances,
  repayTokens,
  scalePrice,
  transferOwnership,
  waitForEthRepaid,
  ensureHederaOrderOpen,
  Hex,
  IPYTH_ABI,
  formatRevertError,
  logControllerMintStatus,
  logMintAttemptEvents,
  getTokenBalance,
  canonicalAddressFromAlias,
  borrowerHederaKey,
} from "./util";

// ──────────────────────────────────────────────────────────────────────────────
// Extra debug constants/utilities
// ──────────────────────────────────────────────────────────────────────────────
const hederaMirrorUrl =
  process.env.HEDERA_MIRROR_URL?.trim() ?? "https://testnet.mirrornode.hedera.com";
const MIRROR_DEBUG_DELAY_MS = Number(process.env.MIRROR_DEBUG_DELAY_MS ?? "5000");

async function main() {
  banner("Full cross-chain flow - DEBUG VERSION");

  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();
  const hederaOperatorAccountAddress = ("0x" + hederaOperatorId.toSolidityAddress()) as Hex;
  const borrowerAddress = await borrowerWallet.getAddress();
  const borrowerAccountAddress = await canonicalAddressFromAlias(borrowerAddress);
  const borrowerAccountIdObj = AccountId.fromSolidityAddress(borrowerAccountAddress);
  const borrowerAccountIdStr = borrowerAccountIdObj.toString();
  const borrowerAccountId = borrowerAccountIdStr;

  console.log("Ethereum deployer:", await ethSigner.getAddress());
  console.log(
    "  Balance:",
    formatEther(await ethSigner.provider!.getBalance(await ethSigner.getAddress())),
    "ETH"
  );
  console.log("Hedera operator:", hederaOperatorId.toString());
  console.log("Hedera operator EVM:", hederaOperatorWalletAddress);
  console.log("Hedera operator HEDERA EVM hederaOperatorAccountAddress:", hederaOperatorAccountAddress);
  console.log("Borrower EVM :", borrowerAddress);
  console.log("Borrower HEDERA EVM  borrowerAccountAddress:", borrowerAccountAddress);

  await logMirrorAccountInfo("Treasury account", hederaOperatorId.toString());
  await logMirrorAccountInfo("Borrower account", borrowerAccountIdStr);

  banner("Ensuring Hedera operator has HBAR for fees");
  await ensureOperatorHasHbar(hederaOperatorWalletAddress);

  // ──────────────────────────────────────────────────────────────────────────────
  // Deploy contracts
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Deploying EthCollateralOApp");
  const { ethCollateralAddr, ethCollateral } = await deployEthCollateralOApp();
  console.log("  → EthCollateralOApp:", ethCollateralAddr);

  banner("Deploying Hedera contracts");
  const { controllerAddr, controllerId, controller } = await deployHederaController(
    hederaClient,
    hederaOperatorWallet
  );
  console.log(`  → UsdHtsController: ${controllerAddr}, (${controllerId})`);
  await logMirrorAccountInfo("Controller account", controllerId.toString());

  banner("Deploying ReserveRegistry");
  const { registryAddr, registry } = await deployReserveRegistry(hederaClient, hederaOperatorWallet);
  console.log(`  → ReserveRegistry: ${registryAddr}`);

  banner("Registering default reserve");
  await configureDefaultReserve(registry, controllerAddr, hederaOperatorWalletAddress);
  console.log(`  ✓ Reserve ${DEFAULT_RESERVE_ID} registered`);

  const { hederaCreditAddr, creditId, hederaCredit } = await deployHederaCreditOApp(
    hederaOperatorWallet,
    hederaClient,
    registryAddr
  );
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
    borrowerAddress,
    borrowerAccountAddress,
    depositWei
  );
  await (await hederaCredit.setDebugStopAfterMint(false)).wait();
  console.log("  ✓ Order synced to Hedera");

  // ──────────────────────────────────────────────────────────────────────────────
  // Create HTS token
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Creating HTS token via controller");
  const createTx = await controller.createUsdToken("Hedera Stable USD", "hUSD", 6, "hUSD", {
    value: ethers.parseEther("15"),
    gasLimit: 250_000,
  });
  const createRcpt = await createTx.wait();
  const tokenAddress = await controller.usdToken();
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  console.log("  ?+' Token ID:", tokenId.toString());
  console.log("  ?+' EVM address:", tokenAddress);
  console.log("  ?+' Treasury (controller):", controllerAddr);
  console.log("  ✓ Token creation tx:", createRcpt.hash);
  // ──────────────────────────────────────────────────────────────────────────────
  // Configure controller & token (+ deep diagnostics)
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Debug: Token info snapshot");
  const tokenInfo = await new TokenInfoQuery().setTokenId(tokenId).execute(hederaClient);
  console.log("  Token treasury:", tokenInfo.treasuryAccountId?.toString?.());
  console.log("  Token supply key:", tokenInfo.supplyKey?.toString?.() ?? "<none>");
  console.log("  Token admin key:", tokenInfo.adminKey?.toString?.() ?? "<none>");

  banner("Associating borrower with token (SDK)");
  await associateAccountWithTokenSdk(
    borrowerAccountIdObj,
    borrowerHederaKey,
    tokenId,
    hederaClient,
    "Borrower"
  );
  console.log("  ✓ Borrower associated via SDK");

  const initialOwnerMint = 192n; // 10 billion tokens (6 decimals) for debug mints

  banner("Mirror: token association snapshot");
  await logMirrorAssociations("Treasury", hederaOperatorId.toString(), tokenId.toString());
  await logMirrorAssociations("Borrower", borrowerAccountId, tokenId.toString());
  await logMirrorAssociations("Controller", controllerId.toString(), tokenId.toString());

  await logControllerMintStatus(controller, hederaCreditAddr);

  // Quick static probes before actual mints
  await probeControllerMintStatic(
    controller,
    borrowerAddress,
    Number(initialOwnerMint),
    "Borrower"
  );
  await probeControllerMintStatic(
    controller,
    hederaOperatorWalletAddress,
    Number(initialOwnerMint),
    "Treasury"
  );
  await probeControllerMintStatic(
    controller,
    controllerAddr,
    Number(initialOwnerMint),
    "ControllerSelf"
  );

  // Try real mints (pre-ownership-transfer) to surface allowance/association issues early
  const tokenIdString = tokenId.toString();
  await mintWithDebug(
    controller,
    borrowerAddress,
    Number(initialOwnerMint),
    "Borrower",
    tokenAddress,
    tokenIdString,
    borrowerAccountIdStr
  );
  await mintWithDebug(
    controller,
    hederaOperatorWalletAddress,
    Number(initialOwnerMint),
    "Treasury",
    tokenAddress,
    tokenIdString,
    hederaOperatorId.toString()
  );
  await mintWithDebug(
    controller,
    controllerAddr,
    Number(initialOwnerMint),
    "ControllerSelf",
    tokenAddress,
    tokenIdString,
    controllerId.toString()
  );

  banner("Transferring controller ownership");
  await transferOwnership(controller, hederaCreditAddr);
  const controllerOwner = await controller.owner();
  console.log("  ✓ Controller owned by OApp, owner now:", controllerOwner);

  await logControllerMintStatus(controller, hederaCreditAddr);

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
  console.log("  Pyth update fee (wei):", priceUpdateFee.toString());
  const pythContractView = new Contract(PYTH_CONTRACT_ADDRESS, IPYTH_ABI, hederaOperatorWallet);
  try {
    await pythContractView.getFunction("updatePriceFeeds").staticCall(priceUpdateData, {
      value: priceUpdateFee,
      gasLimit: 2_000_000,
    });
    console.log("  ✓ Pyth update static call passed");
  } catch (err) {
    console.error("  ✗ Pyth update static call reverted:", formatRevertError(err));
  }

  banner("Checking balances BEFORE borrow");
  await printBalances(
    tokenAddress,
    hederaOperatorAccountAddress,
    borrowerAccountAddress,
    hederaOperatorAccountAddress
  );

  console.log(" controller.mintTo static call as HederaCredit");
  try {
    const mintCalldata = controller.interface.encodeFunctionData("mintTo", [
      borrowerAccountAddress,
      borrowAmount,
    ]);
    await hederaOperatorWallet.provider!.call({
      to: controllerAddr,
      from: hederaCreditAddr,
      data: mintCalldata,
    });
    console.log("    ✓ controller.mintTo static call passed");
  } catch (err) {
    console.error("    ✗ controller.mintTo static call reverted:", formatRevertError(err));
  }

  banner("Borrowing");
  console.log("  Step 1: Calling borrow with orderId:", orderId);
  console.log("  Step 2: Borrow amount:", formatUnits(borrowAmount, 6));
  console.log("  Step 3: Price update fee:", priceUpdateFee.toString());

  let borrowResult!: Awaited<ReturnType<typeof hederaBorrow>>;
  try {
    const borrowCalldata = hederaCredit.interface.encodeFunctionData("borrowWithReserve", [
      DEFAULT_RESERVE_ID,
      orderId,
      borrowAmount,
      priceUpdateData,
      0, // maxAgeSecs
    ]);

    console.log("Encoded calldata length:", borrowCalldata.length);

    try {
      await borrowerWallet.provider!.call({
        to: hederaCreditAddr,
        from: borrowerAddress,
        data: borrowCalldata,
        value: priceUpdateFee,
        gasLimit: 2_000_000,
      });
      console.log("  ✓ Static call succeeded");
    } catch (staticErr: any) {
      console.error("  ✗ Static call failed:", formatRevertError(staticErr));
      console.error("  Static call error data:", staticErr.data);
    }

    borrowResult = await hederaBorrow(
      hederaCredit,
      orderId,
      borrowAmount,
      priceUpdateData,
      priceUpdateFee
    );
    await logMintAttemptEvents(
      borrowResult.receipt,
      controller,
      "MintAttempt",
      borrowResult.txHash
    );
    console.log("  ✓ Borrow succeeded");
  } catch (err) {
    console.error("  ✗ Borrow failed:", formatRevertError(err));
    throw err;
  }
  const borrowerCredit = borrowResult.borrowerCredit;

  let borrowerBalance = 0n;
  try {
    borrowerBalance = await getTokenBalance(tokenAddress, borrowerAccountAddress);
  } catch (err) {
    console.warn("  ⚠ Unable to fetch borrower balance:", (err as Error).message ?? err);
  }
  if (borrowerBalance === 0n) {
    console.warn("  ⚠ Borrower balance is zero; skipping fee top-up and repayment for debug run.");
  }

  const repayAmount = borrowAmount;

  banner("Checking balances AFTER borrow");
  await printBalances(
    tokenAddress,
    hederaOperatorAccountAddress,
    borrowerAccountAddress,
    hederaOperatorAccountAddress
  );

  if (borrowerBalance === 0n) {
    console.warn("  ⚠ Skipping repayment because borrower has no tokens to return.");
  }

  banner("Quoting LayerZero fee for repay notify");
  const { fee: repayValue, feeWei: repayValueWei } = await getLayerZeroRepayFee(
    hederaCredit,
    orderId
  );
  console.log("  Sending value:", formatUnits(repayValue, 8), "HBAR (", repayValueWei, " wei)");

  banner("Checking balances prior to repay");
  await printBalances(
    tokenAddress,
    hederaOperatorAccountAddress,
    borrowerAccountAddress,
    hederaOperatorAccountAddress
  );

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
        // ignore
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
  await printBalances(
    tokenAddress,
    hederaOperatorAccountAddress,
    borrowerAddress,
    hederaOperatorAccountAddress
  );

  banner("Waiting for Ethereum repay flag");
  let ethereumRepaid = false;
  try {
    await waitForEthRepaid(ethCollateral, orderId);
    ethereumRepaid = true;
    console.log("  Ethereum order marked repaid");
  } catch (err) {
    console.warn(
      "  ⚠ Timed out waiting for Ethereum repay flag. LayerZero executor may be offline."
    );
  }

  banner("Withdrawing ETH on Ethereum");
  let withdrawalTxHash: string | null = null;
  try {
    const withdrawTx = await ethCollateral.withdraw(orderId);
    await withdrawTx.wait();
    withdrawalTxHash = withdrawTx.hash;
    console.log("  ETH withdrawn");
  } catch (err) {
    console.warn(
      "  ⚠ Withdraw reverted. Order likely still pending the LayerZero repay signal."
    );
  }

  console.log("\n✅ E2E script completed.");
  console.log("   • Repay confirmed on Hedera.");
  if (ethereumRepaid) {
    console.log("   • LayerZero repay flag seen on Ethereum.");
  } else {
    console.log(
      "   • LayerZero repay flag NOT seen on Ethereum (executor offline). You must withdraw manually later."
    );
  }
  if (withdrawalTxHash) {
    console.log("   • Withdrawal tx:", withdrawalTxHash);
  } else {
    console.log(
      "   • Withdrawal was skipped because the contract still marks the order as unrepaid."
    );
  }
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});

// ──────────────────────────────────────────────────────────────────────────────
// Debug helpers (mirror, HTS allowance, probes, mint-with-debug)
// ──────────────────────────────────────────────────────────────────────────────
async function logMirrorAssociations(label: string, accountId: string, tokenId: string) {
  try {
    if (MIRROR_DEBUG_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, MIRROR_DEBUG_DELAY_MS));
    }
    const entry = await fetchMirrorAccountToken(accountId, tokenId);
    if (!entry) {
      console.warn(`  ⚠ Mirror shows no token association for ${label}`);
    } else {
      console.log(
        `  ${label}: associated=${entry.associated} balance=${entry.balance} decimals=${entry.token?.decimals ?? "?"}`
      );
    }
  } catch (err) {
    console.warn(`  ⚠ Mirror association fetch error for ${label}:`, (err as Error).message ?? err);
  }
}

async function probeControllerMintStatic(
  controller: any,
  to: string,
  amount: number,
  label: string
) {
  try {
    const mintFn = controller.getFunction("mintTo");
    await mintFn.staticCall(to, amount);
    console.log(`  ✓ Controller mintTo(${label}) static call passed`);
  } catch (err) {
    console.error(
      `  ✗ Controller mintTo(${label}) static call reverted:`,
      formatRevertError(err as Error)
    );
  }
}

async function fetchMirrorAccountToken(accountId: string, tokenId: string) {
  // First try account token list
  const accountUrl = `${hederaMirrorUrl}/api/v1/accounts/${encodeURIComponent(
    accountId
  )}/tokens?limit=100`;
  try {
    const res = await fetch(accountUrl);
    if (res.ok) {
      const data: any = await res.json();
      const match = (data?.tokens ?? []).find((t: any) => t?.token_id === tokenId);
      if (match) return match;
    }
  } catch {
    // ignore
  }
  // Fallback: query token balances endpoint
  const balancesUrl = `${hederaMirrorUrl}/api/v1/tokens/${encodeURIComponent(
    tokenId
  )}/balances?limit=100&account.id=${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(balancesUrl);
    if (!res.ok) return null;
    const data: any = await res.json();
    const entry = (data?.balances ?? []).find((b: any) => b?.account === accountId);
    if (!entry) return null;
    return {
      associated: entry?.balance !== undefined,
      balance: entry?.balance ?? 0,
      token: { decimals: data?.token?.decimals },
    };
  } catch {
    return null;
  }
}

async function mintWithDebug(
  controller: any,
  to: string,
  amount: number,
  label: string,
  tokenAddress: string,
  tokenId: string,
  mirrorAccountId: string
) {
  try {
    console.log(`  → Minting to ${label} (${to}) amount=${amount}`);
    const tx = await controller.mintTo(to, amount);
    const receipt = await tx.wait();
    console.log(`  ✓ Mint ${label} tx`, receipt.hash);
    await logMintAttemptEvents(receipt, controller, `MintAttempt:${label}`, receipt.hash);
    await logMirrorAccountInfo(`${label} account`, mirrorAccountId);
    await logMirrorAssociations(`${label} (post-mint)`, mirrorAccountId, tokenId);
  } catch (err) {
    console.error(`  ✗ Mint to ${label} failed:`, formatRevertError(err as Error));
    await logMirrorAccountInfo(`${label} account (post-fail)`, mirrorAccountId);
    await logMirrorAssociations(`${label} (post-fail)`, mirrorAccountId, tokenId);
    throw err;
  }
}

async function logMirrorAccountInfo(label: string, accountId: string) {
  try {
    if (!accountId || accountId === "0.0.0") {
      console.log(`  ${label}: <skipped>`);
      return;
    }
    const url = `${hederaMirrorUrl}/api/v1/accounts/${encodeURIComponent(
      accountId
    )}?transactions=false`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ Mirror account fetch failed for ${label} (${res.status})`);
      return;
    }
    const data: any = await res.json();
    const alias = data?.evm_address ?? data?.alias ?? "<none>";
    const balance = data?.balance?.balance ?? "unknown";
    const deleted = data?.deleted ?? false;
    console.log(
      `  ${label}: account=${data?.account ?? accountId} alias=${alias} balance=${balance} deleted=${deleted}`
    );
  } catch (err) {
    console.warn(`  ⚠ Mirror account info error for ${label}:`, (err as Error).message ?? err);
  }
}











