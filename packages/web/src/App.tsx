// App.tsx

import React, { useState, useEffect } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, parseUnits } from 'viem';

// Config and ABIs
import { 
  ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR, 
  HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR 
} from './config';
// Import the Blockscout service
import { pollForHederaOrderOpened } from './services/blockscoutService';

// Components
import Header from './components/Header';
import HomePage from './components/HomePage';
import CreateOrderView from './components/CreateOrderView';
import FundOrderView from './components/FundOrderView';
import ProgressView from './components/ProgressView';
import BorrowView from './components/BorrowView';
import RepayView from './components/RepayView';
import WithdrawView from './components/WithdrawView';

// App States for the entire flow
enum AppState {
  IDLE, ORDER_CREATING, ORDER_CREATED, FUNDING_IN_PROGRESS, CROSSING_TO_HEDERA,
  READY_TO_BORROW, BORROWING_IN_PROGRESS, LOAN_ACTIVE, REPAYING_IN_PROGRESS,
  CROSSING_TO_ETHEREUM, READY_TO_WITHDRAW, WITHDRAWING_IN_PROGRESS, COMPLETED, ERROR
}

function App() {
  const [appState, setAppState]         = useState<AppState>(AppState.IDLE);
  const [logs, setLogs]                 = useState<string[]>([]);
  const [orderId, setOrderId]           = useState<`0x${string}` | null>(null);
  const [ethAmount, setEthAmount]       = useState('0.001');
  const [borrowAmount, setBorrowAmount] = useState('1.50');
  const [error, setError]               = useState<string | null>(null);
  const [lzTxHash, setLzTxHash]         = useState<`0x${string}` | null>(null);
  
  const { isConnected, chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: hash, error: writeError, isPending: isWritePending, writeContract, reset: resetWriteContract } = useWriteContract();

  const addLog = (log: string) => setLogs(prev => [...prev, log]);

  const sendTxOnChain = (chainIdToSwitch: number, config: any) => {
    const send = () => writeContract(config);
    if (chainId !== chainIdToSwitch) {
      addLog(`Switching network to Chain ID ${chainIdToSwitch}...`);
      switchChain({ chainId: chainIdToSwitch }, { onSuccess: send, onError: (err) => { addLog(`❌ Network switch failed: ${err.message}`); setAppState(AppState.IDLE); }});
    } else { send(); }
  };
  
  const handleCreateOrder = (amount: string) => { setLogs(['▶ Creating order on Ethereum...']); setEthAmount(amount); setAppState(AppState.ORDER_CREATING); sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'createOrderId' }); };
  const handleFundOrder = () => { if (!address || !orderId) return; setAppState(AppState.FUNDING_IN_PROGRESS); addLog('▶ Funding order...'); const nativeFee = parseEther('0.0001'); const totalValue = parseEther(ethAmount) + nativeFee; sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'fundOrderWithNotify', args: [orderId, parseEther(ethAmount)], value: totalValue }); };
  const handleBorrow = () => { if (!orderId) return; setAppState(AppState.BORROWING_IN_PROGRESS); addLog('▶ Borrowing hUSD on Hedera...'); sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'borrow', args: [orderId, parseUnits(borrowAmount, 6), [], 300], value: parseUnits('0.1', 8) }); };
  const handleRepay = () => { if (!orderId) return; setAppState(AppState.REPAYING_IN_PROGRESS); addLog('▶ Repaying hUSD on Hedera...'); sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'repay', args: [orderId, parseUnits(borrowAmount, 6), true], value: parseUnits('1.3', 8) }); };
  const handleWithdraw = () => { if (!orderId) return; setAppState(AppState.WITHDRAWING_IN_PROGRESS); addLog('▶ Withdrawing ETH on Ethereum...'); sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [orderId] }); };

  // --- useEffect for robust Blockscout polling ---
  useEffect(() => {
    if (appState !== AppState.CROSSING_TO_HEDERA || !orderId) {
      return;
    }

    addLog('[Polling Blockscout] Starting to check for Hedera event...');
    let attempts = 0;
    const maxAttempts = 60;

    const intervalId = setInterval(async () => {
      attempts++;
      addLog(`[Polling Blockscout] Attempt ${attempts}/${maxAttempts}...`);
      const found = await pollForHederaOrderOpened(orderId);
      if (found) {
        addLog('✅ [Polling Blockscout] Success! Event found.');
        setAppState(AppState.READY_TO_BORROW);
        clearInterval(intervalId);
      } else if (attempts >= maxAttempts) {
        addLog('❌ [Polling Blockscout] Timed out.');
        setError('Polling timed out. Please check LayerZero Scan and try again later.');
        setAppState(AppState.ERROR);
        clearInterval(intervalId);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [appState, orderId]);

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isWritePending) addLog('✍️ Please approve the transaction in your wallet...');
    if (isConfirming) addLog(`⏳ Waiting for transaction confirmation: ${hash}`);
    if (writeError) { addLog(`❌ Error: ${writeError.shortMessage || writeError.message}`); setError(writeError.shortMessage || writeError.message); setAppState(AppState.ERROR); }

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
              // --- THIS IS THE FIX ---
              // The orderId is the first indexed parameter, which is topic[1].
              const parsedOrderId = orderCreatedLog.topics[1];
              
              console.log("SUCCESSFULLY PARSED orderId from Ethereum event:", parsedOrderId);
              
              setOrderId(parsedOrderId);
              addLog(`✓ Order ID created: ${parsedOrderId.slice(0, 12)}...`);
              setAppState(AppState.ORDER_CREATED);
            } else {
              throw new Error("OrderCreated event or its topic[1] (orderId) was not found in the transaction receipt.");
            }
          } catch (e: any) {
            console.error("Full receipt on parsing error:", receipt);
            addLog(`❌ Error parsing Order ID: ${e.message}`);
            setAppState(AppState.ERROR);
          }
          break;
        case AppState.FUNDING_IN_PROGRESS:
          addLog('▶ Crossing chains to Hedera via LayerZero...');
          addLog('   (Polling Blockscout for HederaOrderOpened event...)');
          setLzTxHash(receipt.transactionHash);
          setAppState(AppState.CROSSING_TO_HEDERA);
          break;
        case AppState.BORROWING_IN_PROGRESS: addLog(`✅ You now have ${borrowAmount} hUSD!`); setAppState(AppState.LOAN_ACTIVE); break;
        case AppState.REPAYING_IN_PROGRESS: addLog('▶ Crossing chains to Ethereum...'); setAppState(AppState.CROSSING_TO_ETHEREUM); break;
        case AppState.WITHDRAWING_IN_PROGRESS: addLog(`✅ E2E FLOW COMPLETE!`); setAppState(AppState.COMPLETED); break;
      }
    }
  }, [isWritePending, isConfirming, writeError, receipt, appState]);

  const resetFlow = () => { resetWriteContract(); setAppState(AppState.IDLE); setLogs([]); setError(null); setOrderId(null); setLzTxHash(null); }

  const renderContent = () => {
    if (!isConnected) return <HomePage />;
    switch (appState) {
      case AppState.IDLE: return <CreateOrderView onSubmit={handleCreateOrder} />;
      case AppState.ORDER_CREATED: return <FundOrderView orderId={orderId!} ethAmount={ethAmount} onFund={handleFundOrder} />;
      case AppState.READY_TO_BORROW: return <BorrowView orderId={orderId!} onBorrow={handleBorrow} />;
      case AppState.LOAN_ACTIVE: return <RepayView orderId={orderId!} onRepay={handleRepay} />;
      case AppState.READY_TO_WITHDRAW: return <WithdrawView orderId={orderId!} onWithdraw={handleWithdraw} />;
      case AppState.COMPLETED: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-green-400">✅ Success!</h3><p>You can now start a new transaction.</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Start Over</button></div>;
      case AppState.ERROR: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-red-400">❌ Error</h3><p className="text-sm text-gray-400 mt-2">{error}</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Try Again</button></div>;
      default: return <ProgressView logs={logs} lzTxHash={lzTxHash} />;
    }
  };

  return (
    <div className="bg-gray-900 min-h-screen text-white font-sans">
      <Header />
      <main className="container mx-auto p-4 sm:p-8"><div className="max-w-2xl mx-auto">{renderContent()}</div></main>
    </div>
  );
}

export default App;