// packages/web/api/mirror/relay.ts
import type { ApiRequest, ApiResponse } from '../types';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// Environment variables
const ETH_COLLATERAL_OAPP_ADDR = (process.env.VITE_ETH_COLLATERAL_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_CREDIT_OAPP_ADDR = (process.env.VITE_HEDERA_CREDIT_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL;
const HEDERA_MIRROR_PRIVATE_KEY = process.env.HEDERA_ECDSA_KEY;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const SEPOLIA_MIRROR_PRIVATE_KEY = process.env.DEPLOYER_KEY;

// Log environment variables and contract addresses
console.log('=== ENVIRONMENT VARIABLES ===');
console.log('VITE_ETH_COLLATERAL_OAPP:', process.env.VITE_ETH_COLLATERAL_OAPP ? '***SET***' : 'NOT SET');
console.log('VITE_HEDERA_CREDIT_OAPP:', process.env.VITE_HEDERA_CREDIT_OAPP ? '***SET***' : 'NOT SET');
console.log('HEDERA_RPC_URL:', HEDERA_RPC_URL ? '***SET***' : 'NOT SET');
console.log('HEDERA_ECDSA_KEY:', HEDERA_MIRROR_PRIVATE_KEY ? '***SET***' : 'NOT SET');
console.log('SEPOLIA_RPC_URL:', SEPOLIA_RPC_URL ? '***SET***' : 'NOT SET');

console.log('\n=== CONTRACT ADDRESSES ===');
console.log('ETH_COLLATERAL_OAPP_ADDR:', ETH_COLLATERAL_OAPP_ADDR);
console.log('HEDERA_CREDIT_OAPP_ADDR:', HEDERA_CREDIT_OAPP_ADDR);

// Validate contract addresses
if (ETH_COLLATERAL_OAPP_ADDR === '0x...' || HEDERA_CREDIT_OAPP_ADDR === '0x...') {
  console.error('ERROR: Contract addresses are using default values. Please set the correct environment variables.');
}

if (!HEDERA_RPC_URL || !HEDERA_MIRROR_PRIVATE_KEY || !SEPOLIA_RPC_URL) {
  console.error('ERROR: Missing required environment variables');
}

// Load ABIs
const loadABI = (filename: string) => {
  const abiFilePath = path.join(process.cwd(), 'src', 'abis', `${filename}.json`);
  const fileContent = fs.readFileSync(abiFilePath, 'utf8');
  return JSON.parse(fileContent).abi;
};

const ETH_COLLATERAL_ABI = loadABI('EthCollateralOApp');
const HEDERA_CREDIT_ABI = loadABI('HederaCreditOApp');

const RAY = 10n ** 27n;
const DEBT_TOKEN_DECIMALS = 6;

const rayMul = (a: bigint, b: bigint) => {
  if (a === 0n || b === 0n) return 0n;
  return (a * b) / RAY;
};

const toRay = (amount: bigint, decimals: number) => {
  const exponent = BigInt(27 - decimals);
  return amount * 10n ** exponent;
};

const isAlreadyMirroredError = (error: unknown): boolean => {
  const lower = (value?: string) => value?.toLowerCase() ?? '';
  const reason = lower((error as any)?.reason ?? (error as any)?.shortMessage);
  const infoMsg = lower((error as any)?.info?.error?.message);
  const message = lower((error as any)?.message);
  const data = lower((error as any)?.data);
  const combined = `${reason} ${infoMsg} ${message} ${data}`;
  return combined.includes('already mirrored');
};

const formatDirection = (
  mode: 'fund' | 'repay',
  collateralToUnlock: string,
  fullyRepaid: boolean,
  isCollateralTopUp = false
) => {
  if (mode === 'repay') return 'Hedera ➜ Sepolia (repay notify)';
  if (isCollateralTopUp || (collateralToUnlock !== '0' && collateralToUnlock !== '0x0')) {
    return 'Sepolia ➜ Hedera (add collateral)';
  }
  return 'Sepolia ➜ Hedera (fund order)';
};

export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  console.log('=== MIRROR RELAY REQUEST START ===');
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

  try {
    const { orderId, txHash, collateralToUnlock, fullyRepaid, reserveId, borrower, actionType } = request.body;
    
    const mode: 'fund' | 'repay' = actionType === 'repay' ? 'repay' : 'fund';
    const isCollateralTopUp = actionType === 'addCollateral';
    
    console.log('Parsed request body:', { orderId, txHash, collateralToUnlock, fullyRepaid, reserveId, borrower, actionType, mode, isCollateralTopUp });
    console.log(`Relay direction: ${formatDirection(mode, String(collateralToUnlock), fullyRepaid, isCollateralTopUp)}`);
    
    if (!orderId || !txHash || collateralToUnlock === undefined || fullyRepaid === undefined || !reserveId || !borrower) {
      const error = `Missing required parameters. Received: ${JSON.stringify({
        hasOrderId: !!orderId,
        hasTxHash: !!txHash,
        collateralToUnlock,
        fullyRepaid,
        reserveId: !!reserveId,
        borrower: !!borrower
      })}`;
      
      console.error('Validation error:', error);
      return response.status(400).json({ 
        success: false,
        error: `Missing required parameters: ${error}`
      });
    }

    if (mode === 'fund') {
      console.log('Processing fund relay via Sepolia → Hedera path');
      let sepoliaProvider;
      let sepoliaTx;
      
      try {
        if (!SEPOLIA_RPC_URL) {
          throw new Error('SEPOLIA_RPC_URL environment variable is not set');
        }
        
        console.log('Creating Sepolia provider with URL:', SEPOLIA_RPC_URL);
        
        sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, 'sepolia');
        
        sepoliaProvider.getResolver = async () => null;
        sepoliaProvider.resolveName = async (name: string) => {
          if (ethers.isAddress(name)) return name;
          return null;
        };
        
        const network = await sepoliaProvider.getNetwork();
        console.log('Connected to network:', {
          name: network.name,
          chainId: network.chainId.toString()
        });
        
        console.log('Fetching transaction:', txHash);
        sepoliaTx = await sepoliaProvider.getTransaction(txHash);
        console.log('Transaction details:', {
          hash: sepoliaTx?.hash,
          blockNumber: sepoliaTx?.blockNumber,
          from: sepoliaTx?.from,
          to: sepoliaTx?.to,
          value: sepoliaTx?.value?.toString()
        });
        
        if (!sepoliaTx) {
          const error = 'Transaction not found on Sepolia';
          console.error(error);
          return response.status(404).json({ 
            success: false,
            error
          });
        }
      } catch (error) {
        console.error('Error verifying Sepolia transaction:', error);
        return response.status(500).json({
          success: false,
          error: `Failed to verify Sepolia transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      console.log('Waiting for Sepolia transaction to be mined...');
      let sepoliaReceipt;
      
      try {
        sepoliaReceipt = await sepoliaTx.wait();
        console.log('Sepolia transaction receipt:', {
          blockNumber: sepoliaReceipt?.blockNumber,
          status: sepoliaReceipt?.status,
          logsCount: sepoliaReceipt?.logs?.length,
          gasUsed: sepoliaReceipt?.gasUsed?.toString(),
          contractAddress: sepoliaReceipt?.contractAddress,
          transactionLogs: sepoliaReceipt?.logs?.map((log: any, i: number) => ({
            index: i,
            address: log.address,
            topics: log.topics,
            data: log.data
          }))
        });
        
        if (!sepoliaReceipt || !sepoliaReceipt.status) {
          const error = 'Sepolia transaction failed or not found';
          console.error(error, { receipt: sepoliaReceipt });
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

      const ethCollateral = new ethers.Contract(
        ETH_COLLATERAL_OAPP_ADDR,
        ETH_COLLATERAL_ABI,
        sepoliaProvider
      );

      const order = await ethCollateral.orders(orderId);
      
      if (!order || !order.funded) {
        return response.status(400).json({ 
          success: false,
          error: 'Order not found or not funded on Sepolia' 
        });
      }

      if (!HEDERA_MIRROR_PRIVATE_KEY || !HEDERA_RPC_URL) {
        return response.status(500).json({ 
          success: false,
          error: 'Server configuration error' 
        });
      }

      const hederaProvider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
      const wallet = new ethers.Wallet(HEDERA_MIRROR_PRIVATE_KEY, hederaProvider);
      console.log('[Relay][Fund] Hedera signer:', wallet.address);
      const hederaCredit = new ethers.Contract(
        HEDERA_CREDIT_OAPP_ADDR,
        HEDERA_CREDIT_ABI,
        wallet
      );

      const collateralAmount = order.amountWei || order.amountWei === 0 ? 
        order.amountWei.toString() : 
        (order as any).collateralWei?.toString() || '0';

      if (collateralAmount === '0') {
        throw new Error('Order has no collateral amount');
      }

      if (isCollateralTopUp) {
        if (!collateralToUnlock) {
          throw new Error('Missing collateral top-up amount');
        }
        const addedWei = BigInt(collateralToUnlock);
        if (addedWei <= 0n) {
          throw new Error('Collateral top-up amount must be greater than zero');
        }

        console.log('Calling adminIncreaseCollateral with:', {
          orderId,
          addedWei: addedWei.toString(),
          newTotal: collateralAmount
        });

        try {
          console.log('[Relay][Fund] Invoking adminIncreaseCollateral (Sepolia ➜ Hedera)...');
          const mirrorTx = await hederaCredit.adminIncreaseCollateral(orderId, addedWei);
          console.log('[Relay][Fund] Hedera tx submitted:', mirrorTx.hash);
          const receipt = await mirrorTx.wait();
          console.log('[Relay][Fund] Hedera tx confirmed at block', receipt.blockNumber);

          return response.status(200).json({
            success: true,
            message: 'Collateral increase mirrored successfully',
            txHash: receipt.transactionHash
          });
        } catch (err) {
          if (isAlreadyMirroredError(err)) {
            console.warn('Collateral relay skipped: already applied on Hedera');
            return response.status(200).json({
              success: true,
              message: 'Collateral increase already mirrored on Hedera'
            });
          }
          throw err;
        }
      } else {
        console.log('Calling adminMirrorOrder with:', {
          orderId,
          reserveId,
          borrower,
          collateralAmount
        });
        
        try {
          console.log('[Relay][Fund] Invoking adminMirrorOrder (Sepolia ➜ Hedera)...');
          const mirrorTx = await hederaCredit.adminMirrorOrder(
            orderId,
            reserveId,
            borrower,
            borrower,
            BigInt(collateralAmount)
          );

          console.log('[Relay][Fund] Hedera tx submitted:', mirrorTx.hash);
          const receipt = await mirrorTx.wait();
          console.log('[Relay][Fund] Hedera tx confirmed at block', receipt.blockNumber);

          return response.status(200).json({
            success: true,
            message: 'Funding mirrored successfully',
            txHash: receipt.transactionHash
          });
        } catch (err) {
          if (isAlreadyMirroredError(err)) {
            console.warn('Funding relay skipped: order already mirrored on Hedera');
            return response.status(200).json({
              success: true,
              message: 'Order already mirrored on Hedera'
            });
          }
          throw err;
        }
      }
    }

    console.log('Processing repay relay via Hedera → Sepolia path');

    if (!HEDERA_RPC_URL) {
      throw new Error('HEDERA_RPC_URL environment variable is not set');
    }
    if (!SEPOLIA_RPC_URL) {
      throw new Error('SEPOLIA_RPC_URL environment variable is not set');
    }
    if (!SEPOLIA_MIRROR_PRIVATE_KEY) {
      throw new Error('DEPLOYER_KEY (Sepolia mirror signer) is not configured');
    }

    const hederaProvider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
    const hederaTx = await hederaProvider.getTransaction(txHash);

    if (!hederaTx) {
      return response.status(404).json({
        success: false,
        error: 'Transaction not found on Hedera'
      });
    }

    const hederaReceipt = await hederaTx.wait();
    if (!hederaReceipt || !hederaReceipt.status) {
      return response.status(400).json({
        success: false,
        error: 'Hedera transaction failed or not found'
      });
    }

    const hederaInterface = new ethers.Interface(HEDERA_CREDIT_ABI);
    const parsedLog = hederaReceipt.logs
      ?.map((log: any) => {
        if (!log?.topics?.length) return null;
        try {
          return hederaInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => {
        if (!log || log.name !== 'RepayApplied') return false;
        const logOrderId = (log.args?.orderId as string | undefined)?.toLowerCase();
        return !!logOrderId && logOrderId === orderId.toLowerCase();
      });

    if (!parsedLog) {
      throw new Error('RepayApplied event not found in Hedera transaction logs');
    }

    const repayAmount = BigInt(parsedLog.args?.repayBurnAmount?.toString() ?? '0');
    const eventReserveId = (parsedLog.args?.reserveId as `0x${string}` | undefined) || reserveId;
    const eventFullyRepaid = Boolean(parsedLog.args?.fullyRepaid ?? fullyRepaid);

    const hederaCreditReader = new ethers.Contract(
      HEDERA_CREDIT_OAPP_ADDR,
      HEDERA_CREDIT_ABI,
      hederaProvider
    );

    const position = await hederaCreditReader.positions(orderId);
    if (!position) {
      throw new Error('Position not found on Hedera');
    }

    const reserveState = await hederaCreditReader.reserveStates(eventReserveId);
    if (!reserveState) {
      throw new Error('Reserve state not found on Hedera');
    }
    const collateralWei = BigInt(position.collateralWei?.toString?.() ?? '0');
    const scaledDebtRayAfter = BigInt(position.scaledDebtRay?.toString?.() ?? '0');
    const variableBorrowIndexRaw = BigInt(reserveState?.variableBorrowIndex?.toString?.() ?? '0');
    const borrowIndex = variableBorrowIndexRaw === 0n ? RAY : variableBorrowIndexRaw;

    const repayRay = toRay(repayAmount, DEBT_TOKEN_DECIMALS);
    const totalDebtAfterRay = rayMul(scaledDebtRayAfter, borrowIndex);
    const totalDebtBeforeRay = totalDebtAfterRay + repayRay;

    if (totalDebtBeforeRay === 0n) {
      throw new Error('Invalid debt snapshot for repayment');
    }

    let unlockAmount = (collateralWei * repayRay) / totalDebtBeforeRay;
    if (unlockAmount > collateralWei) {
      unlockAmount = collateralWei;
    }
    if (unlockAmount === 0n && eventFullyRepaid) {
      unlockAmount = collateralWei;
    }

    console.log('Computed unlock payload:', {
      repayAmount: repayAmount.toString(),
      unlockAmount: unlockAmount.toString(),
      collateralWei: collateralWei.toString(),
      eventFullyRepaid,
      reserveId: eventReserveId
    });

    const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, 'sepolia');
    const adminWallet = new ethers.Wallet(SEPOLIA_MIRROR_PRIVATE_KEY, sepoliaProvider);
    console.log('[Relay][Repay] Sepolia signer:', adminWallet.address);
    const ethCollateral = new ethers.Contract(
      ETH_COLLATERAL_OAPP_ADDR,
      ETH_COLLATERAL_ABI,
      adminWallet
    );

    try {
      console.log('[Relay][Repay] Invoking adminMirrorRepayment (Hedera ➜ Sepolia)...');
      const mirrorTx = await ethCollateral.adminMirrorRepayment(
        orderId,
        eventReserveId,
        eventFullyRepaid,
        unlockAmount
      );
      console.log('[Relay][Repay] Sepolia tx submitted:', mirrorTx.hash);
      const mirrorReceipt = await mirrorTx.wait();
      console.log('[Relay][Repay] Sepolia tx confirmed at block', mirrorReceipt.blockNumber);

      return response.status(200).json({
        success: true,
        message: 'Repayment mirrored successfully',
        txHash: mirrorReceipt.transactionHash
      });
    } catch (err) {
      if (isAlreadyMirroredError(err)) {
        console.warn('Repay relay skipped: already mirrored on Sepolia');
        return response.status(200).json({
          success: true,
          message: 'Repayment already mirrored on Sepolia'
        });
      }
      throw err;
    }

  } catch (error) {
    console.error('Error in mirror relay:', error);
    return response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
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
