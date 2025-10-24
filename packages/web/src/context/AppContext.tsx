import React, { createContext, useState, useCallback, useRef, useContext, ReactNode, useEffect } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { parseEther, parseUnits, formatUnits } from 'viem';
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

// Define the shape (interface) of our global context
interface AppContextType {
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
  handleBorrow: (amountToBorrow: string) => Promise<void>;
  handleRepay: () => Promise<void>;
  handleWithdraw: () => void;
  calculateBorrowAmount: () => Promise<{ amount: string, price: string } | null>;
  resetFlow: () => void;
  setSelectedOrderId: (orderId: `0x${string}` | null) => void;
}

// Create the actual React Context
const AppContext = createContext<AppContextType | undefined>(undefined);

// Create the Provider component. It will wrap the parts of our app that need access to the context.
export const AppProvider = ({ children }: { children: ReactNode }) => {
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

  const hederaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ethPollingRef = useRef<NodeJS.Timeout | null>(null);

  const { isConnected, chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: hash, error: writeError, isPending: isWritePending, writeContract, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  const hederaPublicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });
  
  // This helper variable determines the currently active order ID,
  // whether it comes from the linear flow (`orderId`) or the dashboard (`selectedOrderId`).
  const activeOrderId = orderId || selectedOrderId;

  const addLog = useCallback((log: string) => setLogs(prev => [...prev, log]), []);

  const sendTxOnChain = useCallback((chainIdToSwitch: number, config: any) => {
    const send = () => writeContract(config);
    if (chainId !== chainIdToSwitch) {
      addLog(`Switching network to Chain ID ${chainIdToSwitch}...`);
      switchChain({ chainId: chainIdToSwitch }, { onSuccess: send, onError: (err) => { addLog(`❌ Network switch failed: ${err.message}`); setAppState(AppState.IDLE); }});
    } else { send(); }
  }, [chainId, writeContract, addLog, switchChain]);

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
    setAppState(AppState.REPAYING_IN_PROGRESS);
    addLog('▶ 2/2: Calling repay to burn tokens and notify Ethereum...');
    try {
      addLog('   Quoting LayerZero fee for repay...');
      const feeInTinybars = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'quoteRepayFee', args: [activeOrderId], chainId: HEDERA_CHAIN_ID }) as bigint;
      addLog(`✓ LayerZero fee quoted: ${formatUnits(feeInTinybars, 8)} HBAR`);
      const valueInWei = feeInTinybars * WEI_PER_TINYBAR;
      addLog('   Sending repay transaction...');
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'repay', args: [activeOrderId, parseUnits(borrowAmount, 6), true], value: valueInWei, gas: 1_500_000n });
    } catch (e: any) {
      addLog(`❌ An error occurred during the repay process: ${e.message}`);
      setError(`Repay failed: ${e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, borrowAmount, sendTxOnChain, addLog]);

  const handleRepay = useCallback(async () => {
    if (!activeOrderId || !address || !borrowAmount) return;
    try {
      const treasury = await resolveTreasuryAddress();
      addLog('▶ 1/2: Returning hUSD to the Hedera treasury...');
      setAppState(AppState.RETURNING_FUNDS);
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HUSD_TOKEN_ADDR, abi: ERC20_ABI, functionName: 'transfer', args: [treasury, parseUnits(borrowAmount, 6)] });
    } catch (err: any) {
      const message = err?.message ?? 'Failed to return hUSD to treasury';
      addLog(`❌ ${message}`);
      setError(message);
      setAppState(AppState.ERROR);
    }
  }, [activeOrderId, address, borrowAmount, resolveTreasuryAddress, sendTxOnChain, addLog]);

  const handleWithdraw = useCallback(() => {
    if (!activeOrderId) return;
    setAppState(AppState.WITHDRAWING_IN_PROGRESS);
    addLog('▶ Withdrawing ETH on Ethereum...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [activeOrderId] });
  }, [activeOrderId, sendTxOnChain, addLog]);

  const startPollingForHederaOrder = useCallback((idToPoll: `0x${string}`) => {
    addLog(`[Polling Hedera] Starting check from block ${pollingStartBlock}...`);
    let attempts = 0; const maxAttempts = 60;
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    hederaPollingRef.current = setInterval(async () => {
      attempts++; addLog(`[Polling Hedera] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForHederaOrderOpened(idToPoll);
      if (found) {
        addLog('✅ [Polling Hedera] Success! Order is ready.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.READY_TO_BORROW);
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Hedera] Timed out.');
        setError('Polling for Hedera order timed out.');
        if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, pollingStartBlock]);

  const startPollingForEthRepay = useCallback((idToPoll: `0x${string}`) => {
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
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Ethereum] Timed out.');
        setError('Polling for Ethereum repay confirmation timed out.');
        if (ethPollingRef.current) clearInterval(ethPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog]);

  const calculateBorrowAmount = useCallback(async () => {
    if (!address || !activeOrderId) return null;
    addLog('▶ Calculating max borrow amount...');
    try {
      const { scaledPrice } = await fetchPythUpdateData();
      const formattedPrice = Number(formatUnits(scaledPrice, 18)).toFixed(2);
      addLog(`✓ Current ETH Price: $${formattedPrice}`);
      const hOrder = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'horders', args: [activeOrderId], chainId: HEDERA_CHAIN_ID }) as { ethAmountWei: bigint; };
      const depositWei = hOrder.ethAmountWei;
      if (depositWei === 0n) throw new Error("Collateral amount on Hedera is zero.");
      addLog(`✓ Collateral confirmed: ${formatUnits(depositWei, 18)} ETH`);
      const ltvBps = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'ltvBps', chainId: HEDERA_CHAIN_ID }) as number;
      addLog(`✓ LTV read: ${ltvBps / 100}%`);
      const collateralUsd18 = (depositWei * scaledPrice) / parseEther("1");
      const maxBorrow18 = (collateralUsd18 * BigInt(ltvBps)) / 10_000n;
      const borrowTarget18 = (maxBorrow18 * BigInt(BORROW_SAFETY_BPS)) / 10_000n;
      const finalBorrowAmount = borrowTarget18 / 10n ** 12n;
      const formattedBorrowAmount = formatUnits(finalBorrowAmount, 6);
      addLog(`✓ Calculated max borrow: ${formattedBorrowAmount} hUSD`);
      return { amount: formattedBorrowAmount, price: formattedPrice };
    } catch (e: any) { addLog(`❌ Calc failed: ${e.message}`); setError(`Calc failed: ${e.message}`); setAppState(AppState.ERROR); return null; }
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
          if (hederaPublicClient) {
            const hederaBlockNumber = await hederaPublicClient.getBlockNumber();
            addLog(`   (Polling from Hedera block ${hederaBlockNumber})...`);
            setPollingStartBlock(Number(hederaBlockNumber));
          } else { setPollingStartBlock(0); }
          setAppState(AppState.CROSSING_TO_HEDERA);
          setTimeout(() => {
              addLog('✓ Funding tx sent. Polling in background. You can perform other actions.');
              setAppState(AppState.IDLE);
              setSelectedOrderId(null);
              setOrderId(null);
          }, 100);
          break;
        case AppState.BORROWING_IN_PROGRESS:
          setBorrowAmount(userBorrowAmount);
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
  }, [receipt, appState, addLog, resetWriteContract, hederaPublicClient, repayAndCross, userBorrowAmount]);

  useEffect(() => {
    if (isWritePending) addLog('✍️ Please approve the transaction in your wallet...');
    if (isConfirming) addLog(`⏳ Waiting for transaction confirmation: ${hash}`);
    if (writeError) { addLog(`❌ Error: ${writeError.shortMessage || writeError.message}`); setError(writeError.shortMessage || writeError.message); setAppState(AppState.ERROR); }
    if (receipt) handleReceipt();
  }, [isWritePending, isConfirming, writeError, receipt, handleReceipt, addLog, hash]);

  useEffect(() => {
    if (appState === AppState.CROSSING_TO_HEDERA && orderId && pollingStartBlock > 0) {
      startPollingForHederaOrder(orderId);
    }
    if (appState === AppState.CROSSING_TO_ETHEREUM && activeOrderId) {
      startPollingForEthRepay(activeOrderId);
    }
  }, [appState, orderId, activeOrderId, pollingStartBlock, startPollingForHederaOrder, startPollingForEthRepay]);

  useEffect(() => {
    if (appState === AppState.LOAN_ACTIVE && !treasuryAddress) {
      resolveTreasuryAddress().catch((err) => {
        addLog(`❌ Could not resolve treasury address: ${err.message ?? err}`);
      });
    }
  }, [appState, treasuryAddress, resolveTreasuryAddress, addLog]);

  const value = {
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
    handleBorrow,
    handleRepay,
    handleWithdraw,
    calculateBorrowAmount,
    resetFlow,
    setSelectedOrderId,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};