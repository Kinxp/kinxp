// packages/web/api/mirror/relay.ts
import type { ApiRequest, ApiResponse } from '../types';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// Environment variables
const ETH_COLLATERAL_OAPP_ADDR = (process.env.VITE_ETH_COLLATERAL_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_CREDIT_OAPP_ADDR = (process.env.VITE_HEDERA_CREDIT_OAPP || '0x...').toLowerCase() as `0x${string}`;
const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL;
const MIRROR_ADMIN_PRIVATE_KEY = process.env.MIRROR_ADMIN_PRIVATE_KEY;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;

// Log environment variables and contract addresses
console.log('=== ENVIRONMENT VARIABLES ===');
console.log('VITE_ETH_COLLATERAL_OAPP:', process.env.VITE_ETH_COLLATERAL_OAPP ? '***SET***' : 'NOT SET');
console.log('VITE_HEDERA_CREDIT_OAPP:', process.env.VITE_HEDERA_CREDIT_OAPP ? '***SET***' : 'NOT SET');
console.log('HEDERA_RPC_URL:', HEDERA_RPC_URL ? '***SET***' : 'NOT SET');
console.log('MIRROR_ADMIN_PRIVATE_KEY:', MIRROR_ADMIN_PRIVATE_KEY ? '***SET***' : 'NOT SET');
console.log('SEPOLIA_RPC_URL:', SEPOLIA_RPC_URL ? '***SET***' : 'NOT SET');

console.log('\n=== CONTRACT ADDRESSES ===');
console.log('ETH_COLLATERAL_OAPP_ADDR:', ETH_COLLATERAL_OAPP_ADDR);
console.log('HEDERA_CREDIT_OAPP_ADDR:', HEDERA_CREDIT_OAPP_ADDR);

// Validate contract addresses
if (ETH_COLLATERAL_OAPP_ADDR === '0x...' || HEDERA_CREDIT_OAPP_ADDR === '0x...') {
  console.error('ERROR: Contract addresses are using default values. Please set the correct environment variables.');
}

if (!HEDERA_RPC_URL || !MIRROR_ADMIN_PRIVATE_KEY || !SEPOLIA_RPC_URL) {
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
    const { orderId, txHash, collateralToUnlock, fullyRepaid, reserveId, borrower } = request.body;
    
    console.log('Parsed request body:', { orderId, txHash, collateralToUnlock, fullyRepaid, reserveId, borrower });
    
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

    // 1. Verify Sepolia transaction first
    console.log('Verifying Sepolia transaction...');
    let sepoliaProvider;
    let sepoliaTx;
    
    try {
      if (!SEPOLIA_RPC_URL) {
        throw new Error('SEPOLIA_RPC_URL environment variable is not set');
      }
      
      console.log('Creating Sepolia provider with URL:', SEPOLIA_RPC_URL);
      
      // Initialize provider with minimal configuration
      sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, 'sepolia');
      
      // Disable ENS resolution
      sepoliaProvider.getResolver = async () => null;
      sepoliaProvider.resolveName = async (name: string) => {
        if (ethers.isAddress(name)) return name;
        return null;
      };
      
      // Test the connection
      const network = await sepoliaProvider.getNetwork();
      console.log('Connected to network:', {
        name: network.name,
        chainId: network.chainId.toString()
      });
      
      // Log network status
      console.log('Network status:', {
        isTestnet: network.chainId === 11155111n ? 'Sepolia Testnet' : 'Unknown',
        isEthereum: network.name === 'sepolia' || network.name === 'homestead'
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

    // 2. Wait for Sepolia transaction to be mined
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

    // 3. Check order status on Sepolia
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

    // 4. Now process on Hedera using adminMirrorRepayment
    if (!MIRROR_ADMIN_PRIVATE_KEY || !HEDERA_RPC_URL) {
      return response.status(500).json({ 
        success: false,
        error: 'Server configuration error' 
      });
    }

    const hederaProvider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
    const wallet = new ethers.Wallet(MIRROR_ADMIN_PRIVATE_KEY, hederaProvider);
    
    const hederaCredit = new ethers.Contract(
      HEDERA_CREDIT_OAPP_ADDR,
      HEDERA_CREDIT_ABI,
      wallet
    );

    // Get the collateral amount from the order
    // The order.amountWei field contains the total collateral in wei
    const collateralAmount = order.amountWei || order.amountWei === 0 ? 
      order.amountWei.toString() : 
      (order as any).collateralWei?.toString() || '0';

    if (collateralAmount === '0') {
      throw new Error('Order has no collateral amount');
    }

    console.log('Calling adminMirrorOrder with:', {
      orderId,
      reserveId,
      borrower,
      collateralAmount
    });
    
    const mirrorTx = await hederaCredit.adminMirrorOrder(
      orderId,
      reserveId,
      borrower,
      borrower, // Using same as canonical address
      BigInt(collateralAmount)
    );

    console.log('Transaction submitted, waiting for confirmation...');

    const receipt = await mirrorTx.wait();

    return response.status(200).json({
      success: true,
      message: 'Repayment mirrored successfully',
      txHash: receipt.transactionHash
    });

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
