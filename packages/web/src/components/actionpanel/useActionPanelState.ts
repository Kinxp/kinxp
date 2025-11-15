import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { UserOrderSummary } from '../../types';
import { formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../../wagmi';
import { HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR } from '../../config';
import { submitToMirrorRelay } from '../../services/mirrorRelayService';
import { fetchOrderTransactions } from '../../services/blockscoutService';
import toast from 'react-hot-toast';

interface OrderTransaction {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  timestamp?: string;
}

// This hook encapsulates all the state and logic for the ActionPanel
export function useActionPanelState(allOrders: UserOrderSummary[]) {
  const {
    appState, selectedOrderId, orderId: newlyCreatedOrderId, ethAmount, borrowAmount,
    logs, lzTxHash, error,
    handleCreateOrder, handleFundOrder, handleBorrow, calculateBorrowAmount,
    handleRepay, handleWithdraw, resetFlow, exitProgressView, startPollingForHederaOrder,
    address, setLzTxHash,
  } = useAppContext();

  const [isCheckingHedera, setIsCheckingHedera] = useState(false);
  const [isHederaConfirmed, setIsHederaConfirmed] = useState(false);
  const [isRelaying, setIsRelaying] = useState(false);

  const selectedOrder = allOrders.find(o => o.orderId === selectedOrderId);

  // --- DERIVED STATE ---
  const collateralEth = selectedOrder ? formatUnits(selectedOrder.amountWei, 18) : null;
  const borrowAmountForRepay = selectedOrder?.borrowedUsd ? formatUnits(selectedOrder.borrowedUsd, 6) : borrowAmount;
  const repayable = !!borrowAmountForRepay && Number(borrowAmountForRepay) > 0;

  // --- MEMOIZED HANDLERS ---
  const onFund = useCallback((amountToFund: string) => handleFundOrder(amountToFund), [handleFundOrder]);
  const onBorrow = useCallback((amount: string) => { if (selectedOrder) handleBorrow(amount); }, [handleBorrow, selectedOrder]);
  const onRepay = useCallback(() => { if (selectedOrder && borrowAmountForRepay) handleRepay(); }, [handleRepay, selectedOrder, borrowAmountForRepay]);
  const onWithdraw = useCallback(() => { if (selectedOrder) handleWithdraw(); }, [handleWithdraw, selectedOrder]);
  const onCalculateBorrow = useCallback(() => { if (selectedOrder) return calculateBorrowAmount(); return Promise.resolve(null); }, [calculateBorrowAmount, selectedOrder]);
  
  const handleTrackConfirmation = useCallback(async () => {
    if (!address || !selectedOrder) return;
    const foundHash = localStorage.getItem(`lzTxHash_${selectedOrder.orderId}`) as `0x${string}` | null;
    if (foundHash) setLzTxHash(foundHash);
    startPollingForHederaOrder(selectedOrder.orderId, foundHash);
  }, [address, selectedOrder, setLzTxHash, startPollingForHederaOrder]);

  const handleRelayConfirmation = useCallback(async () => {
    if (!address || !selectedOrder) return;
    
    setIsRelaying(true);
    try {
      // Fetch all transactions for this order
      const orderTransactions = await fetchOrderTransactions(selectedOrder.orderId);
      
      // Find the funding transaction (usually labeled as 'Order Funded' or similar)
      const fundingTx = orderTransactions.find(tx => 
        tx.label.toLowerCase().includes('fund') || 
        tx.label.toLowerCase().includes('deposit')
      );
      
      if (!fundingTx) {
        throw new Error('No funding transaction found for this order. Please try the standard confirmation flow first.');
      }

      // Call the relay service with the actual funding transaction hash
      const result = await submitToMirrorRelay({
        orderId: selectedOrder.orderId,
        txHash: fundingTx.txHash,
        collateralToUnlock: '0',
        fullyRepaid: false,
        reserveId: selectedOrder.reserveId || '0x01',
        borrower: address
      });

      if (result.success) {
        toast.success('Bridge operation started successfully');
        // Start polling for the order status update
        startPollingForHederaOrder(selectedOrder.orderId, fundingTx.txHash);
      } else {
        throw new Error(result.error || 'Failed to start bridge operation');
      }
    } catch (error) {
      console.error('Bridge operation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to start bridge operation');
    } finally {
      setIsRelaying(false);
    }
  }, [address, selectedOrder, startPollingForHederaOrder]);

  // --- SIDE EFFECTS ---
  useEffect(() => {
    // Reset state immediately when order changes to prevent race conditions
    if (selectedOrder) {
      setIsCheckingHedera(false);
      setIsHederaConfirmed(false);
    }
    
    const checkHederaStatus = async () => {
      if (selectedOrder && ['Funded', 'Borrowed'].includes(selectedOrder.status)) {
        setIsCheckingHedera(true);
        setIsHederaConfirmed(false);
        try {
          const hOrder = await readContract(wagmiConfig, {
            address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI,
            functionName: 'horders', args: [selectedOrder.orderId], chainId: HEDERA_CHAIN_ID,
          }) as { ethAmountWei: bigint };
          setIsHederaConfirmed(hOrder && hOrder.ethAmountWei > 0n);
        } catch {
          setIsHederaConfirmed(false);
        } finally {
          setIsCheckingHedera(false);
        }
      } else {
        // If order is not Funded/Borrowed, ensure state is reset
        setIsCheckingHedera(false);
        setIsHederaConfirmed(false);
      }
    };
    checkHederaStatus();
  }, [selectedOrder]);

  // Return everything the UI needs
  return {
    appState, selectedOrder, newlyCreatedOrderId, ethAmount, borrowAmount, logs, lzTxHash, error,
    handleCreateOrder, resetFlow, exitProgressView, onFund, onBorrow, onRepay, onWithdraw, onCalculateBorrow, 
    handleTrackConfirmation, handleRelayConfirmation,
    isCheckingHedera, isHederaConfirmed, isRelaying,
    collateralEth, borrowAmountForRepay, repayable
  };
}