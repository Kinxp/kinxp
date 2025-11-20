// packages/web/api/mirror/withdraw.ts
import type { ApiRequest, ApiResponse } from '../types';
import { ethers } from 'ethers';
import { createClient } from 'redis';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);


// Environment variables
const ETH_COLLATERAL_OAPP_ADDR = (process.env.VITE_ETH_COLLATERAL_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_CREDIT_OAPP_ADDR = (process.env.VITE_HEDERA_CREDIT_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL;
const MIRROR_ADMIN_PRIVATE_KEY = process.env.DEPLOYER_KEY;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;

// Log environment variables and contract addresses
console.log('=== WITHDRAW MIRROR ENVIRONMENT ===');
console.log('VITE_ETH_COLLATERAL_OAPP:', process.env.VITE_ETH_COLLATERAL_OAPP ? '***SET***' : 'NOT SET');
console.log('VITE_HEDERA_CREDIT_OAPP:', process.env.VITE_HEDERA_CREDIT_OAPP ? '***SET***' : 'NOT SET');
console.log('HEDERA_RPC_URL:', HEDERA_RPC_URL ? '***SET***' : 'NOT SET');
console.log('MIRROR_ADMIN_WITHDRAW_PRIVATE_KEY:', MIRROR_ADMIN_PRIVATE_KEY ? '***SET***' : 'NOT SET');
console.log('SEPOLIA_RPC_URL:', SEPOLIA_RPC_URL ? '***SET***' : 'NOT SET');

console.log('\n=== CONTRACT ADDRESSES ===');
console.log('ETH_COLLATERAL_OAPP_ADDR:', ETH_COLLATERAL_OAPP_ADDR);
console.log('HEDERA_CREDIT_OAPP_ADDR:', HEDERA_CREDIT_OAPP_ADDR);

// Validate contract addresses
if (ETH_COLLATERAL_OAPP_ADDR === '0x...' || HEDERA_CREDIT_OAPP_ADDR === '0x...') {
  console.error('ERROR: Contract addresses are using default values. Please set the correct environment variables.');
}

if (!HEDERA_RPC_URL || !SEPOLIA_RPC_URL || !MIRROR_ADMIN_PRIVATE_KEY) {
  console.error('ERROR: Missing required environment variables');
}

// Load ABIs
const EthCollateralAbi = require('../../src/abis/EthCollateralOApp.json');
const HederaCreditAbi = require('../../src/abis/HederaCreditOApp.json'); 
const ETH_COLLATERAL_ABI = EthCollateralAbi.abi;
const HEDERA_CREDIT_ABI = HederaCreditAbi.abi;

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

const RAY = 10n ** 27n;
const toRay = (amount: bigint, decimals: number) => {
  const exponent = BigInt(27 - decimals);
  return amount * 10n ** exponent;
};
const rayMul = (a: bigint, b: bigint) => {
  if (a === 0n || b === 0n) return 0n;
  return (a * b) / RAY;
};

export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  console.log('=== WITHDRAW MIRROR REQUEST START ===');
  console.log('Request method:', request.method);
  console.log('Request headers:', request.headers);
  console.log('Request body:', request.body);

  if (request.method !== 'POST') {
    const error = 'Method Not Allowed';
    console.error('Error:', error);
    return response.status(405).json({ 
      success: false,
      error
    });
  }
  const redis = await createClient({ url: process.env.REDIS_URL }).connect();
  try {
    const { orderId, txHash, collateralToWithdraw, reserveId, receiver } = request.body;
    // In future this bridge would not be used (was supposed to be layer0 - direct Hedera settlement)
    // This is a temporary measure while we migrate to direct Hedera settlement
    const txAlreadySent = await redis.get(`withdraw_${txHash}`);
    if(txAlreadySent == "true"){
      return response.status(400).json({ 
        success: false,
        error: `Transaction already sent` 
      });
    }

    console.log('Parsed request body:', { orderId, txHash, collateralToWithdraw, reserveId, receiver });
    
    if (!orderId || !txHash || collateralToWithdraw === undefined || !reserveId || !receiver) {
      const error = `Missing required parameters. Received: ${JSON.stringify({
        hasOrderId: !!orderId,
        hasTxHash: !!txHash,
        hasCollateralToWithdraw: collateralToWithdraw !== undefined,
        hasReserveId: !!reserveId,
        hasReceiver: !!receiver
      })}`;
      
      console.error('Validation error:', error);
      return response.status(400).json({ 
        success: false,
        error: `Missing required parameters: ${error}` 
      });
    }

    // 1. Verify Hedera transaction first
    console.log('Verifying Hedera transaction...');
    let hederaProvider;
    let hederaTx;
    
    try {
      if (!HEDERA_RPC_URL) {
        throw new Error('HEDERA_RPC_URL environment variable is not set');
      }
      
      console.log('Creating Hedera provider with URL:', HEDERA_RPC_URL);
      
      // Initialize provider with minimal configuration
      hederaProvider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
      
      // Disable ENS resolution
      hederaProvider.getResolver = async () => null;
      hederaProvider.resolveName = async (name: string) => {
        if (ethers.isAddress(name)) return name;
        return null;
      };
      
      // Test the connection
      const network = await hederaProvider.getNetwork();
      console.log('Connected to Hedera network:', {
        name: network.name,
        chainId: network.chainId.toString()
      });
      
      console.log('Fetching transaction:', txHash);
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        hederaTx = await hederaProvider.getTransaction(txHash);
        
        if (hederaTx) {
          console.log('Transaction found on Hedera after', attempts + 1, 'attempts');
          break; // Found it!
        }
        
        console.log(`Transaction not found yet. Attempt ${attempts + 1}/${maxAttempts}. Waiting 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        attempts++;
      }
      
      if (!hederaTx) {
        const error = 'Transaction not found on Hedera';
        console.error(error);
        return response.status(404).json({ 
          success: false,
          error
        });
      }

    } catch (error) {
      console.error('Error verifying Hedera transaction:', error);
      return response.status(500).json({
        success: false,
        error: `Failed to verify Hedera transaction: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }

    // 2. Wait for Hedera transaction to be mined
    console.log('Waiting for Hedera transaction to be mined...');
    let hederaReceipt;
    
    try {
      hederaReceipt = await hederaTx.wait();
      console.log('Hedera transaction receipt:', {
        blockNumber: hederaReceipt?.blockNumber,
        status: hederaReceipt?.status,
        logsCount: hederaReceipt?.logs?.length,
        gasUsed: hederaReceipt?.gasUsed?.toString(),
        contractAddress: hederaReceipt?.contractAddress,
        transactionLogs: hederaReceipt?.logs?.map((log: any, i: number) => ({
          index: i,
          address: log.address,
          topics: log.topics,
          data: log.data
        }))
      });
      
      if (!hederaReceipt || !hederaReceipt.status) {
        const error = 'Hedera transaction failed or not found';
        console.error(error, { receipt: hederaReceipt });
        return response.status(400).json({ 
          success: false,
          error
        });
      }
    } catch (error) {
      console.error('Error waiting for transaction receipt:', error);
      return response.status(500).json({
        success: false,
        error: `Failed to get transaction receipt: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }

    // 3. Check order status on Hedera (read-only)
    if (!HEDERA_RPC_URL) {
      return response.status(500).json({ 
        success: false,
        error: 'Server configuration error' 
      });
    }

    const hederaCredit = new ethers.Contract(
      HEDERA_CREDIT_OAPP_ADDR,
      HEDERA_CREDIT_ABI,
      hederaProvider
    );

    const order = await hederaCredit.positions(orderId);
    if (!order) {
      return response.status(400).json({ 
        success: false,
        error: 'Order not found on Hedera' 
      });
    }
    const collateralWei = BigInt(order?.collateralWei?.toString?.() ?? '0');

    const hederaInterface = new ethers.Interface(HEDERA_CREDIT_ABI);
    const repayLog = hederaReceipt.logs
      ?.map((log: any) => {
        if (!log?.topics?.length) return null;
        try {
          return hederaInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log: any) => log?.name === 'RepayApplied' && log?.args?.orderId?.toLowerCase?.() === orderId.toLowerCase());

    if (!repayLog) {
      if (collateralToWithdraw && BigInt(collateralToWithdraw) > 0n) {
        console.warn('RepayApplied event missing; using provided collateralToWithdraw');
        const sepoliaProviderFallback = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, 'sepolia');
        const sepoliaSignerFallback = new ethers.Wallet(MIRROR_ADMIN_PRIVATE_KEY!, sepoliaProviderFallback);
        const ethCollateralFallback = new ethers.Contract(
          ETH_COLLATERAL_OAPP_ADDR,
          ETH_COLLATERAL_ABI,
          sepoliaSignerFallback
        );
        const fallbackTx = await ethCollateralFallback.adminMirrorRepayment(
          orderId,
          reserveId,
          false,
          BigInt(collateralToWithdraw)
        );
        const fallbackReceipt = await fallbackTx.wait();
        await redis.set(`withdraw_${txHash}`, 'true');

        return response.status(200).json({
          success: true,
          message: 'Collateral unlock processed successfully (manual amount)',
          txHash: fallbackReceipt.transactionHash
        });
      }
      throw new Error('RepayApplied event not found in Hedera receipt');
    }

    const repayAmountTokens = BigInt(repayLog.args?.repayBurnAmount?.toString() ?? '0');
    const remainingScaledDebtRay = BigInt(repayLog.args?.remainingDebtRay?.toString() ?? '0');
    const eventFullyRepaid = Boolean(repayLog.args?.fullyRepaid);
    const eventReserveId = (repayLog.args?.reserveId as `0x${string}` | undefined) || reserveId;

    const reserveState = await hederaCredit.reserveStates(eventReserveId);
    const variableBorrowIndexRaw = BigInt(reserveState?.variableBorrowIndex?.toString?.() ?? '0');
    const borrowIndex = variableBorrowIndexRaw === 0n ? RAY : variableBorrowIndexRaw;
    const remainingDebtRay = rayMul(remainingScaledDebtRay, borrowIndex);
    const repayRay = toRay(repayAmountTokens, 6); // hUSD has 6 decimals
    const totalDebtRay = repayRay + remainingDebtRay;

    let computedCollateralUnlock = totalDebtRay === 0n ? collateralWei : (collateralWei * repayRay) / totalDebtRay;
    if (computedCollateralUnlock === 0n && eventFullyRepaid) {
      computedCollateralUnlock = collateralWei;
    }

    let unlockAmount = computedCollateralUnlock;
    if (unlockAmount === 0n && collateralToWithdraw) {
      unlockAmount = BigInt(collateralToWithdraw);
    }

    if (unlockAmount === 0n) {
      throw new Error('Calculated collateral to unlock is zero');
    }

    // 4. Execute withdrawal on Sepolia
    console.log('Initializing Sepolia provider...');
    if (!MIRROR_ADMIN_PRIVATE_KEY) {
      throw new Error('MIRROR_ADMIN_WITHDRAW_PRIVATE_KEY is not configured');
    }

    const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, 'sepolia');
    const sepoliaSigner = new ethers.Wallet(MIRROR_ADMIN_PRIVATE_KEY, sepoliaProvider);
    
    const ethCollateral = new ethers.Contract(
      ETH_COLLATERAL_OAPP_ADDR,
      ETH_COLLATERAL_ABI,
      sepoliaSigner
    );

    console.log('Calling adminMirrorRepayment (Sepolia unlock) with:', {
      orderId,
      reserveId: eventReserveId,
      receiver,
      collateralToUnlock: unlockAmount.toString()
    });
    
    try {
      const withdrawTx = await ethCollateral.adminMirrorRepayment(
        orderId,
        eventReserveId,
        true,
        unlockAmount
      );

      console.log('Withdrawal transaction submitted, waiting for confirmation...');
      const sepoliaReceipt = await withdrawTx.wait();
      console.log('Withdrawal completed:', {
        transactionHash: sepoliaReceipt.transactionHash,
        blockNumber: sepoliaReceipt.blockNumber,
        status: sepoliaReceipt.status === 1 ? 'success' : 'failed'
      });

      return response.status(200).json({
        success: true,
        message: 'Collateral unlock processed successfully',
        txHash: sepoliaReceipt.transactionHash
      });
    } catch (err: any) {
      const reason = err?.reason || err?.error?.reason;
      if (reason && reason.toLowerCase().includes('already mirrored')) {
        console.warn('Withdraw relay skipped: already mirrored on Ethereum');
        return response.status(200).json({
          success: true,
          message: 'Withdrawal already mirrored on Ethereum',
          txHash: undefined
        });
      }
      throw err;
    }

  } catch (error) {
    console.error('Error in withdraw mirror service:', error);
    return response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
