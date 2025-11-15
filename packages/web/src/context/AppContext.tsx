import React, { createContext, useState, useCallback, useRef, useContext, ReactNode, useEffect } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { parseEther, parseUnits, formatUnits } from 'viem';
import toast from 'react-hot-toast';

import { AppState } from '../types';

// Import all configs and services
import {
  ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR,
  HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR,
  HUSD_TOKEN_ADDR, ERC20_ABI, PYTH_CONTRACT_ADDR, PYTH_ABI,
  BORROW_SAFETY_BPS, USD_CONTROLLER_ABI
} from '../config';
import { pollForHederaOrderOpened, pollForSepoliaRepayEvent } from '../services/blockscoutService';
import { fetchPythUpdateData } from '../services/pythService';

const WEI_PER_TINYBAR = 10_000_000_000n;

type BorrowedOrderMap = Record<string, { amount: string }>;

const BORROWED_ORDERS_STORAGE_KEY = 'borrowedOrders';

function readBorrowedOrdersFromStorage(): BorrowedOrderMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(BORROWED_ORDERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.entries(parsed as Record<string, unknown>).reduce<BorrowedOrderMap>((acc, [key, value]) => {
      if (value && typeof value === 'object' && typeof (value as { amount?: unknown }).amount === 'string') {
        acc[key] = { amount: (value as { amount: string }).amount };
      }
      return acc;
    }, {});
  } catch (err) {
    console.warn('Failed to parse borrowed orders cache', err);
    return {};
  }
}

// Define the shape (interface) of our global context
interface AppContextType {
  // Wallet & Connection
  isConnected: boolean;
  address: `0x${string}` | undefined;
  connectWallet: () => Promise<void>;
  appState: AppState;
  logs: string[];
  orderId: `0x${string}` | null;
  selectedOrderId: `0x${string}` | null;
  ethAmount: string;
  borrowAmount: string | null;
  error: string | null;
  lzTxHash: `0x${string}` | null;
  handleCreateOrder: (amount: string) => void;
  handleFundOrder: (amountToFund: string) => void;
  handleAddCollateral: (amountEth: string) => Promise<void>;
  handleBorrow: (amountToBorrow: string) => Promise<void>;
  handleRepay: (repayAmount: string) => Promise<boolean>;
  handleWithdraw: () => void;
  calculateBorrowAmount: () => Promise<{ amount: string, price: string } | null>;
  resetFlow: () => void;
  exitProgressView: () => void;
  setSelectedOrderId: (orderId: `0x${string}` | null) => void;
  borrowedOrders: BorrowedOrderMap;
  startPollingForHederaOrder: (orderId: `0x${string}`, txHash?: `0x${string}` | null) => void;
  startPollingForEthRepay: (orderId: `0x${string}`) => void;
  setLzTxHash: (hash: `0x${string}` | null) => void; 
}

// Create the actual React Context
const AppContext = createContext<AppContextType | undefined>(undefined);

// Create the Provider component. It will wrap the parts of our app that need access to the context.
export function AppProvider({ children }: { children: ReactNode }) {
  // Wallet connection state
  const { isConnected, address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  
  const connectWallet = useCallback(async () => {
    try {
      // This will trigger the wallet connection via wagmi
      // The actual connection is handled by the wagmi config
      if (typeof window !== 'undefined' && window.ethereum) {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      throw error;
    }
  }, []);

  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<string[]>([]);
  const [orderId, setOrderId] = useState<`0x${string}` | null>(null); // For the linear "create" flow
  const [selectedOrderId, setSelectedOrderId] = useState<`0x${string}` | null>(null); // For dashboard selections
  const [ethAmount, setEthAmount] = useState('0.001');
  const [borrowAmount, setBorrowAmount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lzTxHash, setLzTxHash] = useState<`0x${string}` | null>(null);
  const [pollingStartBlock, setPollingStartBlock] = useState<number>(0);
  const [userBorrowAmount, setUserBorrowAmount] = useState<string | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState<`0x${string}` | null>(null);
  const [borrowedOrders, setBorrowedOrders] = useState<BorrowedOrderMap>(() => readBorrowedOrdersFromStorage());

  const hederaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ethPollingRef = useRef<NodeJS.Timeout | null>(null);

  const { data: hash, error: writeError, isPending: isWritePending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  const hederaPublicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });
  
  // This helper variable determines the currently active order ID,
  // whether it comes from the linear flow (`orderId`) or the dashboard (`selectedOrderId`).
  const activeOrderId = orderId || selectedOrderId;

  const addLog = useCallback((log: string) => setLogs(prev => [...prev, log]), []);

  const persistBorrowedOrders = useCallback((next: BorrowedOrderMap) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(BORROWED_ORDERS_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('Failed to persist borrowed orders cache', err);
    }
  }, []);

  const markOrderBorrowed = useCallback((id: `0x${string}`, amount: string | null) => {
    if (!id || !amount) return;
    setBorrowedOrders(prev => {
      const key = id.toLowerCase();
      const existing = prev[key];
      if (existing?.amount === amount) return prev;
      const next: BorrowedOrderMap = { ...prev, [key]: { amount } };
      persistBorrowedOrders(next);
      return next;
    });
  }, [persistBorrowedOrders]);

  const clearBorrowedOrder = useCallback((id: `0x${string}`) => {
    if (!id) return;
    setBorrowedOrders(prev => {
      const key = id.toLowerCase();
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      persistBorrowedOrders(rest);
      return rest;
    });
  }, [persistBorrowedOrders]);

const sendTxOnChain = useCallback(async (chainIdToSwitch: number, config: any) => {
  const send = async () => {
    const gasLimits: Record<string, bigint> = {
      'approve': 1_000_000n,
      'repay': 2_000_000n,
      'borrow': 1_500_000n,
      'fundOrderWithNotify': 1_500_000n,
      'addCollateralWithNotify': 1_500_000n,
      'withdraw': 1_000_000n,
      'createOrderId': 1_000_000n
    };
    // For token approvals, increase gas limit
    if (!config.gas) {
      config.gas = gasLimits[config.functionName] || 2_000_000n;
    }
    
    const result = await writeContract(config);
    
    // Store the transaction hash for funded orders
    if (config.functionName === 'fundOrderWithNotify' && activeOrderId) {
      const txHashKey = `fundTxHash_${activeOrderId}`;
      localStorage.setItem(txHashKey, result);
    }
    
    return result;
  };
  
  if (chainId !== chainIdToSwitch) {
    addLog(`Switching network to Chain ID ${chainIdToSwitch}...`);
    await switchChain({ chainId: chainIdToSwitch });
  }
  
  return send();
}, [chainId, writeContract, addLog, switchChain, activeOrderId]);

  const handleCreateOrder = useCallback((amount: string) => {
    setLogs(['▶ Creating order on Ethereum...']);
    setEthAmount(amount);
    setAppState(AppState.ORDER_CREATING);
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'createOrderId' });
  }, [sendTxOnChain, addLog]);

  const handleFundOrder = useCallback((amountToFund: string) => {
    if (!address || !activeOrderId) return;
    setAppState(AppState.FUNDING_IN_PROGRESS);
    addLog(`▶ Funding order ${activeOrderId.slice(0, 10)}... with ${amountToFund} ETH...`);
    const nativeFee = parseEther('0.0001');
    const totalValue = parseEther(amountToFund) + nativeFee;
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'fundOrderWithNotify', args: [activeOrderId, parseEther(amountToFund)], value: totalValue });
  }, [address, activeOrderId, sendTxOnChain, addLog]);

  const handleAddCollateral = useCallback(async (amountEth: string) => {
    if (!activeOrderId) return;
    setLogs([`▶ Adding ${amountEth} ETH collateral to order ${activeOrderId.slice(0, 10)}...`]);
    setAppState(AppState.FUNDING_IN_PROGRESS);
    try {
      const amountWei = parseEther(amountEth);
      addLog('   Quoting LayerZero fee for collateral top-up...');
      const nativeFee = await readContract(wagmiConfig, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'quoteAddCollateralNativeFee',
        args: [activeOrderId, amountWei],
        chainId: ETH_CHAIN_ID,
      }) as bigint;
      addLog(`✓ Fee quoted: ${formatUnits(nativeFee, 18)} ETH`);
      const buffer = nativeFee === 0n ? parseEther('0.00005') : nativeFee / 10n;
      const totalValue = amountWei + nativeFee + buffer;
      addLog('▶ Sending addCollateralWithNotify transaction...');
      sendTxOnChain(ETH_CHAIN_ID, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'addCollateralWithNotify',
        args: [activeOrderId, amountWei],
        value: totalValue,
      });
    } catch (e) {
      const message = (e as { shortMessage?: string; message?: string })?.shortMessage
        || (e as { message?: string })?.message
        || 'Failed to add collateral';
      addLog(`❌ ${message}`);
      setError(message);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, addLog, sendTxOnChain]);

  const handleBorrow = useCallback(async (amountToBorrow: string) => {
    if (!activeOrderId) return;
    setUserBorrowAmount(amountToBorrow);
    setAppState(AppState.BORROWING_IN_PROGRESS);
    setLogs(['▶ Preparing borrow transaction...']);
    try {
      addLog('1/3: Fetching latest price data from Pyth Network...');
      const { priceUpdateData } = await fetchPythUpdateData();
      addLog('✓ Pyth data received.');
      addLog('2/3: Quoting exact Pyth update fee...');
      const requiredFeeInTinybars = await readContract(wagmiConfig, { address: PYTH_CONTRACT_ADDR, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [priceUpdateData], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      addLog(`✓ Pyth fee quoted: ${formatUnits(requiredFeeInTinybars, 8)} HBAR`);
      addLog(`3/3: Sending borrow transaction with exact fee...`);
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'borrow', args: [activeOrderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300], value: valueInWei, gas: 1_500_000n });
    } catch (e: any) {
      addLog(`❌ An error occurred during the borrow process: ${e.shortMessage || e.message}`);
      setError(`Borrow failed: ${e.shortMessage || e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, sendTxOnChain, addLog]);

  const resolveTreasuryAddress = useCallback(async (): Promise<`0x${string}`> => {
    if (treasuryAddress) return treasuryAddress;
    addLog('Resolving treasury address on Hedera...');
    try {
      const controllerAddr = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'controller', chainId: HEDERA_CHAIN_ID }) as `0x${string}`;
      const resolvedTreasury = await readContract(wagmiConfig, { address: controllerAddr, abi: USD_CONTROLLER_ABI, functionName: 'treasuryAccount', chainId: HEDERA_CHAIN_ID }) as `0x${string}`;
      if (!resolvedTreasury || resolvedTreasury === '0x0000000000000000000000000000000000000000') throw new Error('Treasury address is not configured');
      setTreasuryAddress(resolvedTreasury);
      addLog(`✓ Treasury resolved: ${resolvedTreasury}`);
      return resolvedTreasury;
    } catch (error: any) {
      throw new Error(error?.shortMessage || error?.message || 'Failed to resolve treasury address');
    }
  }, [treasuryAddress, addLog]);

  const repayAndCross = useCallback(async () => {
    if (!activeOrderId || !borrowAmount) return;
    try {
      // Use the handleRepay function which now handles the entire flow
      await handleRepay(borrowAmount);
    } catch (e: any) {
      // Error is already handled in handleRepay
      console.error('Repay and cross failed:', e);
    }
  }, [activeOrderId, borrowAmount, sendTxOnChain, addLog]);

  // Get the public client for the Hedera network
  const publicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });
  
  // State for transaction hashes
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | null>(null);
  const [repayTxHash, setRepayTxHash] = useState<`0x${string}` | null>(null);
  const [currentToast, setCurrentToast] = useState<string>('');
  
  // Handle approval transaction
  const { data: approveReceipt, isError: isApproveError } = useWaitForTransactionReceipt({
    hash: approveTxHash || undefined,
    confirmations: 1,
    chainId: HEDERA_CHAIN_ID
  });
  
  // Handle repay transaction
  const { data: repayReceipt, isError: isRepayError } = useWaitForTransactionReceipt({
    hash: repayTxHash || undefined,
    confirmations: 1,
    chainId: HEDERA_CHAIN_ID
  });
  
  // Effect for handling approval confirmation
  useEffect(() => {
    if (approveReceipt && approveReceipt.status === 'success') {
      toast.dismiss(currentToast);
      setCurrentToast(String(toast.success('Token transfer approved!')));
    } else if (isApproveError) {
      toast.dismiss(currentToast);
      setCurrentToast(String(toast.error('Token approval transaction failed')));
    }
  }, [approveReceipt, isApproveError]);
  
  // Effect for handling repay confirmation
  useEffect(() => {
    if (repayReceipt && repayReceipt.status === 'success') {
      toast.dismiss(currentToast);
      setCurrentToast(String(toast.success('Repayment completed successfully!')));
      setLzTxHash(repayReceipt.transactionHash);
      setAppState(AppState.REPAYING_IN_PROGRESS);
    } else if (isRepayError) {
      toast.dismiss(currentToast);
      setCurrentToast(String(toast.error('Repayment transaction failed')));
    }
  }, [repayReceipt, isRepayError]);

  const handleRepay = useCallback(async (repayAmount: string) => {
    if (!activeOrderId || !address) return false;
    
    try {
      // Validate repayAmount
      if (!repayAmount || isNaN(Number(repayAmount)) || Number(repayAmount) <= 0) {
        throw new Error('Please enter a valid positive amount to repay');
      }

      // Convert human-readable amount to smallest unit (1 HUSD = 1,000,000 units)
      const amountToRepay = parseUnits(repayAmount, 6);
      console.log('Repaying amount:', repayAmount, '->', amountToRepay.toString());

      if (amountToRepay <= 0n) {
        throw new Error('Repayment amount must be greater than zero');
      }
      
      setAppState(AppState.RETURNING_FUNDS);
      setCurrentToast(String(toast.loading('Preparing transaction...')));
      
      // Get controller address
      const controllerAddress = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR,
        abi: HEDERA_CREDIT_ABI,
        functionName: 'controller',
        chainId: HEDERA_CHAIN_ID
      }) as `0x${string}`;
            
      // Check current allowance for HEDERA_CREDIT_OAPP_ADDR
      setCurrentToast(String(toast.loading('Checking token allowance...')));
      const currentAllowance = await readContract(wagmiConfig, {
        address: HUSD_TOKEN_ADDR,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, controllerAddress],
        chainId: HEDERA_CHAIN_ID
      }) as bigint;
      
      console.log('Current allowance:', {
        currentAllowance: currentAllowance.toString(),
        amountToRepay: amountToRepay.toString(),
        spender: HEDERA_CREDIT_OAPP_ADDR
      });
      
      // Only approve if needed
      if (currentAllowance < amountToRepay) {
        // First transaction: Approve
        setCurrentToast(String(toast.loading('Please approve token transfer in your wallet...')));
        const approveHash = await sendTxOnChain(HEDERA_CHAIN_ID, {
          address: HUSD_TOKEN_ADDR,
          abi: ERC20_ABI,
          functionName: 'approve',
args: [controllerAddress, amountToRepay]
        });
        setApproveTxHash(approveHash);
        // Wait for the approval to be confirmed
        await new Promise<void>((resolve, reject) => {
          const checkApproval = () => {
            if (approveReceipt) {
              if (approveReceipt.status === 'success') {
                resolve();
              } else {
                reject(new Error('Token approval transaction failed'));
              }
            } else if (isApproveError) {
              reject(new Error('Token approval transaction failed'));
            } else {
              setTimeout(checkApproval, 100);
            }
          };
          checkApproval();
        });
      }
      
      // Second transaction: Repay
      console.log('Repay parameters:', {
        orderId: activeOrderId,
        amountToRepay: amountToRepay.toString(),
        controllerAddress,
        currentAllowance: currentAllowance.toString(),
        chainId: HEDERA_CHAIN_ID
      });
      setCurrentToast(String(toast.loading('Please confirm repayment in your wallet...')));
      const repayHash = await sendTxOnChain(HEDERA_CHAIN_ID, { 
        address: HEDERA_CREDIT_OAPP_ADDR, 
        abi: HEDERA_CREDIT_ABI, 
        functionName: 'repay', 
        args: [activeOrderId, amountToRepay, true],
        value: 0n
      });
      setRepayTxHash(repayHash);
      
      // Wait for the repay to be confirmed
      await new Promise<void>((resolve, reject) => {
        const checkRepay = () => {
          if (repayReceipt) {
            if (repayReceipt.status === 'success') {
              resolve();
            } else {
              reject(new Error('Repayment transaction failed'));
            }
          } else if (isRepayError) {
            reject(new Error('Repayment transaction failed'));
          } else {
            setTimeout(checkRepay, 100);
          }
        };
        checkRepay();
      });
      
      if (!repayReceipt || repayReceipt.status !== 'success') {
        throw new Error('Repayment transaction not confirmed');
      }
      
      setLzTxHash(repayHash);
      setAppState(AppState.REPAYING_IN_PROGRESS);
      toast.success('Repayment completed successfully!', { id: currentToast });
      
      return true;
      
    } catch (err: any) {
      const message = err?.shortMessage?.replace('Contract Call:', '').trim() || 
                    err?.message?.replace('Contract Call:', '').trim() || 
                    'Failed to process repayment';
      
      console.error('Repay error:', { error: err, message });
      toast.error(`❌ ${message}`, { id: currentToast });
      setError(message);
      setAppState(AppState.ERROR);
      throw new Error(message);
    }
  }, [activeOrderId, address, sendTxOnChain, publicClient, setAppState, setError, setLzTxHash]);
  
  const handleWithdraw = useCallback(() => {
    if (!activeOrderId) return;
    setAppState(AppState.WITHDRAWING_IN_PROGRESS);
    addLog('▶ Withdrawing ETH on Ethereum...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [activeOrderId] });
  }, [activeOrderId, sendTxOnChain, addLog]);

  const startPollingForHederaOrder = useCallback((idToPoll: `0x${string}`, txHash?: `0x${string}` | null) => {
    if (txHash) {
      setLzTxHash(txHash);
    }
    setAppState(AppState.CROSSING_TO_HEDERA);
    addLog(`[Polling Hedera] Starting check from block ${pollingStartBlock}...`);
    setOrderId(prev => prev ?? idToPoll);
    setSelectedOrderId(prev => {
      if (!prev || prev === idToPoll) {
        return idToPoll;
      }
      return prev;
    });
    let attempts = 0; const maxAttempts = 60;
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    hederaPollingRef.current = setInterval(async () => {
      attempts++; addLog(`[Polling Hedera] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForHederaOrderOpened(idToPoll, pollingStartBlock);
      if (found) {
        addLog('✅ [Polling Hedera] Success! Your order is now funded on Hedera and ready for the next step.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);

        // Transition from the creation flow to the "active order" management flow.
        // This makes the newly bridged order the currently selected one.
        setSelectedOrderId(idToPoll); 
        setOrderId(null); // Clear the temporary linear flow ID
        setAppState(AppState.READY_TO_BORROW); // Set the state that triggers the borrow UI
        
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Hedera] Timed out.');
        setError('Polling for Hedera order timed out.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, pollingStartBlock]);

  const startPollingForEthRepay = useCallback((idToPoll: `0x${string}`) => {
    setAppState(AppState.CROSSING_TO_ETHEREUM);
    addLog(`[Polling Ethereum] Waiting for repay confirmation...`);
    let attempts = 0; const maxAttempts = 60;
    if (ethPollingRef.current) clearInterval(ethPollingRef.current);
    ethPollingRef.current = setInterval(async () => {
      attempts++; addLog(`[Polling Ethereum] Attempt ${attempts}/${maxAttempts}...`);
      const foundEvent = await pollForSepoliaRepayEvent(idToPoll);
      if (foundEvent) {
        addLog(`✅ [Polling Ethereum] Success! Collateral is unlocked for order ${foundEvent.orderId.slice(0, 12)}...`);
        if (ethPollingRef.current) clearInterval(ethPollingRef.current);
        clearBorrowedOrder(idToPoll);
        setAppState(AppState.READY_TO_WITHDRAW);
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Ethereum] Timed out.');
        setError('Polling for Ethereum repay confirmation timed out.');
        if (ethPollingRef.current) clearInterval(ethPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, clearBorrowedOrder]);

  const calculateBorrowAmount = useCallback(async () => {
    if (!address || !activeOrderId) return null;
    addLog('▶ Calculating max borrow amount...');
    try {
      // 1) Price
      const { scaledPrice } = await fetchPythUpdateData();
      const formattedPrice = Number(formatUnits(scaledPrice, 18)).toFixed(2);
      addLog(`✓ Current ETH Price: $${formattedPrice}`);
  
      // 2) Hedera state (includes already-borrowed amount)
      const hOrder = await readContract(
        wagmiConfig,
        {
          address: HEDERA_CREDIT_OAPP_ADDR,
          abi: HEDERA_CREDIT_ABI,
          functionName: 'horders',
          args: [activeOrderId],
          chainId: HEDERA_CHAIN_ID,
        }
      ) as { ethAmountWei: bigint; borrowedUsd: bigint };
  
      const depositWei = hOrder.ethAmountWei;
      const alreadyBorrowed6 = hOrder.borrowedUsd ?? 0n; // 6 decimals on-chain
      if (depositWei === 0n) {
        addLog(`⚠ Collateral not yet bridged to Hedera. Please wait for cross-chain confirmation.`);
        return null; // Return null gracefully instead of throwing error
      }
      addLog(`✓ Collateral confirmed: ${formatUnits(depositWei, 18)} ETH`);
  
      // 3) LTV + safety
      const ltvBps = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR,
        abi: HEDERA_CREDIT_ABI,
        functionName: 'ltvBps',
        chainId: HEDERA_CHAIN_ID
      }) as number;
      addLog(`✓ LTV read: ${ltvBps / 100}%`);
  
      const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
      const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10_000n;
      const borrowTarget18 = (maxBorrow18 * BigInt(BORROW_SAFETY_BPS)) / 10_000n;
  
      // 4) Subtract what’s already borrowed (convert 6dp -> 18dp)
      const currentBorrowed18 = alreadyBorrowed6 * (10n ** 12n);
      const remaining18 = borrowTarget18 > currentBorrowed18 ? (borrowTarget18 - currentBorrowed18) : 0n;
  
      // 5) Return remaining (in 6 decimals)
      const remaining6 = remaining18 / (10n ** 12n);
      const formattedBorrowAmount = formatUnits(remaining6, 6);
      addLog(`✓ Remaining borrow capacity: ${formattedBorrowAmount} hUSD`);
  
      return { amount: formattedBorrowAmount, price: formattedPrice };
    } catch (e: any) {
      addLog(`❌ Calc failed: ${e.message}`);
      setError(`Calc failed: ${e.message}`);
      setAppState(AppState.ERROR);
      return null;
    }
  }, [activeOrderId, address, addLog]);
  

  const resetFlow = () => {
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    if (ethPollingRef.current) clearInterval(ethPollingRef.current);
    resetWriteContract();
    setAppState(AppState.IDLE);
    setLogs([]);
    setError(null);
    setOrderId(null);
    setSelectedOrderId(null); 
    setLzTxHash(null);
    setBorrowAmount(null);
    setUserBorrowAmount(null);
    setTreasuryAddress(null);
    setPollingStartBlock(0);
  };

  // Exit progress view without fully resetting - allows user to navigate away
  // while polling continues in the background
  const exitProgressView = useCallback(() => {
    // Set state to IDLE or LOAN_ACTIVE depending on whether there's a selected order
    // This allows the user to navigate away while polling continues
    if (selectedOrderId) {
      setAppState(AppState.LOAN_ACTIVE);
    } else {
      setAppState(AppState.IDLE);
    }
  }, [selectedOrderId]);

  const handleReceipt = useCallback(async () => {
    if (receipt) {
      addLog(`✓ Transaction confirmed! Block: ${receipt.blockNumber}`);
      const currentAppState = appState;
      resetWriteContract();

      switch (currentAppState) {
        case AppState.ORDER_CREATING:
          try {
            const eventTopic = '0xfe3abe4ac576af677b15551bc3727d347d2c7b3d0aa6e5d4ec1bed01e3f13d16';
            const orderCreatedLog = receipt.logs.find(log => log.topics[0] === eventTopic);
            if (orderCreatedLog && orderCreatedLog.topics[1]) {
              setOrderId(orderCreatedLog.topics[1]);
              addLog(`✓ Order ID created: ${orderCreatedLog.topics[1].slice(0, 12)}...`);
              setAppState(AppState.ORDER_CREATED);
            } else { throw new Error("OrderCreated event not found."); }
          } catch (e: any) { addLog(`❌ Error parsing Order ID: ${e.message}`); setAppState(AppState.ERROR); }
          break;
        
        case AppState.FUNDING_IN_PROGRESS:
          addLog('▶ Crossing chains to Hedera via LayerZero...');
          setLzTxHash(receipt.transactionHash);
          if (activeOrderId) {
            try {
              localStorage.setItem(`lzTxHash_${activeOrderId}`, receipt.transactionHash);
              addLog('✓ Cross-chain transaction hash saved.');
            } catch (e) {
              console.warn('Failed to save lzTxHash to localStorage', e);
            }
          }
          if (hederaPublicClient) {
            const hederaBlockNumber = await hederaPublicClient.getBlockNumber();
            addLog(`   (Polling from Hedera block ${hederaBlockNumber})...`);
            setPollingStartBlock(Number(hederaBlockNumber));
          } else { 
            setPollingStartBlock(0); 
          }
          setAppState(AppState.CROSSING_TO_HEDERA);
          break;

        case AppState.BORROWING_IN_PROGRESS:
          setBorrowAmount(userBorrowAmount);
          if (activeOrderId && userBorrowAmount) {
            markOrderBorrowed(activeOrderId, userBorrowAmount);
          }
          addLog(`✅ Successfully borrowed ${userBorrowAmount} hUSD!`);
          setAppState(AppState.LOAN_ACTIVE);
          break;
        case AppState.RETURNING_FUNDS:
          addLog('✓ Treasury transfer complete. Proceeding with repay...');
          repayAndCross();
          break;
        case AppState.REPAYING_IN_PROGRESS:
          addLog('▶ Crossing chains back to Ethereum...');
          setLzTxHash(receipt.transactionHash);
          setAppState(AppState.CROSSING_TO_ETHEREUM);
          break;
        case AppState.WITHDRAWING_IN_PROGRESS:
          addLog(`✅ E2E FLOW COMPLETE! Your ETH has been withdrawn.`);
          setAppState(AppState.COMPLETED);
          break;
      }
    }
  }, [receipt, appState, addLog, resetWriteContract, hederaPublicClient, repayAndCross, userBorrowAmount, activeOrderId, markOrderBorrowed]);

  useEffect(() => {
    if (isWritePending) addLog('✍️ Please approve the transaction in your wallet...');
    if (isConfirming) addLog(`⏳ Waiting for transaction confirmation: ${hash}`);
    if (writeError) { addLog(`❌ Error: ${writeError.shortMessage || writeError.message}`); setError(writeError.shortMessage || writeError.message); setAppState(AppState.ERROR); }
    if (receipt) handleReceipt();
  }, [isWritePending, isConfirming, writeError, receipt, handleReceipt, addLog, hash]);

  useEffect(() => {
    if (appState === AppState.CROSSING_TO_HEDERA && orderId) {
      startPollingForHederaOrder(orderId, lzTxHash);
    }
    if (appState === AppState.CROSSING_TO_ETHEREUM && activeOrderId) {
      startPollingForEthRepay(activeOrderId);
    }
  }, [appState, orderId, activeOrderId, lzTxHash, startPollingForHederaOrder, startPollingForEthRepay]);

  useEffect(() => {
    if (appState === AppState.LOAN_ACTIVE && !treasuryAddress) {
      resolveTreasuryAddress().catch((err) => {
        addLog(`❌ Could not resolve treasury address: ${err.message ?? err}`);
      });
    }
  }, [appState, treasuryAddress, resolveTreasuryAddress, addLog]);

  useEffect(() => {
    if (selectedOrderId && selectedOrderId !== orderId) {
      setOrderId(selectedOrderId);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    if (!activeOrderId) return;
    const stored = borrowedOrders[activeOrderId.toLowerCase()];
    if (stored?.amount) {
      setBorrowAmount(stored.amount);
    } else {
      setBorrowAmount(null);
    }
  }, [activeOrderId, borrowedOrders]);

  useEffect(() => {

    let toastId: string | undefined;

    if (isConfirming) {
        toastId = toast.loading('⏳ Confirming transaction...');
    }
    if (isWritePending) {
        toast('✍️ Please approve the transaction in your wallet...');
    }
    if (receipt) {
        toast.dismiss(toastId);
        toast.success('✓ Transaction Confirmed!');
    }
    if (writeError) {
        toast.dismiss(toastId);
        toast.error(`❌ Error: ${writeError.shortMessage || 'Transaction failed.'}`);
        setError(writeError.shortMessage || 'Transaction failed.');
        setAppState(AppState.ERROR);
    }

    // Cleanup toast on component unmount
    return () => {
        if (toastId) {
            toast.dismiss(toastId);
        }
    };
}, [isConfirming, isWritePending, receipt, writeError, addLog]);

  const value = {
    // Wallet & Connection
    isConnected,
    address,
    connectWallet,
    appState,
    logs,
    orderId,
    selectedOrderId,
    ethAmount,
    borrowAmount,
    error,
    lzTxHash,
    handleCreateOrder,
    handleFundOrder,
    handleAddCollateral,
    handleBorrow,
    handleRepay,
    handleWithdraw,
    calculateBorrowAmount,
    resetFlow,
    exitProgressView,
    setSelectedOrderId,
    borrowedOrders,
    startPollingForHederaOrder,
    startPollingForEthRepay,
    address, 
    setLzTxHash,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
