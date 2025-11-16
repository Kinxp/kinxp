import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { UserOrderSummary } from '../../types';
import { formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../../wagmi';
import { HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR } from '../../config';

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
    
    // First try to get the transaction hash from the order, then from localStorage
    const foundHash = selectedOrder.creationTxHash || 
                     localStorage.getItem(`lzTxHash_${selectedOrder.orderId}`) as `0x${string}` | null;
    
    if (foundHash) {
      setLzTxHash(foundHash);
    }
    
    // Start polling with the hash (or null if not found)
    startPollingForHederaOrder(selectedOrder.orderId, foundHash || undefined);
  }, [address, selectedOrder, setLzTxHash, startPollingForHederaOrder]);

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
    // State
    appState, selectedOrder, newlyCreatedOrderId, ethAmount, borrowAmount, logs, lzTxHash, error,
    isCheckingHedera, isHederaConfirmed, collateralEth, borrowAmountForRepay, repayable,
    // Handlers
    handleCreateOrder, resetFlow, exitProgressView, onFund, onBorrow, onRepay, onWithdraw, onCalculateBorrow, handleTrackConfirmation,
  };
}