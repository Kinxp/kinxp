// App.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from './wagmi';
import { parseEther, parseUnits, formatUnits } from 'viem';

// Config and ABIs
import { 
  ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR, 
  HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR,
  HUSD_TOKEN_ADDR, ERC20_ABI, PYTH_CONTRACT_ADDR, PYTH_ABI,
  BORROW_SAFETY_BPS, USD_CONTROLLER_ABI
} from './config';
import { pollForHederaOrderOpened,fetchAllUserOrders } from './services/blockscoutService';
import { fetchPythUpdateData } from './services/pythService';
// --- THIS IS THE FIX ---
// Import the new polling service
import { pollForEthRepaid } from './services/sepoliaService';

// Components
import Header from './components/Header';
import HomePage from './components/HomePage';
import CreateOrderView from './components/CreateOrderView';
import FundOrderView from './components/FundOrderView';
import ProgressView from './components/ProgressView';
import BorrowView from './components/BorrowView';
import RepayView from './components/RepayView';
import WithdrawView from './components/WithdrawView';
import UserOrders from './components/UserOrders'; 

const WEI_PER_TINYBAR = 10_000_000_000n;

enum AppState {
  IDLE, ORDER_CREATING, ORDER_CREATED, FUNDING_IN_PROGRESS, CROSSING_TO_HEDERA,
  READY_TO_BORROW, BORROWING_IN_PROGRESS, LOAN_ACTIVE,
  RETURNING_FUNDS,
  REPAYING_IN_PROGRESS,
  CROSSING_TO_ETHEREUM, READY_TO_WITHDRAW, WITHDRAWING_IN_PROGRESS, COMPLETED, ERROR
}

function App() {
  const [appState, setAppState]         = useState<AppState>(AppState.IDLE);
  const [logs, setLogs]                 = useState<string[]>([]);
  const [orderId, setOrderId]           = useState<`0x${string}` | null>(null);
  const [ethAmount, setEthAmount]       = useState('0.001');
  const [borrowAmount, setBorrowAmount] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [ethPrice, setEthPrice]         = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [lzTxHash, setLzTxHash]         = useState<`0x${string}` | null>(null);
  const [pollingStartBlock, setPollingStartBlock] = useState<number>(0);
  const [userBorrowAmount, setUserBorrowAmount] = useState<string | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState<`0x${string}` | null>(null);
  
  
  // 2. Add state to manage the list of orders
  const [orders, setOrders] = useState<UserOrderSummary[]>([]);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);



  // --- THIS IS THE FIX ---
  // Use two separate refs to avoid intervals interfering with each other
  const hederaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ethPollingRef = useRef<NodeJS.Timeout | null>(null);

  const { isConnected, chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: hash, error: writeError, isPending: isWritePending, writeContract, reset: resetWriteContract } = useWriteContract();
  const hederaPublicClient = usePublicClient({ chainId: HEDERA_CHAIN_ID });

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
    if (!address || !orderId) return; 
    setAppState(AppState.FUNDING_IN_PROGRESS); 
    addLog(`▶ Funding order with ${amountToFund} ETH...`); 
    const nativeFee = parseEther('0.0001'); 
    const totalValue = parseEther(amountToFund) + nativeFee; 
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'fundOrderWithNotify', args: [orderId, parseEther(amountToFund)], value: totalValue }); 
  }, [address, orderId, sendTxOnChain, addLog]);

  const handleBorrow = useCallback(async (amountToBorrow: string) => { 
    if (!orderId) return;
    setUserBorrowAmount(amountToBorrow); // Store the user's desired amount
    setAppState(AppState.BORROWING_IN_PROGRESS); 
    setLogs(['▶ Preparing borrow transaction...']);
    try {
      addLog('1/3: Fetching latest price data from Pyth Network...');
      const { priceUpdateData } = await fetchPythUpdateData();
      addLog('✓ Pyth data received.');
      addLog('2/3: Quoting exact Pyth update fee...');
      const requiredFeeInTinybars = await readContract(wagmiConfig, {
          address: PYTH_CONTRACT_ADDR,
          abi: PYTH_ABI,
          functionName: 'getUpdateFee',
          args: [priceUpdateData],
          chainId: HEDERA_CHAIN_ID,
      }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      addLog(`✓ Pyth fee quoted: ${formatUnits(requiredFeeInTinybars, 8)} HBAR`);
      addLog(`3/3: Sending borrow transaction with exact fee...`);
      sendTxOnChain(HEDERA_CHAIN_ID, { 
        address: HEDERA_CREDIT_OAPP_ADDR, 
        abi: HEDERA_CREDIT_ABI, 
        functionName: 'borrow', 
        args: [orderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300],
        value: valueInWei,
        gas: 1_500_000n, 
      });
    } catch (e: any) {
      addLog(`❌ An error occurred during the borrow process: ${e.shortMessage || e.message}`);
      setError(`Borrow failed: ${e.shortMessage || e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [orderId, sendTxOnChain, addLog]);
  
  const resolveTreasuryAddress = useCallback(async (): Promise<`0x${string}`> => {
    if (treasuryAddress) return treasuryAddress;
    addLog('Resolving treasury address on Hedera...');
    try {
      const controllerAddr = await readContract(wagmiConfig, {
        address: HEDERA_CREDIT_OAPP_ADDR,
        abi: HEDERA_CREDIT_ABI,
        functionName: 'controller',
        chainId: HEDERA_CHAIN_ID,
      }) as `0x${string}`;
      const resolvedTreasury = await readContract(wagmiConfig, {
        address: controllerAddr,
        abi: USD_CONTROLLER_ABI,
        functionName: 'treasuryAccount',
        chainId: HEDERA_CHAIN_ID,
      }) as `0x${string}`;
      if (!resolvedTreasury || resolvedTreasury === '0x0000000000000000000000000000000000000000') {
        throw new Error('Treasury address is not configured on Hedera controller');
      }
      setTreasuryAddress(resolvedTreasury);
      addLog(`Treasury resolved: ${controllerAddr.slice(0, 10)}... -> ${resolvedTreasury.slice(0, 10)}...`);
      return resolvedTreasury;
    } catch (error: any) {
      throw new Error(error?.shortMessage || error?.message || 'Failed to resolve treasury address');
    }
  }, [treasuryAddress, addLog]);

  const handleRefreshOrders = useCallback(async () => {
    if (!address) return;
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const userOrders = await fetchAllUserOrders(address);
      setOrders(userOrders);
    } catch (e: any) {
      console.error("Failed to fetch orders:", e);
      setOrdersError('Could not retrieve order history.');
    } finally {
      setIsOrdersLoading(false);
    }
  }, [address]);

  const repayAndCross = useCallback(async () => {
    if (!orderId || !borrowAmount) return;
    setAppState(AppState.REPAYING_IN_PROGRESS);
    addLog('▶ Repaying hUSD and preparing to cross to Ethereum...');
    try {
      addLog('1/2: Quoting LayerZero fee for repay...');
      const feeInTinybars = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'quoteRepayFee', args: [orderId], chainId: HEDERA_CHAIN_ID }) as bigint;
      addLog(`✓ LayerZero fee quoted: ${formatUnits(feeInTinybars, 8)} HBAR`);
      const valueInWei = feeInTinybars * WEI_PER_TINYBAR;
      addLog('2/2: Sending repay transaction...');
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'repay', args: [orderId, parseUnits(borrowAmount, 6), true], value: valueInWei, gas: 1_500_000n });
    } catch (e: any) {
      addLog(`❌ An error occurred during the repay process: ${e.message}`);
      setError(`Repay failed: ${e.message}`);
      setAppState(AppState.ERROR);
    }
  }, [orderId, borrowAmount, sendTxOnChain, addLog]);

  const handleRepay = useCallback(async () => {
    if (!orderId || !address || !borrowAmount) return;
    try {
      const treasury = await resolveTreasuryAddress();
      addLog('1/2: Returning hUSD to the Hedera treasury...');
      setAppState(AppState.RETURNING_FUNDS);
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HUSD_TOKEN_ADDR, abi: ERC20_ABI, functionName: 'transfer', args: [treasury, parseUnits(borrowAmount, 6)] });
    } catch (err: any) {
      const message = err?.message ?? 'Failed to return hUSD to treasury';
      addLog(`�?O ${message}`);
      setError(message);
      setAppState(AppState.ERROR);
    }
  }, [orderId, address, borrowAmount, resolveTreasuryAddress, sendTxOnChain, addLog]);
  
  const handleWithdraw = useCallback(() => { if (!orderId) return; setAppState(AppState.WITHDRAWING_IN_PROGRESS); addLog('▶ Withdrawing ETH on Ethereum...'); sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [orderId] }); }, [orderId, sendTxOnChain, addLog]);

  const startPollingForHederaOrder = useCallback((idToPoll: `0x${string}`) => {
    addLog(`[Polling Hedera] Starting check from block ${pollingStartBlock}...`);
    let attempts = 0; const maxAttempts = 60;
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    hederaPollingRef.current = setInterval(async () => {
      attempts++; addLog(`[Polling Hedera] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForHederaOrderOpened(idToPoll, pollingStartBlock);
      if (found) {
        addLog('✅ [Polling Hedera] Success! Order is ready.');
        if(hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.READY_TO_BORROW);
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Hedera] Timed out.');
        setError('Polling for Hedera order timed out.');
        if(hederaPollingRef.current) clearInterval(hederaPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog, pollingStartBlock]);
  
  // --- THIS IS THE FIX ---
  // New polling function for the return trip to Ethereum
  const startPollingForEthRepay = useCallback((idToPoll: `0x${string}`) => {
    addLog(`[Polling Ethereum] Waiting for repay confirmation...`);
    let attempts = 0; const maxAttempts = 60; // 5 minute timeout
    if (ethPollingRef.current) clearInterval(ethPollingRef.current);
    ethPollingRef.current = setInterval(async () => {
      attempts++; addLog(`[Polling Ethereum] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForEthRepaid(idToPoll);
      if (found) {
        addLog('✅ [Polling Ethereum] Success! Collateral is unlocked.');
        if(ethPollingRef.current) clearInterval(ethPollingRef.current);
        setAppState(AppState.READY_TO_WITHDRAW);
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Ethereum] Timed out.');
        setError('Polling for Ethereum repay confirmation timed out.');
        if(ethPollingRef.current) clearInterval(ethPollingRef.current);
        setAppState(AppState.ERROR);
      }
    }, 5000);
  }, [addLog]);

  const calculateBorrowAmount = useCallback(async () => {
    if (!address || !orderId) return null;
    addLog('▶ Calculating max borrow amount...');
    try {
      const { scaledPrice } = await fetchPythUpdateData();
      const formattedPrice = Number(formatUnits(scaledPrice, 18)).toFixed(2);
      addLog(`✓ Current ETH Price: $${formattedPrice}`);
      const hOrder = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'horders', args: [orderId], chainId: HEDERA_CHAIN_ID }) as { ethAmountWei: bigint; };
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
  }, [orderId, address, addLog]);

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  
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
                break;
            case AppState.BORROWING_IN_PROGRESS:
                // --- THIS IS THE FIX ---
                // Set the final borrowed amount and move to the loan active state
                setBorrowAmount(userBorrowAmount);
                addLog(`✅ Successfully borrowed ${userBorrowAmount} hUSD!`); 
                setAppState(AppState.LOAN_ACTIVE); 
                break;
            case AppState.RETURNING_FUNDS:
                addLog('Treasury transfer complete. Proceeding with repay...');
                repayAndCross();
                break;
            case AppState.REPAYING_IN_PROGRESS: 
                addLog('▶ Crossing chains back to Ethereum...');
                // --- THIS IS THE FIX ---
                // Set the LZ hash for the return trip and change state
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
  }, [isWritePending, isConfirming, writeError, receipt, handleReceipt, addLog]);


  useEffect(() => {
    if (appState === AppState.CROSSING_TO_HEDERA && orderId && pollingStartBlock > 0) {
      startPollingForHederaOrder(orderId);
    }
    // --- THIS IS THE FIX ---
    // Start polling for the return trip when the state changes
    if (appState === AppState.CROSSING_TO_ETHEREUM && orderId) {
      startPollingForEthRepay(orderId);
    }
  }, [appState, orderId, pollingStartBlock, startPollingForHederaOrder, startPollingForEthRepay]);

  useEffect(() => {
    if (appState === AppState.LOAN_ACTIVE && !treasuryAddress) {
      resolveTreasuryAddress().catch((err) => {
        addLog(`Could not resolve treasury address: ${err.message ?? err}`);
      });
    }
  }, [appState, treasuryAddress, resolveTreasuryAddress, addLog]);

  const resetFlow = () => { 
    if (hederaPollingRef.current) clearInterval(hederaPollingRef.current);
    if (ethPollingRef.current) clearInterval(ethPollingRef.current);
    resetWriteContract(); 
    setAppState(AppState.IDLE); 
    setLogs([]); 
    setError(null); 
    setOrderId(null); 
    setLzTxHash(null);
    setBorrowAmount(null);
    setUserBorrowAmount(null);
    setTreasuryAddress(null);
    setIsCalculating(false);
    setEthPrice(null);
    setPollingStartBlock(0);
  }

  const renderContent = () => {
    if (!isConnected) return <HomePage />;
    switch (appState) {
      case AppState.IDLE: return <CreateOrderView onSubmit={handleCreateOrder} />;
      case AppState.ORDER_CREATED: return <FundOrderView orderId={orderId!} ethAmount={ethAmount} onFund={handleFundOrder} />;
      case AppState.READY_TO_BORROW: return <BorrowView orderId={orderId!} onBorrow={handleBorrow} calculateBorrowAmount={calculateBorrowAmount} />;
      // --- THIS IS THE FIX ---
      // Pass the borrowAmount to the RepayView component
      case AppState.LOAN_ACTIVE: return <RepayView orderId={orderId!} borrowAmount={borrowAmount} onRepay={handleRepay} />;
      case AppState.READY_TO_WITHDRAW: return <WithdrawView orderId={orderId!} onWithdraw={handleWithdraw} />;
      case AppState.COMPLETED: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-green-400">✅ Success!</h3><p>You can now start a new transaction.</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Start Over</button></div>;
      case AppState.ERROR: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-red-400">❌ Error</h3><p className="text-sm text-gray-400 mt-2">{error}</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Try Again</button></div>;
      default: return <ProgressView logs={logs} lzTxHash={lzTxHash} />;
    }
  };

  return (
    <div className="bg-gray-900 min-h-screen text-white font-sans">
      <Header />
      <main className="container mx-auto p-4 sm:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="max-w-2xl mx-auto">{renderContent()}</div>
          <UserOrders />
        </div>
      </main>
    </div>
  );
}

export default App;
