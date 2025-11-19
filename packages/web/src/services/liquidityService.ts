import { 
  readContract, 
  writeContract, 
  waitForTransactionReceipt,
  switchChain,
  getAccount
} from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { 
  LIQUIDITY_POOL_ADDR, 
  LIQUIDITY_POOL_ABI, 
  ERC20_ABI, 
  HEDERA_CHAIN_ID 
} from '../config';

const ACTIVE_CHAIN_ID = HEDERA_CHAIN_ID;

// --- Types ---

export interface LiquidityPoolInfo {
  totalAssets: bigint;
  totalSupply: bigint;
  rewardRatePerSecond: bigint;
  rewardRatePerDay: bigint;
  assetAddress: `0x${string}`;
  rewardsTokenAddress: `0x${string}`;
  lpTokenAddress: `0x${string}`;
}

export interface UserLiquidityPosition {
  lpBalance: bigint;
  underlyingValue: bigint;
  pendingRewards: bigint;
  sharePercentage: number;
}

// --- Helper Functions ---

/**
 * Checks if the wallet is on Hedera. If not, requests a switch.
 */
async function ensureHederaNetwork() {
  const account = getAccount(wagmiConfig);
  
  if (account.chainId !== ACTIVE_CHAIN_ID) {
    console.log(`Wrong network detected (${account.chainId}). Switching to Hedera (${ACTIVE_CHAIN_ID})...`);
    try {
      await switchChain(wagmiConfig, { chainId: ACTIVE_CHAIN_ID });
    } catch (error) {
      console.error("Failed to switch network", error);
      throw new Error("Please switch your wallet to Hedera Testnet to continue.");
    }
  }
}

// --- Read Functions ---

export async function getLiquidityPoolInfo(): Promise<LiquidityPoolInfo> {
  try {
    const [
      totalUnderlying, 
      totalLpShares, 
      rewardRate, 
      assetAddr, 
      rewardAddr, 
      lpAddr
    ] = await Promise.all([
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'totalUnderlying', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'totalLpShares', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'rewardRatePerSecond', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'underlyingToken', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'rewardToken', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'lpToken', chainId: ACTIVE_CHAIN_ID })
    ]);

    return {
      totalAssets: totalUnderlying as bigint,
      totalSupply: totalLpShares as bigint,
      rewardRatePerSecond: rewardRate as bigint,
      rewardRatePerDay: (rewardRate as bigint) * 86400n,
      assetAddress: assetAddr as `0x${string}`,
      rewardsTokenAddress: rewardAddr as `0x${string}`,
      lpTokenAddress: lpAddr as `0x${string}`,
    };
  } catch (error) {
    console.error('Failed to fetch liquidity pool info:', error);
    throw error;
  }
}

export async function getUserLiquidityPosition(userAddress: `0x${string}`): Promise<UserLiquidityPosition> {
  try {
    const [totalUnderlying, totalLpShares] = await Promise.all([
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'totalUnderlying', chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'totalLpShares', chainId: ACTIVE_CHAIN_ID })
    ]);

    const [lpBalance, pendingRewards] = await Promise.all([
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'lpBalances', args: [userAddress], chainId: ACTIVE_CHAIN_ID }),
      readContract(wagmiConfig, { address: LIQUIDITY_POOL_ADDR, abi: LIQUIDITY_POOL_ABI, functionName: 'pendingRewards', args: [userAddress], chainId: ACTIVE_CHAIN_ID })
    ]);

    const lpBal = lpBalance as bigint;
    const totLp = totalLpShares as bigint;
    const totUnd = totalUnderlying as bigint;

    let underlyingVal = 0n;
    let sharePct = 0;

    if (totLp > 0n) {
      underlyingVal = (lpBal * totUnd) / totLp;
      sharePct = Number((lpBal * 10000n) / totLp) / 100;
    }

    return {
      lpBalance: lpBal,
      underlyingValue: underlyingVal,
      pendingRewards: pendingRewards as bigint,
      sharePercentage: sharePct
    };
  } catch (error) {
    console.error('Failed to fetch user position:', error);
    return {
      lpBalance: 0n,
      underlyingValue: 0n,
      pendingRewards: 0n,
      sharePercentage: 0
    };
  }
}

// --- Write Functions ---

export async function depositLiquidity(
  amountWei: bigint, 
  userAddress: `0x${string}`
): Promise<`0x${string}`> {
  try {
    // 1. Ensure Network Correctness
    await ensureHederaNetwork();

    // 2. Get Underlying Token Address
    const underlyingToken = await readContract(wagmiConfig, {
      address: LIQUIDITY_POOL_ADDR,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'underlyingToken',
      chainId: ACTIVE_CHAIN_ID
    }) as `0x${string}`;

    // 3. Check Allowance
    const allowance = await readContract(wagmiConfig, {
      address: underlyingToken,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress, LIQUIDITY_POOL_ADDR],
      chainId: ACTIVE_CHAIN_ID
    }) as bigint;

    // 4. Approve if necessary
    if (allowance < amountWei) {
      console.log('Approving underlying token...');
      const approveHash = await writeContract(wagmiConfig, {
        address: underlyingToken,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [LIQUIDITY_POOL_ADDR, amountWei],
        chainId: ACTIVE_CHAIN_ID,
        gas: 1_000_000n
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      console.log('Approval confirmed');
    }

    // 5. Deposit
    console.log('Depositing...');
    const txHash = await writeContract(wagmiConfig, {
      address: LIQUIDITY_POOL_ADDR,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'deposit',
      args: [amountWei],
      chainId: ACTIVE_CHAIN_ID,
      gas: 1_000_000n
    });

    await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
    return txHash;
  } catch (error) {
    console.error('Deposit failed:', error);
    throw error;
  }
}

export async function withdrawLiquidity(
  amountLpWei: bigint, 
  userAddress: `0x${string}`
): Promise<`0x${string}`> {
  try {
    // 1. Ensure Network Correctness
    await ensureHederaNetwork();

    const lpToken = await readContract(wagmiConfig, {
      address: LIQUIDITY_POOL_ADDR,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'lpToken',
      chainId: ACTIVE_CHAIN_ID
    }) as `0x${string}`;

    const allowance = await readContract(wagmiConfig, {
      address: lpToken,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress, LIQUIDITY_POOL_ADDR],
      chainId: ACTIVE_CHAIN_ID
    }) as bigint;

    if (allowance < amountLpWei) {
      console.log('Approving LP token for withdrawal...');
      const approveHash = await writeContract(wagmiConfig, {
        address: lpToken,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [LIQUIDITY_POOL_ADDR, amountLpWei],
        chainId: ACTIVE_CHAIN_ID
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      console.log('LP Approval confirmed');
    }

    console.log('Withdrawing...');
    const txHash = await writeContract(wagmiConfig, {
      address: LIQUIDITY_POOL_ADDR,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'withdraw',
      args: [amountLpWei],
      chainId: ACTIVE_CHAIN_ID
    });

    await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
    return txHash;
  } catch (error) {
    console.error('Withdrawal failed:', error);
    throw error;
  }
}

export async function claimLiquidityRewards(): Promise<`0x${string}`> {
  try {
    // 1. Ensure Network Correctness
    await ensureHederaNetwork();

    const txHash = await writeContract(wagmiConfig, {
      address: LIQUIDITY_POOL_ADDR,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'claimRewards',
      args: [],
      chainId: ACTIVE_CHAIN_ID
    });

    await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
    return txHash;
  } catch (error) {
    console.error('Claiming rewards failed:', error);
    throw error;
  }
}