import React, { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { UserOrderSummary, AppState } from '../types';
import { formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR } from '../config';

// Import all the possible views the panel can show
import CreateOrderView from './CreateOrderView';
import FundOrderView from './FundOrderView';
import BorrowView from './BorrowView';
import RepayView from './RepayView';
import WithdrawView from './WithdrawView';
import ProgressView from './ProgressView';
import { SpinnerIcon } from './Icons';


interface ActionPanelProps {
  allOrders: UserOrderSummary[];
}

const ActionPanel: React.FC<ActionPanelProps> = ({ allOrders }) => {
  // --- All hooks are at the top level ---
  const {
    appState,
    selectedOrderId,
    orderId: newlyCreatedOrderId,
    ethAmount,
    borrowAmount,
    logs,
    lzTxHash,
    error,
    handleCreateOrder,
    handleFundOrder,
    handleBorrow,
    calculateBorrowAmount,
    handleRepay,
    handleWithdraw,
    resetFlow,
    startPollingForHederaOrder,
    address,
    setLzTxHash, 
  } = useAppContext();

  const [isCheckingHedera, setIsCheckingHedera] = useState(false);
  const [isHederaConfirmed, setIsHederaConfirmed] = useState(false);

  const selectedOrder = allOrders.find(o => o.orderId === selectedOrderId);
  
  // Memoized handlers to prevent re-creating functions on every render
  const onFund = useCallback((amountToFund: string) => {
    handleFundOrder(amountToFund);
  }, [handleFundOrder]);

  const onBorrow = useCallback((amount: string) => {
    if (selectedOrder) handleBorrow(selectedOrder.orderId, amount);
  }, [handleBorrow, selectedOrder]);

  const onRepay = useCallback(() => {
    const repayAmount = selectedOrder?.borrowedUsd ? formatUnits(selectedOrder.borrowedUsd, 6) : borrowAmount;
    if (selectedOrder && repayAmount) handleRepay(selectedOrder.orderId, repayAmount);
  }, [handleRepay, selectedOrder, borrowAmount]);

  const onWithdraw = useCallback(() => {
    if (selectedOrder) handleWithdraw(selectedOrder.orderId);
  }, [handleWithdraw, selectedOrder]);

  const onCalculateBorrow = useCallback(() => {
    if (selectedOrder) return calculateBorrowAmount(selectedOrder.orderId);
    return Promise.resolve(null);
  }, [calculateBorrowAmount, selectedOrder]);
  

  useEffect(() => {
    const checkHederaStatus = async () => {
      if (selectedOrder && (selectedOrder.status === 'Funded' || selectedOrder.status === 'Borrowed')) {
        setIsCheckingHedera(true);
        setIsHederaConfirmed(false);
        try {
          const hOrder = await readContract(wagmiConfig, {
            address: HEDERA_CREDIT_OAPP_ADDR,
            abi: HEDERA_CREDIT_ABI,
            functionName: 'horders',
            args: [selectedOrder.orderId],
            chainId: HEDERA_CHAIN_ID,
          }) as { ethAmountWei: bigint; open: boolean };
          
          if (hOrder && hOrder.ethAmountWei > 0n) {
            setIsHederaConfirmed(true);
          } else {
            setIsHederaConfirmed(false);
          }
        } catch (e) {
          console.log("Hedera check failed, assuming order is still in transit.", e);
          setIsHederaConfirmed(false);
        } finally {
          setIsCheckingHedera(false);
        }
      }
    };
    checkHederaStatus();
  }, [selectedOrder]);


  // --- RENDER LOGIC ---

  // In-progress / terminal states from the global context take priority
  if (appState !== AppState.IDLE && appState !== AppState.LOAN_ACTIVE) {
    switch (appState) {
      case AppState.ORDER_CREATED:
        return <FundOrderView orderId={newlyCreatedOrderId!} ethAmount={ethAmount} onFund={handleFundOrder} />;
      case AppState.COMPLETED:
        return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-green-400">✅ Success!</h3><p>Action completed.</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 font-bold py-2 px-4 rounded-lg">Start Over</button></div>;
      case AppState.ERROR:
        return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-red-400">❌ Error</h3><p className="text-sm text-gray-400 mt-2">{error}</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 font-bold py-2 px-4 rounded-lg">Try Again</button></div>;
      default:
        return <ProgressView logs={logs} lzTxHash={lzTxHash} />;
    }
  }

  // If an order is selected from the dashboard, show its relevant actions
  if (selectedOrder) {
    const collateralEth = formatUnits(selectedOrder.amountWei, 18);
    const borrowAmountForRepay = selectedOrder.borrowedUsd ? formatUnits(selectedOrder.borrowedUsd, 6) : borrowAmount;
    const repayable = !!borrowAmountForRepay && Number(borrowAmountForRepay) > 0;

    switch (selectedOrder.status) {
      case 'Created':
        return <FundOrderView orderId={selectedOrder.orderId} ethAmount={ethAmount} onFund={onFund} />;

      case 'Funded':
      case 'Borrowed':
        if (isCheckingHedera) {
          return <div className="text-center p-4"><SpinnerIcon /> <p className="mt-2 text-sm text-gray-400">Confirming status on Hedera...</p></div>;
        }

        if (isHederaConfirmed) {
          return (
            <div className="space-y-4">
              <BorrowView orderId={selectedOrder.orderId} onBorrow={onBorrow} calculateBorrowAmount={onCalculateBorrow} activeBorrowAmount={borrowAmountForRepay} />
              {repayable && (
                <>
                  <div className="my-4 border-t border-gray-700" />
                  <RepayView orderId={selectedOrder.orderId} borrowAmount={borrowAmountForRepay} collateralEth={collateralEth} onRepay={onRepay} />
                </>
              )}
            </div>
          );
        } else {
          // --- MERGE: Create the new, smarter handler for the button ---
          const handleTrackConfirmation = async () => {
            if (!address) {
              // This should ideally be handled by disabling the button, but it's a good safeguard.
              console.error("User address is not available to find the transaction hash.");
              return;
            }
            
            // 1. Find the original funding transaction hash from Sepolia
            const foundHash = localStorage.getItem(`lzTxHash_${selectedOrder.orderId}`) as `0x${string}` | null;
            if (foundHash) {
              // 2. Set it in the global state so the ProgressView can display it
              setLzTxHash(foundHash);
            }
            
            // 3. Start the polling process (which will switch the view to ProgressView)
            startPollingForHederaOrder(selectedOrder.orderId, foundHash);
          };

          return (
            <div className="text-center space-y-4 p-4">
              <h3 className="font-semibold text-lg">Waiting for Cross-Chain Confirmation</h3>
              <p className="text-sm text-gray-400">Your funds are on Sepolia, but the message has not yet arrived on Hedera.</p>
              <button
                onClick={handleTrackConfirmation} // Use the new handler
                className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg"
              >
                Track Confirmation
              </button>
            </div>
          );
        }

      case 'ReadyToWithdraw':
        return <WithdrawView orderId={selectedOrder.orderId} onWithdraw={onWithdraw} />;

      default:
        return (
          <div className="text-center text-gray-400 p-4">
            <p>This order is in a final state (<span className="font-semibold">{selectedOrder.status}</span>).</p>
          </div>
        );
    }
  }

  // If no order is selected and the app is idle, show a hint.
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400">
      Select an order from the right to manage it.
    </div>
  );
};

export default ActionPanel;