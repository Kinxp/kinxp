import {
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  ContractId,
  TokenCreateTransaction,
  TokenId,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from "@hashgraph/sdk";
import { artifacts, ethers } from "hardhat";
import type { CrossChainDepositGateway } from "../typechain-types";
import {
  ERC20_ABI,
  associateAccountWithTokenSdk,
  banner,
  borrowerHederaKey,
  borrowerWallet,
  canonicalAddressFromAlias,
  ensureOperatorHasHbar,
  formatRevertError,
  hederaLayerZeroEndpoint,
  hederaClient,
  hederaOperatorId,
  hederaOperatorKey,
  hederaOperatorWallet,
} from "./util";
import { Hbar } from "@hashgraph/sdk";

const UNDERLYING_DECIMALS = 6;
const LP_DECIMALS = 6;
const REWARD_DECIMALS = 6;
const INITIAL_DEPOSIT = 1_000_000n; // 1 token (6 decimals)
const CREATE_FEE_HBAR = "15";
const REWARD_RATE = 1_000_000n; // rewards per second (1 token/sec at 6 decimals)
const REWARD_WAIT_MS = 10_000;
const GATEWAY_TOP_UP_HBAR = "2";
const CONTRACT_DEPLOY_GAS = 6_000_000;
const GATEWAY_INIT_GAS = 2_500_000;

async function main() {
  banner("LiquidityPoolV1 - Rewards Demo");

  const operatorAddress = await hederaOperatorWallet.getAddress();
  await ensureOperatorHasHbar(operatorAddress);

  banner("Creating underlying token");
  const underlyingId = await createFungibleToken("Pool Underlying", "PUND", UNDERLYING_DECIMALS, hederaOperatorId);
  const underlyingAddr = ("0x" + underlyingId.toSolidityAddress()) as `0x${string}`;
  console.log("  → Underlying token:", underlyingId.toString());

  banner("Deploying LiquidityPoolV1");
  const { pool, poolAddr, poolContractId } = await deployLiquidityPool(underlyingAddr, operatorAddress);
  console.log("  → Pool address (EVM):", poolAddr);
  console.log("  → Pool ID:", poolContractId.toString());

  banner("Deploying CrossChainDepositGateway");
  const { gateway, gatewayAddr, gatewayContractId } = await deployGateway(poolAddr, underlyingAddr, operatorAddress);
  console.log("  → Gateway address (EVM):", gatewayAddr);
  console.log("  → Gateway ID:", gatewayContractId.toString());

  banner("Creating LP & reward tokens via pool");
  await (
    await pool.createLpToken("Pool LP", "PLP", LP_DECIMALS, {
      value: ethers.parseEther(CREATE_FEE_HBAR),
    })
  ).wait();
  await (
    await pool.createRewardToken("Pool Reward", "PRW", REWARD_DECIMALS, {
      value: ethers.parseEther(CREATE_FEE_HBAR),
    })
  ).wait();
  const lpTokenAddr = await pool.lpToken();
  const rewardTokenAddr = await pool.rewardToken();
  const lpTokenId = TokenId.fromSolidityAddress(lpTokenAddr);
  const rewardTokenId = TokenId.fromSolidityAddress(rewardTokenAddr);
  console.log("  → LP token:", lpTokenId.toString());
  console.log("  → Reward token:", rewardTokenId.toString());

  banner("Initializing deposit gateway");
  await initializeGatewayContract(gateway, gatewayAddr, underlyingAddr, poolAddr);
  console.log(`  → gateway initialized (funded ${GATEWAY_TOP_UP_HBAR} HBAR for HTS ops)`);
  await (await pool.setDepositGateway(gatewayAddr)).wait();
  console.log("  → depositGateway configured on pool");

  banner("Associating borrower with tokens");
  const borrowerAlias = await borrowerWallet.getAddress();
  const borrowerCanonical = await canonicalAddressFromAlias(borrowerAlias);
  const borrowerAccountId = AccountId.fromSolidityAddress(borrowerCanonical);
  await associateAccountWithTokenSdk(borrowerAccountId, borrowerHederaKey, underlyingId, hederaClient, "Borrower (underlying)");
  await associateAccountWithTokenSdk(borrowerAccountId, borrowerHederaKey, lpTokenId, hederaClient, "Borrower (LP)");
  await associateAccountWithTokenSdk(borrowerAccountId, borrowerHederaKey, rewardTokenId, hederaClient, "Borrower (reward)");

  banner("Funding gateway with underlying liquidity");
  await mintToken(underlyingId, INITIAL_DEPOSIT);
  const gatewayAccountId = AccountId.fromString(gatewayContractId.toString());
  await transferToken(underlyingId, hederaOperatorId, gatewayAccountId, INITIAL_DEPOSIT);
  console.log("  → Minted and transferred underlying to gateway");

  const poolAsBorrower = await ethers.getContractAt("LiquidityPoolV1", poolAddr, borrowerWallet);

  banner("Depositing underlying via cross-chain gateway");
  try {
    const txDeposit = await gateway.connect(hederaOperatorWallet).adminDeposit(borrowerAlias, INITIAL_DEPOSIT);
    await txDeposit.wait();
    console.log("  ✓ Gateway deposit executed");
  } catch (err) {
    throw new Error(`gateway adminDeposit failed: ${formatRevertError(err)}`);
  }

  banner("Configuring reward rate");
  try {
    const txSetRate = await pool.setRewardRate(REWARD_RATE);
    await txSetRate.wait();
  } catch (err) {
    throw new Error(`setRewardRate failed: ${formatRevertError(err)}`);
  }
  const accrualStartMs = Date.now();

  console.log(`  Waiting ${REWARD_WAIT_MS}ms to accrue rewards...`);
  await new Promise((resolve) => setTimeout(resolve, REWARD_WAIT_MS));

  banner("Claiming rewards");
  await (await poolAsBorrower.claimRewards()).wait();
  console.log("  ✓ Rewards claimed");

  banner("Withdrawing half of the position");
  const lpBalance = await poolAsBorrower.totalLpShares();
  const half = lpBalance / 2n;
  const lpTokenContract = new ethers.Contract(lpTokenAddr, ERC20_ABI, borrowerWallet);
  await (await lpTokenContract.approve(poolAddr, half)).wait();
  await (await poolAsBorrower.withdraw(half)).wait();
  console.log("  ✓ Withdrawal submitted");

  console.log("\nFinal pool stats:");
  const finalUnderlying = await poolAsBorrower.totalUnderlying();
  const finalLpShares = await poolAsBorrower.totalLpShares();
  const finalExchangeRate = await poolAsBorrower.getExchangeRate();
  console.log("  totalUnderlying:", finalUnderlying);
  console.log("  totalLpShares :", finalLpShares);
  console.log("  exchangeRate  :", finalExchangeRate);

  assertApproxEqual(finalUnderlying, INITIAL_DEPOSIT - half, 10_000n, "remaining underlying");
  assertApproxEqual(finalLpShares, half, 10_000n, "remaining LP shares");

  const rewardTokenContract = new ethers.Contract(rewardTokenAddr, ERC20_ABI, borrowerWallet);
  const rewardBalance = await rewardTokenContract.balanceOf(borrowerAlias);
  console.log("  reward balance:", rewardBalance);
  if (rewardBalance <= 0n) {
    console.error("  ✗ Expected non-zero reward balance – exiting test.");
    process.exit(1);
  }
  const elapsedSec = BigInt(Math.round((Date.now() - accrualStartMs) / 1000));
  const expectedRewards = REWARD_RATE * elapsedSec;
  const tolerance = expectedRewards / 2n + REWARD_RATE * 5n; // allow half deviation + ~5s cushion
  assertApproxEqual(rewardBalance, expectedRewards, tolerance, "reward balance");

  console.log("✅ Liquidity pool rewards test completed successfully.");
  process.exit(0);
}

async function createFungibleToken(
  name: string,
  symbol: string,
  decimals: number,
  treasury: AccountId
) {
  const tx = await new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(treasury)
    .setDecimals(decimals)
    .setInitialSupply(0)
    .setAdminKey(hederaOperatorKey)
    .setSupplyKey(hederaOperatorKey)
    .setAutoRenewAccountId(hederaOperatorId)
    .setAutoRenewPeriod(7_890_000)
    .setMaxTransactionFee(new Hbar(25))
    .freezeWith(hederaClient);
  const signed = await tx.sign(hederaOperatorKey);
  const receipt = await (await signed.execute(hederaClient)).getReceipt(hederaClient);
  return receipt.tokenId!;
}

async function mintToken(tokenId: TokenId, amount: bigint) {
  const tx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .setAmount(Number(amount))
    .freezeWith(hederaClient);
  const signed = await tx.sign(hederaOperatorKey);
  await (await signed.execute(hederaClient)).getReceipt(hederaClient);
}

async function transferToken(tokenId: TokenId, from: AccountId, to: AccountId, amount: bigint) {
  const tx = await new TransferTransaction()
    .addTokenTransfer(tokenId, from, -Number(amount))
    .addTokenTransfer(tokenId, to, Number(amount))
    .freezeWith(hederaClient);
  const signed = await tx.sign(hederaOperatorKey);
  await (await signed.execute(hederaClient)).getReceipt(hederaClient);
}

function assertApproxEqual(actual: bigint, expected: bigint, tolerance: bigint, label: string) {
  const diff = actual > expected ? actual - expected : expected - actual;
  if (diff > tolerance) {
    throw new Error(`${label}: expected ~${expected} (+/-${tolerance}), got ${actual}`);
  }
}

async function deployLiquidityPool(underlyingAddr: `0x${string}`, ownerAddr: string) {
  const artifact = await artifacts.readArtifact("LiquidityPoolV1");
  const params = new ContractFunctionParameters().addAddress(underlyingAddr).addAddress(ownerAddr);
  const createTx = new ContractCreateFlow()
    .setBytecode(artifact.bytecode)
    .setConstructorParameters(params)
    .setGas(CONTRACT_DEPLOY_GAS);
  const response = await createTx.execute(hederaClient);
  const receipt = await response.getReceipt(hederaClient);
  const contractId = receipt.contractId;
  if (!contractId) {
    throw new Error("LiquidityPoolV1 contractId missing from receipt");
  }
  const poolAddr = (`0x${contractId.toSolidityAddress()}`) as `0x${string}`;
  const pool = await ethers.getContractAt("LiquidityPoolV1", poolAddr, hederaOperatorWallet);
  return { pool, poolAddr, poolContractId: contractId };
}

async function deployGateway(poolAddr: `0x${string}`, underlyingAddr: `0x${string}`, ownerAddr: string) {
  const artifact = await artifacts.readArtifact("CrossChainDepositGateway");
  const params = new ContractFunctionParameters()
    .addAddress(poolAddr)
    .addAddress(underlyingAddr)
    .addAddress(hederaLayerZeroEndpoint)
    .addAddress(ownerAddr);
  const createTx = new ContractCreateFlow()
    .setBytecode(artifact.bytecode)
    .setConstructorParameters(params)
    .setGas(CONTRACT_DEPLOY_GAS);
  const response = await createTx.execute(hederaClient);
  const receipt = await response.getReceipt(hederaClient);
  const contractId = receipt.contractId;
  if (!contractId) {
    throw new Error("CrossChainDepositGateway contractId missing from receipt");
  }
  const gatewayAddr = (`0x${contractId.toSolidityAddress()}`) as `0x${string}`;
  const gateway = await ethers.getContractAt("CrossChainDepositGateway", gatewayAddr, hederaOperatorWallet);
  return { gateway, gatewayAddr, gatewayContractId: contractId };
}

async function initializeGatewayContract(
  gateway: CrossChainDepositGateway,
  gatewayAddr: `0x${string}`,
  underlyingAddr: `0x${string}`,
  poolAddr: `0x${string}`
) {
  const underlyingToken = new ethers.Contract(underlyingAddr, ERC20_ABI, hederaOperatorWallet);
  const readyBefore = await gateway.gatewayReady();
  const allowanceBefore = await underlyingToken.allowance(gatewayAddr, poolAddr);
  const balanceBefore = await underlyingToken.balanceOf(gatewayAddr);
  console.log("  → gatewayReady (before):", readyBefore);
  console.log("  → allowance (gateway → pool, before):", allowanceBefore.toString());
  console.log("  → gateway underlying balance (before):", balanceBefore.toString());

  try {
    await gateway.initializeGateway.staticCall({
      value: ethers.parseEther(GATEWAY_TOP_UP_HBAR),
      gasLimit: GATEWAY_INIT_GAS,
    });
    console.log("  → staticCall initializeGateway: success");
  } catch (err) {
    console.warn("  ⚠ staticCall initializeGateway would revert:", formatRevertError(err));
  }

  try {
    const tx = await gateway.initializeGateway({
      value: ethers.parseEther(GATEWAY_TOP_UP_HBAR),
      gasLimit: GATEWAY_INIT_GAS,
    });
    console.log("  → initializeGateway tx hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("  → initializeGateway status:", receipt.status);
  } catch (err) {
    throw new Error(`gateway initialize failed: ${formatRevertError(err)}`);
  }

  const readyAfter = await gateway.gatewayReady();
  const allowanceAfter = await underlyingToken.allowance(gatewayAddr, poolAddr);
  const balanceAfter = await underlyingToken.balanceOf(gatewayAddr);
  console.log("  → gatewayReady (after):", readyAfter);
  console.log("  → allowance (gateway → pool, after):", allowanceAfter.toString());
  console.log("  → gateway underlying balance (after):", balanceAfter.toString());
}

main().catch((err) => {
  console.error("LiquidityPoolV1 demo failed:", err);
  process.exitCode = 1;
});
