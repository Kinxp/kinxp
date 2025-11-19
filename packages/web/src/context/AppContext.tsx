import React, { createContext, useState, useCallback, useRef, useContext, ReactNode, useEffect } from 'react';
import { ethers } from 'ethers';
import { useAccount, useWriteContract,useSwitchChain, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { readContract, getAccount, getPublicClient } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { parseEther, parseUnits, formatUnits, parseAbiItem } from 'viem';
import toast from 'react-hot-toast';

import { AppState } from '../types';

// Import all configs and services
import {
  ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR,
  HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR,
  HUSD_TOKEN_ADDR, ERC20_ABI, PYTH_CONTRACT_ADDR, PYTH_ABI,
  BORROW_SAFETY_BPS, USD_CONTROLLER_ABI, LAYERZERO_DISABLED
} from '../config';
import { pollForHederaOrderOpened, pollForSepoliaRepayEvent } from '../services/blockscoutService';
import { fetchPythUpdateData } from '../services/pythService';
import { submitWithdrawToEthereum } from '../services/withdrawMirrorService';
import { submitToMirrorRelay } from '../services/mirrorRelayService';

const WEI_PER_TINYBAR = 10_000_000_000n;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const MIRROR_FLAG_FUND = 'mirror_funding_';
const MIRROR_FLAG_REPAY = 'mirror_repay_';
const MIRROR_FLAG_FUND_INFLIGHT = 'mirror_funding_inflight_';
const MIRROR_FLAG_REPAY_INFLIGHT = 'mirror_repay_inflight_';
const ORDER_CREATED_EVENT = parseAbiItem(
  'event OrderCreated(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user)'
);  

const setMirrorFlag = (prefix: string, orderId: `0x${string}`, value: boolean) => {
  if (typeof window === 'undefined') return;
  const key = `${prefix}${orderId.toLowerCase()}`;
  if (value) {
    window.localStorage.setItem(key, 'true');
  } else {
    window.localStorage.removeItem(key);
  }
};

const hasMirrorFlag = (prefix: string, orderId: `0x${string}` | null | undefined): boolean => {
  if (typeof window === 'undefined' || !orderId) return false;
  const key = `${prefix}${orderId.toLowerCase()}`;
  return window.localStorage.getItem(key) === 'true';
};

const setMirrorInflight = (prefix: string, orderId: `0x${string}` | null, value: boolean) => {
  if (typeof window === 'undefined' || !orderId) return;
  const key = `${prefix}${orderId.toLowerCase()}`;
  if (value) {
    window.localStorage.setItem(key, 'true');
  } else {
    window.localStorage.removeItem(key);
  }
};

const isMirrorInflight = (prefix: string, orderId: `0x${string}` | null | undefined): boolean => {
  if (typeof window === 'undefined' || !orderId) return false;
  return window.localStorage.getItem(`${prefix}${orderId.toLowerCase()}`) === 'true';
};

const fetchReserveIdForOrder = async (orderId: `0x${string}`): Promise<`0x${string}`> => {
  try {
    const orderTuple = await readContract(wagmiConfig, {
      address: ETH_COLLATERAL_OAPP_ADDR,
      abi: ETH_COLLATERAL_ABI,
      functionName: 'orders',
      args: [orderId],
      chainId: ETH_CHAIN_ID,
    }) as [`0x${string}`, `0x${string}`, bigint, bigint, boolean, boolean, boolean];
    const reserveId = orderTuple?.[1];
    if (reserveId && reserveId !== ZERO_BYTES32) {
      return reserveId;
    }
  } catch (err) {
    console.warn('Failed to fetch reserveId for order', orderId, err);
  }
  return orderId;
};

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
  setSelectedOrderId: (orderId: `0x${string}` | null) => void;
  startPollingForHederaOrder: (orderId: `0x${string}`, txHash?: `0x${string}` | null) => void;
  startPollingForEthRepay: (orderId: `0x${string}`) => void;
  setLzTxHash: (hash: `0x${string}` | null) => void; 
  triggerWithdrawRelay: (orderId: `0x${string}`, txHash?: `0x${string}` | null) => Promise<void>;
  ordersRefreshVersion: number;
  refreshOrders: () => void;
}

// Create the actual React Context
const AppContext = createContext<AppContextType | undefined>(undefined);

// Create the Provider component. It will wrap the parts of our app that need access to the context.
export function AppProvider({ children }: { children: ReactNode }) {
  // Wallet connection state
  const { isConnected, address, chainId } = useAccount();
  
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
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);
  const envLoggedRef = useRef(false);
const {  switchChainAsync : switchChain } = useSwitchChain();

  const refreshOrders = useCallback(() => {
    setOrdersRefreshVersion((version) => version + 1);
  }, []);

  const hederaRpcUrl = import.meta.env.VITE_HEDERA_RPC_URL;
  const hederaRpcProviderRef = useRef<ethers.JsonRpcProvider | null>(null);
  useEffect(() => {
    if (hederaRpcUrl) {
      hederaRpcProviderRef.current = new ethers.JsonRpcProvider(hederaRpcUrl);
    }
  }, [hederaRpcUrl]);

  const hederaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ethPollingRef = useRef<NodeJS.Timeout | null>(null);

  const { data: hash, error: writeError, isPending: isWritePending, writeContract, writeContractAsync, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  const hederaPublicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });
  
  // This helper variable determines the currently active order ID,
  // whether it comes from the linear flow (`orderId`) or the dashboard (`selectedOrderId`).
  const activeOrderId = orderId || selectedOrderId;

  const addLog = useCallback((log: string) => setLogs(prev => [...prev, log]), []);

  useEffect(() => {
    if (envLoggedRef.current) return;
    envLoggedRef.current = true;
    addLog(`ℹ️ LayerZero disabled: ${LAYERZERO_DISABLED}`);
    addLog(`ℹ️ ETH_COLLATERAL_OAPP_ADDR: ${ETH_COLLATERAL_OAPP_ADDR}`);
    addLog(`ℹ️ HEDERA_CREDIT_OAPP_ADDR: ${HEDERA_CREDIT_OAPP_ADDR}`);
    addLog(`ℹ️ Hedera RPC URL configured: ${Boolean(hederaRpcUrl)}`);
  }, [addLog, hederaRpcUrl]);

  useEffect(() => {
    if (address) {
      addLog(`👛 Wallet connected: ${address}`);
    } else {
      addLog('👛 Wallet disconnected');
    }
  }, [address, addLog]);

  const waitForHederaReceipt = useCallback(async (txHash: `0x${string}`) => {
    if (!hederaRpcProviderRef.current) return;
    const receipt = await hederaRpcProviderRef.current.waitForTransaction(txHash, 1);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction failed');
    }
  }, []);

const sendTxOnChain = useCallback(async (chainIdToSwitch: number, config: any) => {

  
  if (chainId !== chainIdToSwitch) {
    addLog(`Switching network to Chain ID ${chainIdToSwitch}...`);
    await switchChain({ chainId: chainIdToSwitch });
    
  }
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
  const result = await writeContractAsync(config);
  
  // Store the transaction hash for funded orders
  if (config.functionName === 'fundOrderWithNotify' && activeOrderId) {
    const txHashKey = `fundTxHash_${activeOrderId}`;
    localStorage.setItem(txHashKey, result);
  }

  
  return result;

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
    addLog(`   ↪ Direction: Sepolia ➜ Hedera (fundOrderWithNotify)`);
    addLog(`   ↪ Wallet: ${address}`);
    setMirrorFlag(MIRROR_FLAG_FUND, activeOrderId, false);
    setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
    const nativeFee = parseEther('0.0001');
    const totalValue = parseEther(amountToFund) + nativeFee;
    addLog(`   ↪ Total value: ${formatUnits(totalValue, 18)} ETH (includes native fee buffer ${formatUnits(nativeFee, 18)} ETH)`);
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'fundOrderWithNotify', args: [activeOrderId, parseEther(amountToFund)], value: totalValue });
  }, [address, activeOrderId, sendTxOnChain, addLog]);

  const startPollingForHederaOrder = useCallback((idToPoll: `0x${string}`, txHash?: `0x${string}` | null) => {
    if (txHash) {
      setLzTxHash(txHash);
    }
    setAppState(AppState.CROSSING_TO_HEDERA);
    addLog(`[Polling Hedera] Starting check from block ${pollingStartBlock}...`);
    setOrderId(prev => prev ?? idToPoll);
    setSelectedOrderId(idToPoll);
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
        setAppState(AppState.LOAN_ACTIVE); // Unlock the management UI immediately
        refreshOrders();
        
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Hedera] Timed out.');
        setError('Polling for Hedera order timed out.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, pollingStartBlock, refreshOrders]);

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
        setAppState(AppState.READY_TO_WITHDRAW);
        refreshOrders();
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Ethereum] Timed out.');
        setError('Polling for Ethereum repay confirmation timed out.');
        if (ethPollingRef.current) clearInterval(ethPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, refreshOrders]);

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
      addLog(`   ↪ Direction: Sepolia ➜ Hedera (collateral increase)`);
      addLog(`   ↪ Wallet: ${address ?? 'unknown'}`);
      addLog(`   ↪ Value sent: ${formatUnits(totalValue, 18)} ETH (buffer ${formatUnits(buffer, 18)} ETH)`);
      
      // Send the transaction and wait for it to be mined
      const txHash = await sendTxOnChain(ETH_CHAIN_ID, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'addCollateralWithNotify',
        args: [activeOrderId, amountWei],
        value: totalValue,
      });

      // After successful transaction, call the admin mirror service
      if (txHash) {
        addLog(`✓ Transaction confirmed on Sepolia: ${txHash}`);
        addLog('✓ Notifying Hedera via /api/mirror/relay...');
        const reserveId = await fetchReserveIdForOrder(activeOrderId);
        const account = await getAccount(wagmiConfig);
        const payload = {
          orderId: activeOrderId,
          txHash,
          collateralToUnlock: amountWei.toString(),
          fullyRepaid: false,
          reserveId,
          borrower: account.address,
          actionType: 'addCollateral' as const,
        };
        addLog(`   ↪ Payload: ${JSON.stringify(payload)}`);
        try {
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, true);
          const response = await fetch('/api/mirror/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          const result = await response.json();
          if (result.success) {
            addLog(`✓ Hedera mirror succeeded. Hedera tx hash: ${result.txHash ?? 'N/A'}`);
            setMirrorFlag(MIRROR_FLAG_FUND, activeOrderId, true);
          } else {
            addLog(`⚠️ Admin mirror service warning: ${result.message || 'Unknown error'}`);
          }
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
        } catch (mirrorError) {
          console.error('Admin mirror service error:', mirrorError);
          addLog('⚠️ Failed to notify Hedera via admin mirror service. Please try again later.');
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
        }
        startPollingForHederaOrder(activeOrderId, txHash);
      }

      addLog('✓ Add collateral flow complete. Hedera state will refresh shortly.');
      setAppState(AppState.LOAN_ACTIVE);
      refreshOrders();
    } catch (e) {
      const message = (e as { shortMessage?: string; message?: string })?.shortMessage
        || (e as { message?: string })?.message
        || 'Failed to add collateral';
      addLog(`❌ ${message}`);
      setError(message);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, addLog, address, sendTxOnChain, startPollingForHederaOrder, refreshOrders]);

  const handleBorrow = useCallback(async (amountToBorrow: string) => {
    if (!activeOrderId) return;
    setUserBorrowAmount(amountToBorrow);
    setAppState(AppState.BORROWING_IN_PROGRESS);
    setLogs(['▶ Preparing borrow transaction...']);
    addLog(`   ↪ Direction: Hedera ➜ Sepolia (borrow notify)`);
    addLog(`   ↪ Requested borrow amount: ${amountToBorrow} hUSD`);
    try {
      addLog('1/3: Fetching latest price data from Pyth Network...');
      const { priceUpdateData } = await fetchPythUpdateData();
      addLog('✓ Pyth data received.');
      addLog('2/3: Quoting exact Pyth update fee...');
      const requiredFeeInTinybars = await readContract(wagmiConfig, { address: PYTH_CONTRACT_ADDR, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [priceUpdateData], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      addLog(`✓ Pyth fee quoted: ${formatUnits(requiredFeeInTinybars, 8)} HBAR`);
      addLog(`3/3: Sending borrow transaction with exact fee...`);
      addLog(`   ↪ Wallet: ${address ?? 'unknown'} | Value (HBAR): ${formatUnits(valueInWei, 18)}`);
      const borrowHash = await sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'borrow', args: [activeOrderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300], value: valueInWei, gas: 1_500_000n });
      if (!borrowHash) {
        throw new Error('Borrow transaction was not submitted');
      }
      addLog(`   ↪ Borrow tx hash: ${borrowHash}`);
      await waitForHederaReceipt(borrowHash as `0x${string}`);
      addLog('   ↪ Borrow transaction mined on Hedera');
      refreshOrders();
    } catch (e: any) {
      addLog(`❌ An error occurred during the borrow process: ${e.shortMessage || e.message}`);
      setError(`Borrow failed: ${e.shortMessage || e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, address, sendTxOnChain, addLog, waitForHederaReceipt, refreshOrders]);

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

  const triggerWithdrawRelay = useCallback(async (orderId: `0x${string}`, repayTxHash?: `0x${string}` | null) => {
    if (!address || !repayTxHash) return;
    try {
      addLog('▶ Notifying Ethereum withdraw relay...');
      addLog('   ↪ Direction: Hedera ➜ Sepolia (repay mirror)');
      addLog(`   ↪ Hedera repay tx: ${repayTxHash}`);
      const position = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR,
        abi: HEDERA_CREDIT_ABI,
        functionName: 'positions',
        args: [orderId],
        chainId: HEDERA_CHAIN_ID
      }) as { reserveId?: `0x${string}`; collateralWei?: bigint };

      const reserveId = position?.reserveId && position.reserveId !== ZERO_BYTES32
        ? position.reserveId
        : orderId;
      const collateralWei = position?.collateralWei ?? 0n;
      addLog(`   ↪ Position snapshot: reserveId=${reserveId}, collateralWei=${collateralWei.toString()}`);

      addLog('   ↪ Calling /api/mirror/withdraw with payload:');
      addLog(`      orderId=${orderId}, txHash=${repayTxHash}, receiver=${address}`);

      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, true);
      const result = await submitWithdrawToEthereum(
        orderId,
        repayTxHash,
        collateralWei || 0n,
        reserveId,
        address
      );

      if (result.success) {
        addLog(`✓ Withdrawal relay triggered on Ethereum. Sepolia tx hash: ${result.txHash ?? 'N/A'}`);
        setMirrorFlag(MIRROR_FLAG_REPAY, orderId, true);
        setAppState(AppState.READY_TO_WITHDRAW);
        addLog('✓ Collateral unlocked on Sepolia. You can withdraw now.');
        refreshOrders();
      } else {
        addLog(`⚠ Withdraw relay warning: ${result.message || result.error || 'Unknown error'}`);
      }
        setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, false);
    } catch (err) {
      console.error('Withdraw relay error:', err);
      addLog('⚠ Failed to trigger withdraw relay. You can retry from the dashboard once available.');
      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, false);
    }
  }, [address, addLog, refreshOrders]);

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
      if (activeOrderId && repayReceipt.transactionHash) {
        void triggerWithdrawRelay(activeOrderId, repayReceipt.transactionHash);
      }
    } else if (isRepayError) {
      toast.dismiss(currentToast);
      setCurrentToast(String(toast.error('Repayment transaction failed')));
    }
  }, [repayReceipt, isRepayError, activeOrderId, triggerWithdrawRelay]);

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
    
    setMirrorFlag(MIRROR_FLAG_REPAY, activeOrderId, false);
    setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, activeOrderId, false);
    setAppState(AppState.RETURNING_FUNDS);
    setCurrentToast(String(toast.loading('Preparing transaction...')));
    addLog('▶ Initiating repay (Hedera ➜ Sepolia)');
    addLog(`   ↪ Wallet: ${address}`);
    addLog(`   ↪ Amount (6dp): ${amountToRepay.toString()}`);
    
    // Get controller address - Make sure this is called on Hedera
    const controllerAddress = await readContract(wagmiConfig, {
      address: HEDERA_CREDIT_OAPP_ADDR,
      abi: HEDERA_CREDIT_ABI,
      functionName: 'controller',
      chainId: HEDERA_CHAIN_ID
    }) as `0x${string}`;
    addLog(`   ↪ Controller address: ${controllerAddress}`);
          
    // Check current allowance - Make sure this is called on Hedera
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
      spender: controllerAddress
    });
    addLog(`   ↪ Allowance check: ${currentAllowance.toString()} / ${amountToRepay.toString()}`);
    
    // Only approve if needed
    if (currentAllowance < amountToRepay) {
      setCurrentToast(String(toast.loading('Please approve token transfer in your wallet...')));
      const approveHash = await sendTxOnChain(HEDERA_CHAIN_ID, {
        address: HUSD_TOKEN_ADDR,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [controllerAddress, amountToRepay]
      });
      setApproveTxHash(approveHash);
      await waitForHederaReceipt(approveHash);
      addLog(`   ↪ Approval tx mined on Hedera: ${approveHash}`);
    }
    
    // Second transaction: Repay - Make sure this is sent to Hedera
    console.log('Repay parameters:', {
      orderId: activeOrderId,
      amountToRepay: amountToRepay.toString(),
      controllerAddress,
      currentAllowance: currentAllowance.toString(),
      chainId: HEDERA_CHAIN_ID
    });
    
    setCurrentToast(String(toast.loading('Please confirm repayment in your wallet...')));
    
    // Get the LayerZero fee for the cross-chain message
    const lzFee = await readContract(wagmiConfig, {
      address: HEDERA_CREDIT_OAPP_ADDR,
      abi: HEDERA_CREDIT_ABI,
      functionName: 'quoteRepayFee',
      args: [activeOrderId],
      chainId: HEDERA_CHAIN_ID
    }) as bigint;
    addLog(`   ↪ LayerZero fee quote: ${lzFee.toString()} wei`);
    
    // Hedera RPC rejects non-zero msg.value below 1 tinybar, so enforce the minimum
    const minValue = 1n * WEI_PER_TINYBAR;
    const repayValue = lzFee > 0n && lzFee < minValue ? minValue : lzFee;
    
    const repayHash = await sendTxOnChain(HEDERA_CHAIN_ID, { 
      address: HEDERA_CREDIT_OAPP_ADDR, 
      abi: HEDERA_CREDIT_ABI, 
      functionName: 'repay', 
      args: [activeOrderId, amountToRepay, true],
      value: repayValue,
      gas: 1_500_000n
    });
    
    setRepayTxHash(repayHash);
    setLzTxHash(repayHash);
    addLog(`   ↪ Repay tx hash: ${repayHash}`);
    
    await waitForHederaReceipt(repayHash);
    addLog('   ↪ Repay tx mined, awaiting Ethereum unlock.');
    
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
}, [activeOrderId, address, sendTxOnChain, setAppState, setError, setLzTxHash, waitForHederaReceipt]);

const handleWithdraw = useCallback(() => {
    if (!activeOrderId) return;
    setAppState(AppState.WITHDRAWING_IN_PROGRESS);
    addLog('▶ Withdrawing ETH on Ethereum...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [activeOrderId] });
  }, [activeOrderId, sendTxOnChain, addLog]);

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

  const handleReceipt = useCallback(async () => {
    if (receipt) {
      addLog(`✓ Transaction confirmed! Block: ${receipt.blockNumber}`);
      const currentAppState = appState;
      resetWriteContract();

      switch (currentAppState) {
        case AppState.ORDER_CREATING:
          try {
            const eventTopic = '0xfe3abe4ac576af677b15551bc3727d347d2c7b3d0aa6e5d4ec1bed01e3f13d16';
            const iface = new ethers.Interface(ETH_COLLATERAL_ABI);
            let parsedOrderId: `0x${string}` | null = null;
            for (const log of receipt.logs) {
              if (!log?.topics?.length) continue;
              if (log.topics[0] !== eventTopic) continue;
              if (log.address?.toLowerCase() !== ETH_COLLATERAL_OAPP_ADDR.toLowerCase()) continue;
              try {
                const parsed = iface.parseLog({ data: log.data, topics: log.topics as string[] });
                if (parsed?.name === 'OrderCreated') {
                  parsedOrderId = parsed.args?.orderId as `0x${string}`;
                  break;
                }
              } catch {
                continue;
              }
            }
            if (!parsedOrderId && address) {
              const client = getPublicClient(wagmiConfig, { chainId: ETH_CHAIN_ID });
              if (client) {
                try {
                  const logs = await client.getLogs({
                    address: ETH_COLLATERAL_OAPP_ADDR,
                    event: ORDER_CREATED_EVENT,
                    args: { user: address },
                    fromBlock: BigInt(receipt.blockNumber),
                    toBlock: BigInt(receipt.blockNumber),
                  });
                  if (logs.length > 0) {
                    parsedOrderId = logs[0].args?.orderId as `0x${string}`;
                  }
                } catch (logErr) {
                  console.warn('OrderCreated log lookup failed', logErr);
                }
              }
            }
            if (parsedOrderId) {
              setOrderId(parsedOrderId);
              addLog(`✓ Order ID created: ${parsedOrderId.slice(0, 12)}...`);
              setAppState(AppState.ORDER_CREATED);
            } else {
              throw new Error('OrderCreated event not found.');
            }
          } catch (e: any) {
            addLog(`⚠️ Could not read OrderCreated event (${e.message || e}). Attempting deterministic fallback...`);
            try {
              if (!address) throw new Error('Wallet address unavailable');
              const latestNonce = await readContract(wagmiConfig, {
                address: ETH_COLLATERAL_OAPP_ADDR,
                abi: ETH_COLLATERAL_ABI,
                functionName: 'nonces',
                args: [address],
                chainId: ETH_CHAIN_ID,
              }) as bigint;
              const defaultReserve = await readContract(wagmiConfig, {
                address: ETH_COLLATERAL_OAPP_ADDR,
                abi: ETH_COLLATERAL_ABI,
                functionName: 'defaultReserveId',
                chainId: ETH_CHAIN_ID,
              }) as `0x${string}`;
              const computedOrderId = ethers.solidityPackedKeccak256(
                ['address', 'uint96', 'uint256', 'bytes32'],
                [address, latestNonce, BigInt(ETH_CHAIN_ID), defaultReserve]
              ) as `0x${string}`;
              setOrderId(computedOrderId);
              addLog(`✓ Order ID (fallback) computed: ${computedOrderId.slice(0, 12)}...`);
              setAppState(AppState.ORDER_CREATED);
            } catch (fallbackError: any) {
              addLog(`❌ Error deriving Order ID: ${fallbackError?.message || fallbackError}`);
              setAppState(AppState.ERROR);
            }
          }
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
          if (LAYERZERO_DISABLED && receipt.transactionHash && activeOrderId && address) {
            try {
              addLog('⚙️ LayerZero disabled – mirroring funding via relay service...');
              setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, true);
              const reserveIdForOrder = await fetchReserveIdForOrder(activeOrderId);
              const mirrorResult = await submitToMirrorRelay({
                orderId: activeOrderId,
                txHash: receipt.transactionHash,
                collateralToUnlock: '0',
                fullyRepaid: false,
                reserveId: reserveIdForOrder,
                borrower: address,
              });
              if (mirrorResult.success) {
                addLog(`✓ Funding mirrored via relay service (tx: ${mirrorResult.txHash ?? 'N/A'})`);
                if (activeOrderId) {
                  setMirrorFlag(MIRROR_FLAG_FUND, activeOrderId, true);
                }
              } else {
                addLog(`⚠️ Relay service failed: ${mirrorResult.error || mirrorResult.message || 'Unknown error'}`);
              }
              setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
            } catch (mirrorError) {
              console.error('Funding relay error:', mirrorError);
              addLog('⚠️ Failed to mirror funding via relay service. You may need to retry manually.');
              setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
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
          addLog(`✅ Successfully borrowed ${userBorrowAmount} hUSD!`);
          setAppState(AppState.LOAN_ACTIVE);
          break;
        case AppState.RETURNING_FUNDS:
          addLog('✓ Treasury transfer complete.');
          break;
        case AppState.REPAYING_IN_PROGRESS:
          addLog('▶ Crossing chains back to Ethereum...');
          setLzTxHash(receipt.transactionHash);
          setAppState(AppState.CROSSING_TO_ETHEREUM);
          break;
        case AppState.WITHDRAWING_IN_PROGRESS:
          addLog(`✅ E2E FLOW COMPLETE! Your ETH has been withdrawn.`);
          refreshOrders();
          setAppState(AppState.COMPLETED);
          break;
      }
    }
  }, [receipt, appState, addLog, resetWriteContract, hederaPublicClient, userBorrowAmount, activeOrderId, address, submitToMirrorRelay, refreshOrders]);

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
    setSelectedOrderId,
    startPollingForHederaOrder,
    startPollingForEthRepay,
    setLzTxHash,
    triggerWithdrawRelay,
    ordersRefreshVersion,
    refreshOrders,
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
