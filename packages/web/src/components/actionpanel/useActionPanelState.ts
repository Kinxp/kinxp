import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { UserOrderSummary } from '../../types';
import { formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../../wagmi';
import { HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR } from '../../config';
import { submitToMirrorRelay } from '../../services/mirrorRelayService';
import { fetchOrderTransactions, fetchOrderSummary } from '../../services/blockscoutService';
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
    handleRepay, handleWithdraw, handleAddCollateral, resetFlow, exitProgressView, 
    startPollingForHederaOrder, startPollingForEthRepay, address, setLzTxHash, triggerWithdrawRelay,
  } = useAppContext();

  const [isCheckingHedera, setIsCheckingHedera] = useState(false);
  const [isHederaConfirmed, setIsHederaConfirmed] = useState(false);
  const [isRelaying, setIsRelaying] = useState(false);

  const selectedOrder = allOrders.find(o => o.orderId === selectedOrderId);
  const [liveOrderSnapshot, setLiveOrderSnapshot] = useState<UserOrderSummary | null>(null);

  // --- DERIVED STATE ---
  const effectiveOrder = liveOrderSnapshot ?? selectedOrder;
  const collateralEth = effectiveOrder ? formatUnits(effectiveOrder.amountWei, 18) : null;
  const borrowAmountForRepay = effectiveOrder?.borrowedUsd ? formatUnits(effectiveOrder.borrowedUsd, 6) : borrowAmount;
  const repayable = !!borrowAmountForRepay && Number(borrowAmountForRepay) > 0;

  // --- MEMOIZED HANDLERS ---
  const onFund = useCallback((amountToFund: string) => handleFundOrder(amountToFund), [handleFundOrder]);
  const onBorrow = useCallback((amount: string) => { if (selectedOrder) handleBorrow(amount); }, [handleBorrow, selectedOrder]);
  const onRepay = useCallback((amount: string) => { 
    if (selectedOrder && amount) {
      return handleRepay(amount);
    }
    return Promise.reject(new Error('Invalid order or amount'));
  }, [handleRepay, selectedOrder]);
  const onWithdraw = useCallback(() => { if (selectedOrder) handleWithdraw(); }, [handleWithdraw, selectedOrder]);
  const onAddCollateral = useCallback((amount: string) => { 
    if (selectedOrder && amount) {
      return handleAddCollateral(amount);
    }
    return Promise.reject(new Error('Invalid order or amount'));
  }, [handleAddCollateral, selectedOrder]);
  const onCalculateBorrow = useCallback(() => { if (selectedOrder) return calculateBorrowAmount(); return Promise.resolve(null); }, [calculateBorrowAmount, selectedOrder]);
  
  const handleTrackConfirmation = useCallback(async () => {
    if (!address || !selectedOrder) return;
    const foundHash = localStorage.getItem(`lzTxHash_${selectedOrder.orderId}`) as `0x${string}` | null;
    if (foundHash) setLzTxHash(foundHash);
    startPollingForHederaOrder(selectedOrder.orderId, foundHash);
  }, [address, selectedOrder, setLzTxHash, startPollingForHederaOrder]);

  const handleTrackRepayConfirmation = useCallback(() => {
    if (!selectedOrder) return;
    startPollingForEthRepay(selectedOrder.orderId);
  }, [selectedOrder, startPollingForEthRepay]);

  const handleRelayConfirmation = useCallback(async () => {
    if (!address || !selectedOrder) return;

    setIsRelaying(true);
    try {
      const isRepayFlow = selectedOrder.status === 'PendingRepayConfirmation';

      const orderTransactions = await fetchOrderTransactions(selectedOrder.orderId);

      const findTransaction = (predicate: (tx: OrderTransaction) => boolean) => {
        for (let i = orderTransactions.length - 1; i >= 0; i -= 1) {
          const tx = orderTransactions[i];
          if (predicate(tx)) return tx;
        }
        return undefined;
      };

      const relayTx = isRepayFlow
        ? findTransaction((tx) => tx.label.toLowerCase().includes('repaid'))
        : findTransaction((tx) =>
            tx.label.toLowerCase().includes('fund') ||
            tx.label.toLowerCase().includes('deposit')
          );

      if (!relayTx) {
        throw new Error(
          isRepayFlow
            ? 'No Hedera repay transaction found. Please try the standard confirmation flow first.'
            : 'No funding transaction found for this order. Please try the standard confirmation flow first.'
        );
      }

      if (isRepayFlow) {
        await triggerWithdrawRelay(selectedOrder.orderId, relayTx.txHash);
        toast.success('Repay relay triggered');
        startPollingForEthRepay(selectedOrder.orderId);
      } else {
        const result = await submitToMirrorRelay({
          orderId: selectedOrder.orderId,
          txHash: relayTx.txHash,
          collateralToUnlock: '0',
          fullyRepaid: false,
          reserveId: selectedOrder.reserveId || '0x01',
          borrower: address,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to start bridge operation');
        }

        toast.success('Bridge operation started successfully');
        startPollingForHederaOrder(selectedOrder.orderId, relayTx.txHash);
      }
    } catch (error) {
      console.error('Bridge operation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to start bridge operation');
    } finally {
      setIsRelaying(false);
    }
  }, [address, selectedOrder, startPollingForHederaOrder, startPollingForEthRepay, triggerWithdrawRelay]);

  const handleRepayRelayConfirmation = useCallback(async () => {
    if (!selectedOrder) return;
    setIsRelaying(true);
    try {
      const txHash = (lzTxHash as `0x${string}` | null) ?? null;
      await triggerWithdrawRelay(selectedOrder.orderId, txHash);
      toast.success('Repay relay triggered');
      startPollingForEthRepay(selectedOrder.orderId);
    } catch (error) {
      console.error('Repay relay error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to trigger repay relay');
    } finally {
      setIsRelaying(false);
    }
  }, [selectedOrder, triggerWithdrawRelay, lzTxHash, startPollingForEthRepay]);

  // --- SIDE EFFECTS ---
  useEffect(() => {
    if (selectedOrder) {
      setIsCheckingHedera(false);
      setIsHederaConfirmed(false);
    }
    let cancelled = false;

    const refreshOrderSnapshot = async () => {
      if (!selectedOrder) {
        setLiveOrderSnapshot(null);
        return;
      }
      try {
        let updated = await fetchOrderSummary(selectedOrder.orderId);
        if (selectedOrder && updated && selectedOrder.borrowedUsd > 0n && updated.borrowedUsd === 0n) {
          updated = { ...updated, status: updated.status === 'ReadyToWithdraw' ? updated.status : 'PendingRepayConfirmation' };
        }
        if (!cancelled) {
          setLiveOrderSnapshot(updated ?? selectedOrder);
        }
      } catch {
        if (!cancelled) {
          setLiveOrderSnapshot(selectedOrder);
        }
      }
    };

    const checkHederaStatus = async () => {
      if (selectedOrder && ['Funded', 'Borrowed'].includes(selectedOrder.status)) {
        setIsCheckingHedera(true);
        setIsHederaConfirmed(false);
        try {
          const hOrder = await readContract(wagmiConfig, {
            address: HEDERA_CREDIT_OAPP_ADDR,
            abi: HEDERA_CREDIT_ABI,
            functionName: 'horders',
            args: [selectedOrder.orderId],
            chainId: HEDERA_CHAIN_ID,
          }) as { ethAmountWei: bigint };
          setIsHederaConfirmed(hOrder && hOrder.ethAmountWei > 0n);
        } catch {
          setIsHederaConfirmed(false);
        } finally {
          setIsCheckingHedera(false);
        }
      } else {
        setIsCheckingHedera(false);
        setIsHederaConfirmed(false);
      }
    };

    refreshOrderSnapshot();
    checkHederaStatus();

    return () => {
      cancelled = true;
    };
  }, [selectedOrder, appState]);

  return {
    appState,
    selectedOrder: effectiveOrder ?? null,
    newlyCreatedOrderId,
    ethAmount,
    borrowAmount,
    logs,
    lzTxHash,
    error,
    handleCreateOrder,
    resetFlow,
    exitProgressView,
    onFund,
    onBorrow,
    onRepay,
    onWithdraw,
    onCalculateBorrow,
    onAddCollateral,
    handleTrackConfirmation,
    handleTrackRepayConfirmation,
    handleRelayConfirmation,
    handleRepayRelayConfirmation,
    isCheckingHedera,
    isHederaConfirmed,
    isRelaying,
    collateralEth,
    borrowAmountForRepay,
    repayable,
  };
}
