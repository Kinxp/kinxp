import {
  formatEther,
  formatUnits,
  Contract,
  parseEther,
} from "ethers";
import {
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  EntityIdHelper,
  TokenId,
} from "@hashgraph/sdk";
import {
  associateAccountWithTokenSdk,
  banner,
  borrowerWallet,            // Hedera signer
  DEFAULT_RESERVE_ID,
  ethSigner,                  // ✅ Sepolia signer you already have
  fetchPythUpdate,
  getPriceUpdateFee,
  hederaClient,
  hederaOperatorWallet,
  ensureOperatorHasHbar,
  scalePrice,
  transferOwnership,
  formatRevertError,
  getTokenBalance,
  canonicalAddressFromAlias,
  borrowerHederaKey,
  deployEthCollateralOApp,
  deployHederaController,
  deployReserveRegistry,
  configureDefaultReserve,
  deployHederaCreditOApp,
  linkContractsWithLayerZero,
} from "./util";
import { artifacts, ethers as hreEthers } from "hardhat";

const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
const HTS_ABI = ["function approve(address token, address spender, uint256 amount) external returns (int64)"];

const TOKEN_DECIMALS = 6;
const WAD_DECIMALS = 18;
const CONTROLLER_BOOTSTRAP_SUPPLY = 1_000_000_000_000n; // 1,000,000 tokens (6 decimals)

async function main() {
  banner("PARTIAL REPAYMENT TEST SUITE");

  const hederaOperatorWalletAddress = await hederaOperatorWallet.getAddress();
  const borrowerHederaEvm = await borrowerWallet.getAddress();
  const borrowerAccountAddress = await canonicalAddressFromAlias(borrowerHederaEvm);
  const borrowerAccountIdObj = AccountId.fromSolidityAddress(borrowerAccountAddress);

  console.log("Hedera operator:", hederaOperatorWalletAddress);
  console.log("Borrower (Hedera EVM):", borrowerHederaEvm);

  await ensureOperatorHasHbar(hederaOperatorWalletAddress);

  banner("Deploying SimpleHtsToken & HTS asset");
  const {
    simpleTokenAddr,
    tokenAddress,
    tokenId,
    tokenContract,
  } = await deploySimpleToken();
  console.log("  → SimpleHtsToken contract:", simpleTokenAddr);
  console.log("  → Token address:", tokenAddress);
  console.log("  → Token ID:", tokenId.toString());

  banner("Deploying UsdHtsController");
  const { controllerAddr, controller } = await deployHederaController(hederaClient, hederaOperatorWallet);
  await (await controller.setUsdToken(tokenAddress, TOKEN_DECIMALS)).wait();
  await (
    await hederaOperatorWallet.sendTransaction({
      to: controllerAddr,
      value: ethers.parseEther("10"),
    })
  ).wait();
  await (await controller.associateToken({ gasLimit: 2_500_000 })).wait();
  console.log("  → Controller address:", controllerAddr);
  await (
    await tokenContract.mintTo(controllerAddr, CONTROLLER_BOOTSTRAP_SUPPLY)
  ).wait();
  console.log(
    "  → Controller bootstrapped with",
    formatUnits(CONTROLLER_BOOTSTRAP_SUPPLY, TOKEN_DECIMALS),
    "tokens"
  );

  banner("Deploying ReserveRegistry");
  const { registryAddr, registry } = await deployReserveRegistry(hederaClient, hederaOperatorWallet);
  await configureDefaultReserve(registry, controllerAddr, hederaOperatorWalletAddress);
  console.log("  → ReserveRegistry address:", registryAddr);

  banner("Deploying HederaCreditOApp");
  const { hederaCreditAddr, hederaCredit } = await deployHederaCreditOApp(
    hederaOperatorWallet,
    hederaClient,
    registryAddr
  );
  console.log("  → HederaCredit address:", hederaCreditAddr);
  await transferOwnership(controller, hederaCreditAddr);
  const hts          = new Contract(HTS_ADDRESS, HTS_ABI, borrowerWallet);

  // Ethereum contract (Sepolia) — util deploys and hooks to ethSigner
  banner("Deploying a single EthCollateralOApp for the entire test suite");
  const { ethCollateralAddr, ethCollateral } = await deployEthCollateralOApp();
  console.log("  → EthCollateralOApp deployed at:", ethCollateralAddr);
  await linkContractsWithLayerZero(ethCollateral, hederaCreditAddr, hederaCredit, ethCollateralAddr);

  // Use ethSigner as the ETH-side borrower/owner for this test
  const borrowerSepolia = ethSigner;
  const ethAsBorrower = ethCollateral.connect(borrowerSepolia);
  console.log("ETH borrower:", await borrowerSepolia.getAddress());
  console.log("ETH borrower balance:", formatEther(await borrowerSepolia.provider!.getBalance(await borrowerSepolia.getAddress())), "ETH");

  // Token info (Hedera)
  // Associate borrower with token (Hedera)
  banner("Associating borrower with token (if needed)");
  try {
    await associateAccountWithTokenSdk(borrowerAccountIdObj, borrowerHederaKey, tokenId, hederaClient, "Borrower");
    console.log("  ✓ Borrower associated");
  } catch (err: any) {
    if (err.message?.includes("TOKEN_ALREADY_ASSOCIATED")) console.log("  ✓ Already associated");
    else throw err;
  }

  // Controller token balance
  banner("Checking controller token balance");
  const controllerBalance = await getTokenBalance(tokenAddress, controllerAddr);
  console.log("  Controller balance:", formatUnits(controllerBalance, TOKEN_DECIMALS), "tokens");

  // Ensure controller owner
  // Price
  banner("Fetching Pyth price");
  const { priceUpdateData, price, expo } = await fetchPythUpdate();
  const scaledPrice = scalePrice(price, expo);
  console.log("  ETH/USD:", formatUnits(scaledPrice, WAD_DECIMALS));
  const { priceUpdateFee } = await getPriceUpdateFee(priceUpdateData);

  // Run two scenarios
  await runScenario({
    scenarioName: "SCENARIO 1: Repay 25% of Debt",
    hederaCredit,
    ethCollateral,
    hts,
    tokenAddress,
    controllerAddr,
    borrowerHedera: borrowerHederaEvm,
    borrowerSepolia,
    priceUpdateData,
    priceUpdateFee,
    scaledPrice,
    repayPercentage: 25,
    collateralWei: parseEther("0.0001"),
  });

  await runScenario({
    scenarioName: "SCENARIO 2: Repay 50% of Debt",
    hederaCredit,
    ethCollateral,
    hts,
    tokenAddress,
    controllerAddr,
    borrowerHedera: borrowerHederaEvm,
    borrowerSepolia,
    priceUpdateData,
    priceUpdateFee,
    scaledPrice,
    repayPercentage: 50,
    collateralWei: parseEther("0.0002"),
  });

  console.log("\n✅ All partial repayment scenarios completed successfully!");
}

interface ScenarioParams {
  scenarioName: string;
  hederaCredit: any;
  ethCollateral: any;
  controllerAddr: string;
  hts: Contract;
  tokenAddress: string;
  borrowerHedera: string;     // Hedera address for credit side
  borrowerSepolia: any;       // ethers.Signer (Sepolia)
  priceUpdateData: string[];
  priceUpdateFee: bigint;
  scaledPrice: bigint;
  repayPercentage: number;
  collateralWei: bigint;
}

async function logOrderState(ethCollateral: any, orderId: string, label: string) {
  const order = await ethCollateral.orders(orderId);
  console.log(`\n  📊 Order State (${label}):`);
  console.log(`     Owner: ${order.owner}`);
  console.log(`     Reserve ID: ${order.reserveId}`);
  console.log(`     Total Collateral (amountWei): ${formatEther(order.amountWei)} ETH`);
  console.log(`     Unlocked Collateral (unlockedWei): ${formatEther(order.unlockedWei)} ETH`);
  console.log(`     Funded: ${order.funded}`);
  console.log(`     Repaid: ${order.repaid}`);
  console.log(`     Liquidated: ${order.liquidated}`);
}

async function deploySimpleToken() {
  const tokenArtifact = await artifacts.readArtifact("SimpleHtsToken");
  const contractCreate = new ContractCreateFlow()
    .setGas(3_000_000)
    .setBytecode(tokenArtifact.bytecode)
    .setConstructorParameters(new ContractFunctionParameters());
  const response = await contractCreate.execute(hederaClient);
  const receipt = await response.getReceipt(hederaClient);
  const contractId = receipt.contractId!;
  const simpleTokenAddr =
    "0x" +
    EntityIdHelper.toSolidityAddress([
      contractId.realm!,
      contractId.shard!,
      contractId.num!,
    ]);
  const tokenContract = await hreEthers.getContractAt(
    "SimpleHtsToken",
    simpleTokenAddr,
    hederaOperatorWallet
  );
  const txCreate = await tokenContract.createToken({
    value: parseEther("15"),
    gasLimit: 2_500_000,
  });
  await txCreate.wait();
  const tokenAddress = await tokenContract.token();
  const tokenId = TokenId.fromSolidityAddress(tokenAddress);
  return { simpleTokenAddr, tokenAddress, tokenId, tokenContract };
}

async function runScenario(params: ScenarioParams) {
  banner(params.scenarioName);

  // ---------- Step 1: Create + fund on Ethereum (Sepolia signer!) ----------
  banner("Step 1: Creating and funding order on Ethereum");
  console.log("  Collateral:", formatEther(params.collateralWei), "ETH");

  const ethAsBorrower = params.ethCollateral.connect(params.borrowerSepolia);

  const createTx = await ethAsBorrower.createOrderIdWithReserve(DEFAULT_RESERVE_ID);
  const createReceipt = await createTx.wait();

  const orderCreatedEvent = createReceipt?.logs
    ?.map((log: any) => { try { return params.ethCollateral.interface.parseLog(log); } catch { return null; } })
    .find((e: any) => e?.name === "OrderCreated");
  if (!orderCreatedEvent) throw new Error("Could not find OrderCreated event in the receipt.");

  const orderId = orderCreatedEvent.args.orderId;
  console.log("  ✓ Order created with on-chain ID:", orderId);

  const fundTx = await ethAsBorrower.fundOrder(orderId, { value: params.collateralWei, gasLimit: 500_000 });
  await fundTx.wait();
  console.log("  ✓ Order funded on Ethereum");

  await logOrderState(params.ethCollateral, orderId, "After Funding");

  // ---------- Step 2: Mirror on Hedera ----------
  banner("Step 2: Mirroring order on Hedera");
  const mirrorHederaTx = await params.hederaCredit.adminMirrorOrder(
    orderId,
    DEFAULT_RESERVE_ID,
    params.borrowerHedera,
    await canonicalAddressFromAlias(params.borrowerHedera),
    params.collateralWei
  );
  await mirrorHederaTx.wait();
  console.log("  ✓ Order mirrored on Hedera");

  // ---------- Step 3: Borrow on Hedera ----------
  const collateralUsdWad = (params.collateralWei * params.scaledPrice) / parseEther("1");
  const maxBorrowWad = (collateralUsdWad * 7000n) / 10000n;
  const borrowAmountWad = (maxBorrowWad * 99n) / 100n;
  const scalingFactor = 10n ** 12n; // 18 - 6
  const borrowAmount = borrowAmountWad / scalingFactor;

  banner("Step 3: Borrowing");
  const borrowerCreditContract = params.hederaCredit.connect(borrowerWallet);
  const borrowTx = await borrowerCreditContract.borrowWithReserve(
    DEFAULT_RESERVE_ID,
    orderId,
    borrowAmount,
    params.priceUpdateData,
    0,
    { value: params.priceUpdateFee, gasLimit: 2_000_000 }
  );
  await borrowTx.wait();
  console.log("  ✓ Borrowed:", formatUnits(borrowAmount, TOKEN_DECIMALS), "USD");

  const debtAfterBorrow = await params.hederaCredit.getOutstandingDebt(orderId);
  console.log("  Outstanding debt:", formatUnits(debtAfterBorrow, TOKEN_DECIMALS), "USD");

  // ---------- Step 4: Approve controller (HTS) ----------
  banner("Step 4: Approving controller");
  const repayAmount = (BigInt(params.repayPercentage) * debtAfterBorrow) / 100n;
  console.log("  Repay amount:", formatUnits(repayAmount, TOKEN_DECIMALS), "USD");
  await (await params.hts.approve(params.tokenAddress, params.controllerAddr, repayAmount, { gasLimit: 2_500_000 })).wait();
  console.log("  ✓ Approved");

  // ---------- Step 5: Partial Repayment ----------
  banner("Step 5: Partial Repayment");
  const repayTx = await borrowerCreditContract.repay(orderId, repayAmount, false, { gasLimit: 1_500_000 });
  const repayReceipt = await repayTx.wait();

  const repayEvent = repayReceipt?.logs
    ?.map((log: any) => { try { return params.hederaCredit.interface.parseLog(log); } catch { return null; } })
    .find((e: any) => e?.name === "RepayApplied");
  if (repayEvent) {
    console.log("  ✓ RepayApplied event found:");
    console.log(`     Repay Amount: ${formatUnits(repayEvent.args.repayBurnAmount, TOKEN_DECIMALS)} USD`);
    console.log(`     Fully Repaid: ${repayEvent.args.fullyRepaid}`);
  }

  const repaidPercentageBps = (repayAmount * 10000n) / debtAfterBorrow;
  const collateralToUnlock = (params.collateralWei * repaidPercentageBps) / 10000n;
  console.log(`  Collateral to unlock: ${formatEther(collateralToUnlock)} ETH (${params.repayPercentage}%)`);

  // ---------- Step 6: Simulate unlock on Ethereum (owner-only) ----------
  banner("Step 6: Simulating Ethereum unlock (admin function)");
  const unlockTx = await params.ethCollateral.adminMirrorRepayment(
    orderId,
    DEFAULT_RESERVE_ID,
    false,
    collateralToUnlock
  );
  const unlockReceipt = await unlockTx.wait();
  console.log("  ✓ adminMirrorRepayment transaction successful");

  const unlockEvents = unlockReceipt?.logs
    ?.map((log: any) => { try { return params.ethCollateral.interface.parseLog(log); } catch { return null; } })
    .filter((e: any) => e !== null);
  console.log(`  Events emitted: ${unlockEvents?.map(e => e?.name).join(", ") || "none"}`);

  await logOrderState(params.ethCollateral, orderId, "After Unlock");

  // ---------- Step 7: Withdraw on Ethereum (Sepolia signer!) ----------
  banner("Step 7: Attempting Withdrawal (Sepolia)");
  const borrowerEthAddr = await params.borrowerSepolia.getAddress();

  const balanceBefore = await params.borrowerSepolia.provider!.getBalance(borrowerEthAddr);
  console.log(`  Borrower ETH balance before: ${formatEther(balanceBefore)} ETH`);

  const withdrawTx = await ethAsBorrower.withdraw(orderId);
  const withdrawReceipt = await withdrawTx.wait();

  const balanceAfter = await params.borrowerSepolia.provider!.getBalance(borrowerEthAddr);
  console.log(`  Borrower ETH balance after: ${formatEther(balanceAfter)} ETH`);

  const gasCost = withdrawReceipt.gasUsed * (withdrawReceipt.effectiveGasPrice ?? 0n);
  const netReceived = balanceAfter + gasCost - balanceBefore;
  console.log(`  Net received (ETH): ${formatEther(netReceived)} (gas-adjusted)`);

  // Pull Withdrawn in the same block
  const events = await params.ethCollateral.queryFilter(
    params.ethCollateral.filters.Withdrawn(orderId, null, borrowerEthAddr),
    withdrawReceipt.blockNumber,
    withdrawReceipt.blockNumber
  );
  if (events.length === 0) console.log("ERRORRRRRRRRRRRRRRRRRR");
  else {
    const e = events[0].args!;
    console.log(`  ✓ Withdrawn event found: ${formatEther(e.amountWei)} ETH`);
  }

  await logOrderState(params.ethCollateral, orderId, "After Withdrawal");
  console.log("  ✓ Withdrawal succeeded (partial collateral withdrawn)");
}

main().catch((err) => {
  console.error("\n❌ Test failed");
  console.error(err);
  process.exitCode = 1;
});
