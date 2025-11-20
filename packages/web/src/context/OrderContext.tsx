import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, ReactNode } from 'react';
import { ethers } from 'ethers';
import { parseEther, parseUnits, formatUnits, parseAbiItem } from 'viem';
import { readContract, getAccount, getPublicClient } from 'wagmi/actions';
import { usePublicClient } from 'wagmi';
import toast from 'react-hot-toast';
import { config as wagmiConfig } from '../wagmi';
import { AppState } from '../types';

// Import the separated contexts
import { useWallet } from './WalletContext';
import { useLogs } from './LogContext';

// Import Configs and Services
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

// --- Constants & Helpers ---

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

const setMirrorInflight = (prefix: string, orderId: `0x${string}` | null, value: boolean) => {
  if (typeof window === 'undefined' || !orderId) return;
  const key = `${prefix}${orderId.toLowerCase()}`;
  if (value) {
    window.localStorage.setItem(key, 'true');
  } else {
    window.localStorage.removeItem(key);
  }
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

// --- Context Definition ---

interface OrderContextType {
  appState: AppState;
  orderId: `0x${string}` | null;
  selectedOrderId: `0x${string}` | null;
  ethAmount: string;
  borrowAmount: string | null;
  lzTxHash: `0x${string}` | null;
  ordersRefreshVersion: number;
  
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
  refreshOrders: () => void;
}

const OrderContext = createContext<OrderContextType | undefined>(undefined);

export function OrderProvider({ children }: { children: ReactNode }) {
  // 1. Access infrastructure from other contexts
  const { 
    address, 
    chainId, 
    switchChain, 
    writeContractAsync, 
    resetWriteContract, 
    hash, 
    receipt, 
    isWritePending, 
    isConfirming, 
    writeError 
  } = useWallet();
  
  const { addLog, setError, setLogs } = useLogs();

  // 2. Local State for Business Logic
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [orderId, setOrderId] = useState<`0x${string}` | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<`0x${string}` | null>(null);
  const [ethAmount, setEthAmount] = useState('0.001');
  const [borrowAmount, setBorrowAmount] = useState<string | null>(null);
  const [lzTxHash, setLzTxHash] = useState<`0x${string}` | null>(null);
  const [pollingStartBlock, setPollingStartBlock] = useState<number>(0);
  const [userBorrowAmount, setUserBorrowAmount] = useState<string | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState<`0x${string}` | null>(null);
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);
  
  // 3. Refs for Polling and Providers
  const hederaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ethPollingRef = useRef<NodeJS.Timeout | null>(null);
  const hederaRpcProviderRef = useRef<ethers.JsonRpcProvider | null>(null);
  const envLoggedRef = useRef(false);
  // Critical: This ref prevents the receipt from triggering logic multiple times
  const processedTxHashRef = useRef<string | null>(null);

  const activeOrderId = orderId || selectedOrderId;
  const hederaPublicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });

  // 4. Initialization
  const refreshOrders = useCallback(() => {
    setOrdersRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const hederaRpcUrl = import.meta.env.VITE_HEDERA_RPC_URL;
    if (hederaRpcUrl) {
      hederaRpcProviderRef.current = new ethers.JsonRpcProvider(hederaRpcUrl);
    }
  }, []);

  useEffect(() => {
    if (envLoggedRef.current) return;
    envLoggedRef.current = true;
    addLog(`ℹ️ LayerZero disabled: ${LAYERZERO_DISABLED}`);
  }, [addLog]);

  // --- Core Helper Functions ---

  const waitForHederaReceipt = useCallback(async (txHash: `0x${string}`) => {
    if (!hederaRpcProviderRef.current) return;
    // Wait for confirmation on Hedera (simulated by waiting for block inclusion)
    const receipt = await hederaRpcProviderRef.current.waitForTransaction(txHash, 1);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction failed on Hedera');
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
    if (!config.gas) {
      config.gas = gasLimits[config.functionName] || 2_000_000n;
    }
    
    // Uses the WalletContext's writeContractAsync
    const result = await writeContractAsync(config);
    
    // Store hash for funded orders immediately
    if (config.functionName === 'fundOrderWithNotify' && activeOrderId) {
      const txHashKey = `fundTxHash_${activeOrderId}`;
      localStorage.setItem(txHashKey, result);
    }
    return result;
  }, [chainId, writeContractAsync, addLog, switchChain, activeOrderId]);

  // --- Business Logic Actions ---

  const handleCreateOrder = useCallback((amount: string) => {
    setLogs(['▶ Creating order on Ethereum...']);
    setEthAmount(amount);
    setAppState(AppState.ORDER_CREATING);
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'createOrderId' });
  }, [sendTxOnChain, setLogs]);

  const handleFundOrder = useCallback((amountToFund: string) => {
    if (!address || !activeOrderId) return;
    setAppState(AppState.FUNDING_IN_PROGRESS);
    addLog(`▶ Funding order ${activeOrderId.slice(0, 10)}... with ${amountToFund} ETH...`);
    addLog(`   ↪ Direction: Sepolia ➜ Hedera (fundOrderWithNotify)`);
    
    setMirrorFlag(MIRROR_FLAG_FUND, activeOrderId, false);
    setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
    
    const nativeFee = parseEther('0.0001');
    const totalValue = parseEther(amountToFund) + nativeFee;
    
    sendTxOnChain(ETH_CHAIN_ID, { 
      address: ETH_COLLATERAL_OAPP_ADDR, 
      abi: ETH_COLLATERAL_ABI, 
      functionName: 'fundOrderWithNotify', 
      args: [activeOrderId, parseEther(amountToFund)], 
      value: totalValue 
    });
  }, [address, activeOrderId, sendTxOnChain, addLog]);

  const startPollingForHederaOrder = useCallback((idToPoll: `0x${string}`, txHash?: `0x${string}` | null) => {
    if (txHash) setLzTxHash(txHash);
    setAppState(AppState.CROSSING_TO_HEDERA);
    addLog(`[Polling Hedera] Starting check from block ${pollingStartBlock}...`);
    
    // IMPORTANT: Logic update here. We set these local states, but we 
    // removed 'activeOrderId' from this useEffect dependency in the main hook
    // to prevent the infinite loop.
    setOrderId(prev => prev ?? idToPoll);
    setSelectedOrderId(idToPoll);

    let attempts = 0; const maxAttempts = 60;
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    
    hederaPollingRef.current = setInterval(async () => {
      attempts++; 
      addLog(`[Polling Hedera] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForHederaOrderOpened(idToPoll, pollingStartBlock);
      
      if (found) {
        addLog('✅ [Polling Hedera] Success! Order funded on Hedera.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);

        setSelectedOrderId(idToPoll);
        setOrderId(null); // Clear linear flow ID
        setAppState(AppState.LOAN_ACTIVE);
        refreshOrders();
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Hedera] Timed out.');
        setError('Polling for Hedera order timed out.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, pollingStartBlock, refreshOrders, setError]);

  const startPollingForEthRepay = useCallback((idToPoll: `0x${string}`) => {
    setAppState(AppState.CROSSING_TO_ETHEREUM);
    addLog(`[Polling Ethereum] Waiting for repay confirmation...`);
    
    let attempts = 0; const maxAttempts = 60;
    if (ethPollingRef.current) clearInterval(ethPollingRef.current);
    
    ethPollingRef.current = setInterval(async () => {
      attempts++; 
      addLog(`[Polling Ethereum] Attempt ${attempts}/${maxAttempts}...`);
      const foundEvent = await pollForSepoliaRepayEvent(idToPoll);
      
      if (foundEvent) {
        addLog(`✅ [Polling Ethereum] Success! Collateral unlocked.`);
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
  }, [addLog, refreshOrders, setError]);

  const handleAddCollateral = useCallback(async (amountEth: string) => {
    if (!activeOrderId) return;
    setLogs([`▶ Adding ${amountEth} ETH collateral to order ${activeOrderId.slice(0, 10)}...`]);
    setAppState(AppState.FUNDING_IN_PROGRESS);
    try {
      const amountWei = parseEther(amountEth);
      addLog('   Quoting LayerZero fee...');
      const nativeFee = await readContract(wagmiConfig, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'quoteAddCollateralNativeFee',
        args: [activeOrderId, amountWei],
        chainId: ETH_CHAIN_ID,
      }) as bigint;
      
      const buffer = nativeFee === 0n ? parseEther('0.00005') : nativeFee / 10n;
      const totalValue = amountWei + nativeFee + buffer;
      
      const txHash = await sendTxOnChain(ETH_CHAIN_ID, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'addCollateralWithNotify',
        args: [activeOrderId, amountWei],
        value: totalValue,
      });

      // Notify mirror relay if needed
      if (txHash) {
        addLog(`✓ Transaction confirmed: ${txHash}`);
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
        
        try {
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, true);
          const response = await fetch('/api/mirror/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          if (result.success) {
            addLog(`✓ Hedera mirror succeeded.`);
            setMirrorFlag(MIRROR_FLAG_FUND, activeOrderId, true);
          }
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
        } catch (mirrorError) {
          console.error('Mirror error:', mirrorError);
          setMirrorInflight(MIRROR_FLAG_FUND_INFLIGHT, activeOrderId, false);
        }
        
        startPollingForHederaOrder(activeOrderId, txHash);
      }
      
      addLog('✓ Add collateral flow complete.');
      setAppState(AppState.LOAN_ACTIVE);
      refreshOrders();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Failed to add collateral';
      addLog(`❌ ${msg}`);
      setError(msg);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, addLog, address, sendTxOnChain, startPollingForHederaOrder, refreshOrders, setLogs, setError]);

  const handleBorrow = useCallback(async (amountToBorrow: string) => {
    if (!activeOrderId) return;
    setUserBorrowAmount(amountToBorrow);
    setAppState(AppState.BORROWING_IN_PROGRESS);
    setLogs(['▶ Preparing borrow transaction...']);
    try {
      addLog('1/3: Fetching Pyth price...');
      const { priceUpdateData } = await fetchPythUpdateData();
      addLog('2/3: Quoting fee...');
      const requiredFeeInTinybars = await readContract(wagmiConfig, { address: PYTH_CONTRACT_ADDR, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [priceUpdateData], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      
      addLog(`3/3: Sending borrow transaction...`);
      const borrowHash = await sendTxOnChain(HEDERA_CHAIN_ID, { 
        address: HEDERA_CREDIT_OAPP_ADDR, 
        abi: HEDERA_CREDIT_ABI, 
        functionName: 'borrow', 
        args: [activeOrderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300], 
        value: valueInWei, 
        gas: 1_500_000n 
      });
      
      if (!borrowHash) throw new Error('Borrow transaction not submitted');
      
      addLog(`   ↪ Borrow tx: ${borrowHash}`);
      await waitForHederaReceipt(borrowHash as `0x${string}`);
      addLog('   ↪ Borrow mined on Hedera');
      refreshOrders();
    } catch (e: any) {
      addLog(`❌ Error: ${e.shortMessage || e.message}`);
      setError(`Borrow failed: ${e.shortMessage || e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, address, sendTxOnChain, addLog, waitForHederaReceipt, refreshOrders, setLogs, setError]);

  const resolveTreasuryAddress = useCallback(async (): Promise<`0x${string}`> => {
    if (treasuryAddress) return treasuryAddress;
    try {
      const controllerAddr = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'controller', chainId: HEDERA_CHAIN_ID }) as `0x${string}`;
      const resolvedTreasury = await readContract(wagmiConfig, { address: controllerAddr, abi: USD_CONTROLLER_ABI, functionName: 'treasuryAccount', chainId: HEDERA_CHAIN_ID }) as `0x${string}`;
      setTreasuryAddress(resolvedTreasury);
      return resolvedTreasury;
    } catch (error: any) {
      throw new Error('Failed to resolve treasury address');
    }
  }, [treasuryAddress]);

  const triggerWithdrawRelay = useCallback(async (orderId: `0x${string}`, repayTxHash?: `0x${string}` | null) => {
    if (!address || !repayTxHash) return;
    try {
      addLog('▶ Notifying Ethereum withdraw relay...');
      const position = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'positions', args: [orderId], chainId: HEDERA_CHAIN_ID
      }) as { reserveId?: `0x${string}`; collateralWei?: bigint };

      const reserveId = position?.reserveId && position.reserveId !== ZERO_BYTES32 ? position.reserveId : orderId;
      const collateralWei = position?.collateralWei ?? 0n;

      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, true);
      const result = await submitWithdrawToEthereum(orderId, repayTxHash, collateralWei || 0n, reserveId, address);

      if (result.success) {
        addLog(`✓ Relay triggered. Sepolia tx: ${result.txHash ?? 'N/A'}`);
        setMirrorFlag(MIRROR_FLAG_REPAY, orderId, true);
        setAppState(AppState.READY_TO_WITHDRAW);
        refreshOrders();
      }
      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, false);
    } catch (err) {
      console.error('Withdraw relay error:', err);
      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, orderId, false);
    }
  }, [address, addLog, refreshOrders]);

  const handleRepay = useCallback(async (repayAmount: string) => {
    if (!activeOrderId || !address) return false;
    try {
      const amountToRepay = parseUnits(repayAmount, 6);
      if (amountToRepay <= 0n) throw new Error('Invalid amount');

      setMirrorFlag(MIRROR_FLAG_REPAY, activeOrderId, false);
      setMirrorInflight(MIRROR_FLAG_REPAY_INFLIGHT, activeOrderId, false);
      setAppState(AppState.RETURNING_FUNDS);
      toast.loading('Preparing transaction...', { id: 'repay-load' });
      addLog('▶ Initiating repay (Hedera ➜ Sepolia)');

      const controllerAddress = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'controller', chainId: HEDERA_CHAIN_ID
      }) as `0x${string}`;

      const currentAllowance = await readContract(wagmiConfig, {
        address: HUSD_TOKEN_ADDR, abi: ERC20_ABI,
        functionName: 'allowance', args: [address, controllerAddress],
        chainId: HEDERA_CHAIN_ID
      }) as bigint;

      if (currentAllowance < amountToRepay) {
        toast.loading('Please approve token transfer...', { id: 'repay-load' });
        const approveHash = await sendTxOnChain(HEDERA_CHAIN_ID, {
          address: HUSD_TOKEN_ADDR, abi: ERC20_ABI,
          functionName: 'approve', args: [controllerAddress, amountToRepay]
        });
        await waitForHederaReceipt(approveHash);
      }

      toast.loading('Confirm repayment...', { id: 'repay-load' });
      const lzFee = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'quoteRepayFee', args: [activeOrderId],
        chainId: HEDERA_CHAIN_ID
      }) as bigint;

      const minValue = 1n * WEI_PER_TINYBAR;
      const repayValue = lzFee > 0n && lzFee < minValue ? minValue : lzFee;

      const repayHash = await sendTxOnChain(HEDERA_CHAIN_ID, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'repay', args: [activeOrderId, amountToRepay, true],
        value: repayValue, gas: 1_500_000n
      });

      setLzTxHash(repayHash);
      await waitForHederaReceipt(repayHash);
      setAppState(AppState.REPAYING_IN_PROGRESS);
      toast.success('Repayment successful!', { id: 'repay-load' });
      
      // Trigger relay manually if needed after success
      triggerWithdrawRelay(activeOrderId, repayHash);
      
      return true;
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Repay failed';
      toast.error(`❌ ${msg}`, { id: 'repay-load' });
      setError(msg);
      setAppState(AppState.ERROR);
      throw new Error(msg);
    }
  }, [activeOrderId, address, sendTxOnChain, waitForHederaReceipt, triggerWithdrawRelay, addLog, setError]);

  const handleWithdraw = useCallback(() => {
    if (!activeOrderId) return;
    setAppState(AppState.WITHDRAWING_IN_PROGRESS);
    addLog('▶ Withdrawing ETH on Ethereum...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [activeOrderId] });
  }, [activeOrderId, sendTxOnChain, addLog]);

  const calculateBorrowAmount = useCallback(async () => {
    if (!address || !activeOrderId) return null;
    try {
      const { scaledPrice } = await fetchPythUpdateData();
      const formattedPrice = Number(formatUnits(scaledPrice, 18)).toFixed(2);
      
      const hOrder = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'horders', args: [activeOrderId], chainId: HEDERA_CHAIN_ID,
      }) as { ethAmountWei: bigint; borrowedUsd: bigint };

      const depositWei = hOrder.ethAmountWei;
      const alreadyBorrowed6 = hOrder.borrowedUsd ?? 0n;

      if (depositWei === 0n) return null;

      const ltvBps = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
        functionName: 'ltvBps', chainId: HEDERA_CHAIN_ID
      }) as number;

      const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
      const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10_000n;
      const borrowTarget18 = (maxBorrow18 * BigInt(BORROW_SAFETY_BPS)) / 10_000n;
      const currentBorrowed18 = alreadyBorrowed6 * (10n ** 12n);
      const remaining18 = borrowTarget18 > currentBorrowed18 ? (borrowTarget18 - currentBorrowed18) : 0n;
      const remaining6 = remaining18 / (10n ** 12n);
      
      return { amount: formatUnits(remaining6, 6), price: formattedPrice };
    } catch (e: any) {
      addLog(`❌ Calc failed: ${e.message}`);
      setError(`Calc failed`);
      setAppState(AppState.ERROR);
      return null;
    }
  }, [activeOrderId, address, addLog, setError]);

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

  // --- Receipt Handling (State Machine Transitions) ---

  const handleReceipt = useCallback(async () => {
    if (receipt) {
      addLog(`✓ Transaction confirmed! Block: ${receipt.blockNumber}`);
      const currentAppState = appState;
      resetWriteContract(); // Clear receipt from wallet context so we don't process it again via that path

      switch (currentAppState) {
        case AppState.ORDER_CREATING:
          try {
            // logic to find OrderCreated log
            const eventTopic = '0xfe3abe4ac576af677b15551bc3727d347d2c7b3d0aa6e5d4ec1bed01e3f13d16';
            const iface = new ethers.Interface(ETH_COLLATERAL_ABI);
            let parsedOrderId: `0x${string}` | null = null;
            
            for (const log of receipt.logs) {
              if (log.topics[0] === eventTopic) {
                 try {
                    const parsed = iface.parseLog({ data: log.data, topics: log.topics as string[] });
                    if (parsed?.name === 'OrderCreated') {
                      parsedOrderId = parsed.args?.orderId as `0x${string}`;
                      break;
                    }
                 } catch { continue; }
              }
            }
            
            // Fallback log search if needed (omitted for brevity, can use getPublicClient)
            
            if (parsedOrderId) {
              setOrderId(parsedOrderId);
              addLog(`✓ Order ID created: ${parsedOrderId.slice(0, 12)}...`);
              setAppState(AppState.ORDER_CREATED);
            } else {
              // Deterministic Fallback logic if event missed
              if (address) {
                 // ... (Calculate ID manually if needed)
              }
            }
          } catch (e) {
            setAppState(AppState.ERROR);
          }
          break;

        case AppState.FUNDING_IN_PROGRESS:
          addLog('▶ Crossing chains to Hedera via LayerZero...');
          setLzTxHash(receipt.transactionHash);
          if (hederaPublicClient) {
            const bn = await hederaPublicClient.getBlockNumber();
            setPollingStartBlock(Number(bn));
          }
          setAppState(AppState.CROSSING_TO_HEDERA);
          break;

        case AppState.BORROWING_IN_PROGRESS:
          setBorrowAmount(userBorrowAmount);
          addLog(`✅ Successfully borrowed ${userBorrowAmount} hUSD!`);
          setAppState(AppState.LOAN_ACTIVE);
          break;
          
        case AppState.REPAYING_IN_PROGRESS:
          addLog('▶ Crossing chains back to Ethereum...');
          setLzTxHash(receipt.transactionHash);
          setAppState(AppState.CROSSING_TO_ETHEREUM);
          break;
          
        case AppState.WITHDRAWING_IN_PROGRESS:
          addLog(`✅ E2E FLOW COMPLETE!`);
          refreshOrders();
          setAppState(AppState.COMPLETED);
          break;
      }
    }
  }, [receipt, appState, addLog, resetWriteContract, hederaPublicClient, userBorrowAmount, address, refreshOrders]);

  // --- Effects ---

  // 1. Receipt Processor (Prevent Double Processing Fix)
  useEffect(() => {
    // If we have a receipt, and it's NEW (not the one we just processed)
    if (receipt && receipt.transactionHash !== processedTxHashRef.current) {
      processedTxHashRef.current = receipt.transactionHash;
      handleReceipt();
    }

    if (isWritePending) addLog('✍️ Please approve the transaction in your wallet...');
    if (isConfirming) addLog(`⏳ Waiting for confirmation...`);
    if (writeError) {
      addLog(`❌ Error: ${writeError.shortMessage || writeError.message}`);
      setError(writeError.shortMessage || writeError.message);
      setAppState(AppState.ERROR);
    }
  }, [isWritePending, isConfirming, writeError, receipt, handleReceipt, addLog, setError]);

  // 2. Polling Fix: Split Effects
  // Watch for Hedera arrival (LINEAR flow only)
  useEffect(() => {
    if (appState === AppState.CROSSING_TO_HEDERA && orderId) {
      startPollingForHederaOrder(orderId, lzTxHash);
    }
  }, [appState, orderId, lzTxHash, startPollingForHederaOrder]);

  // Watch for Ethereum Repay (ACTIVE flow)
  useEffect(() => {
    if (appState === AppState.CROSSING_TO_ETHEREUM && activeOrderId) {
      startPollingForEthRepay(activeOrderId);
    }
  }, [appState, activeOrderId, startPollingForEthRepay]);

  // 3. UI Toasts
  useEffect(() => {
    let tId: string | undefined;
    if (isConfirming) tId = toast.loading('⏳ Confirming transaction...');
    if (isWritePending) toast('✍️ Please approve transaction...');
    if (receipt) { toast.dismiss(tId); toast.success('Confirmed!'); }
    if (writeError) { toast.dismiss(tId); toast.error('Transaction failed'); }
    return () => { if (tId) toast.dismiss(tId); };
  }, [isConfirming, isWritePending, receipt, writeError]);
  
  // 4. Treasury Resolver
  useEffect(() => {
    if (appState === AppState.LOAN_ACTIVE && !treasuryAddress) {
      resolveTreasuryAddress().catch(() => {});
    }
  }, [appState, treasuryAddress, resolveTreasuryAddress]);

  // --- Context Value Memoization ---

  const value = useMemo(() => ({
    appState,
    orderId,
    selectedOrderId,
    ethAmount,
    borrowAmount,
    lzTxHash,
    ordersRefreshVersion,
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
    refreshOrders,
  }), [
    appState, orderId, selectedOrderId, ethAmount, borrowAmount, lzTxHash, ordersRefreshVersion,
    handleCreateOrder, handleFundOrder, handleAddCollateral, handleBorrow, handleRepay, handleWithdraw,
    calculateBorrowAmount, setSelectedOrderId, startPollingForHederaOrder, startPollingForEthRepay,
    setLzTxHash, triggerWithdrawRelay, refreshOrders
  ]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export const useOrder = () => {
  const context = useContext(OrderContext);
  if (!context) throw new Error('useOrder must be used within OrderProvider');
  return context;
};