import {
  formatEther,
  formatUnits,
  Contract,
  parseUnits,
  parseEther,
  ethers,
} from "ethers";
import {
  AccountId,
  AccountInfoQuery,
  TokenId,
  TokenInfoQuery,
} from "@hashgraph/sdk";
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
  banner("E2E Borrow");

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

  banner("E2E ADDRESES");

  console.log("Hedera operator / TREASURY ID:", hederaOperatorId.toString());
  console.log("Hedera operator / TREASURY EVM:", hederaOperatorWalletAddress);
  // console.log("Hedera operator / TREASURY EVM hederaOperatorAccountAddress:", hederaOperatorAccountAddress);

  banner("--");

  
  console.log("Borrower EVM :", borrowerAddress);
  console.log("Borrower HEDERA EVM  borrowerAccountAddress:", borrowerAccountAddress);

  // await logMirrorAccountInfo("Treasury account", hederaOperatorId.toString());
  // await logMirrorAccountInfo("Borrower account", borrowerAccountIdStr);

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

  banner("HEDERA CREDIT OAPP");

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
  // Create/Link Token and Setup Controller
  // ──────────────────────────────────────────────────────────────────────────────
  banner("Setting up token for controller");

  let tokenAddress: string;
  let tokenId: TokenId;

  // Check if token contract address is provided in env, otherwise deploy new token
  const CONTRACT_TOKEN = process.env.CONTRACT_TOKEN
  
  // if (CONTRACT_TOKEN) {
    // Use existing token contract
    console.log("  → Using existing token contract:", CONTRACT_TOKEN);
    const { ethers: hreEthers } = await import("hardhat");
    const tokenContract = await hreEthers.getContractAt("SimpleHtsToken", CONTRACT_TOKEN, hederaOperatorWallet);
    tokenAddress = await tokenContract.token();
    if (tokenAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("Token not created in contract yet. Please create token first.");
    }
    tokenId = TokenId.fromSolidityAddress(tokenAddress);
    console.log("  → Token address:", tokenAddress);
    console.log("  → Token ID:", tokenId.toString());
  // } else {
  //   // Deploy new token contract and create token
  //   banner("Deploying new token contract");
  //   const { ContractCreateFlow, ContractFunctionParameters } = await import("@hashgraph/sdk");
  //   const { EntityIdHelper } = await import("@hashgraph/sdk");
  //   const { artifacts } = await import("hardhat");
    
  //   const tokenArtifact = await artifacts.readArtifact("SimpleHtsToken");
  //   const tokenCreate = new ContractCreateFlow()
  //     .setGas(3_000_000)
  //     .setBytecode(tokenArtifact.bytecode)
  //     .setConstructorParameters(new ContractFunctionParameters());
    
  //   const tokenCreateResponse = await tokenCreate.execute(hederaClient);
  //   const tokenReceipt = await tokenCreateResponse.getReceipt(hederaClient);
  //   const tokenContractId = tokenReceipt.contractId!;
  //   const tokenContractAddr = '0x' + EntityIdHelper.toSolidityAddress([
  //     tokenContractId.realm!,
  //     tokenContractId.shard!,
  //     tokenContractId.num!
  //   ]);
    
    // console.log(`  → Token contract deployed: ${tokenContractAddr}`);
    
    // const { ethers: hreEthers } = await import("hardhat");
    // const tokenContract = await hreEthers.getContractAt("SimpleHtsToken", tokenContractAddr, hederaOperatorWallet);
    
    // banner("Creating HTS token");
    // const createTx = await tokenContract.createToken({
    //   value: parseEther("15"),
    //   gasLimit: 2_500_000,
    // });
    // const createReceipt = await createTx.wait();
    // if (!createReceipt) {
    //   throw new Error("Token creation failed - no receipt");
    // }
    
    // tokenAddress = await tokenContract.token();
    // tokenId = TokenId.fromSolidityAddress(tokenAddress);
    // console.log(`  → Token created: ${tokenAddress}`);
    // console.log(`  → Token ID: ${tokenId.toString()}`);
  // }

  // Link token to controller
  banner("Linking token to controller");
  try {
    const linkTx = await (controller as any).setUsdToken(tokenAddress, 6);
    await linkTx.wait();
    console.log("  ✓ Token linked to controller");
  } catch (err) {
    console.error("  ✗ Failed to link token:", formatRevertError(err));
    throw err;
  }

  // Associate controller with token
  banner("Associating controller with token");
  try {
    const associateTx = await (controller as any).associateToken();
    await associateTx.wait();
    console.log("  ✓ Controller associated with token ", associateTx);
  } catch (err) {
    console.error("  ✗ Failed to associate:", formatRevertError(err));
    throw err;
  }
  

  // Mint initial tokens to controller treasury (10,000 tokens = 10_000_000_000 with 6 decimals)
  banner("Minting initial tokens to controller");
  const initialMintAmount = 10_000_000_000; // 10,000 tokens
  const mintTx = await tokenContract.mintTo(controllerAddr, initialMintAmount, {
    gasLimit: 2_500_000,
  });
  await mintTx.wait();
  console.log(`  ✓ Minted ${formatUnits(BigInt(initialMintAmount), 6)} tokens to controller treasury`);

  // Associate borrower with token
  banner("Associating borrower with token");
  await associateAccountWithTokenSdk(
    borrowerAccountIdObj,
    borrowerHederaKey,
    tokenId,
    hederaClient,
    "Borrower"
  );
  console.log("  ✓ Borrower associated via SDK");
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
    controllerAddr
  );

  console.log(" controller.transferTo static call as HederaCredit");
  try {
    const transferCalldata = (controller as any).interface.encodeFunctionData("transferTo", [
      borrowerAccountAddress,
      borrowAmount,
    ]);
    await hederaOperatorWallet.provider!.call({
      to: controllerAddr,
      from: hederaCreditAddr,
      data: transferCalldata,
    });
    console.log("    ✓ controller.transferTo static call passed");
  } catch (err) {
    console.error("    ✗ controller.transferTo static call reverted:", formatRevertError(err));
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
    // await logMintAttemptEvents(
    //   borrowResult.receipt,
    //   controller,
    //   "MintAttempt",
    //   borrowResult.txHash
    // );
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
    controllerAddr
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
    controllerAddr
  );

  const decimals = Number(await controller.usdDecimals());
  const tokenIdForAllowance = TokenId.fromSolidityAddress(tokenAddress).toString();
  const borrowerAccountInfo = await new AccountInfoQuery()
    .setAccountId(borrowerAccountIdObj)
    .execute(hederaClient);
  const borrowerAllowance = borrowerAccountInfo.tokenAllowances.find(
    (allowance) =>
      allowance.tokenId.toString() === tokenIdForAllowance &&
      allowance.spenderAccountId?.toString() === controllerId.toString()
  );
  const allowanceValue = borrowerAllowance?.amount
    ? BigInt(borrowerAllowance.amount.toString())
    : 0n;
  console.log(
    "  Borrower allowance to controller before approve:",
    formatUnits(allowanceValue, decimals),
    "hUSD"
  );

  banner("Approving controller to spend hUSD (via HTS precompile)");
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
  const HTS_ABI = ["function approve(address token, address spender, uint256 amount) external returns (int64)"];
  const hts = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);
  
  try {
    console.log("   Static calling HTS approve...");
    await hts.approve.staticCall(tokenAddress, controllerAddr, repayAmount, {
      gasLimit: 2_500_000,
    });
    console.log("    ✓ HTS approve static call passed");
  } catch (err) {
    console.warn(
      "    ⚠ HTS approve static call reverted:",
      formatRevertError(err as Error)
    );
  }

  try {
    const approveTx = await hts.approve(tokenAddress, controllerAddr, repayAmount, {
      gasLimit: 2_500_000,
    });
    const approveReceipt = await approveTx.wait();
    console.log("    ✓ Borrower approved controller to spend tokens");
    console.log("    → Approve tx:", approveReceipt.hash);
  } catch (err) {
    console.error(
      "    ✗ HTS approve tx failed:",
      formatRevertError(err as Error)
    );
    throw err;
  }

    const allowanceValueAfter = borrowerAllowance?.amount
    ? BigInt(borrowerAllowance.amount.toString())
    : 0n;
  console.log(
    "  Borrower allowance to controller after approve:",
    formatUnits(allowanceValueAfter, decimals),
    "hUSD"
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
    controllerAddr
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











