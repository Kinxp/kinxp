import React, { ReactNode, useMemo } from 'react';
import { WalletProvider, useWallet } from './WalletContext'; // Adjust paths
import { LogProvider, useLogs } from './LogContext';         // Adjust paths
import { OrderProvider, useOrder } from './OrderContext';    // Adjust paths
import { AppState } from '../types';

// Re-export types if needed so existing files don't break
// interface AppContextType { ... } <- You don't strictly need this interface exported 
// if your consumers use the inferred return type of useAppContext, 
// but if they import the type explicitly, paste the old interface here.

export function AppProvider({ children }: { children: ReactNode }) {
  // Nest the providers. Order depends on Wallet/Logs, so it must be inside.
  return (
    <WalletProvider>
      <LogProvider>
        <OrderProvider>
          {children}
        </OrderProvider>
      </LogProvider>
    </WalletProvider>
  );
}

// The Aggregator Hook
// This merges the 3 contexts into one object that matches your old AppContext structure.
export const useAppContext = () => {
  const wallet = useWallet();
  const logs = useLogs();
  const order = useOrder();

  return useMemo(() => ({
    // Wallet Props
    isConnected: wallet.isConnected,
    address: wallet.address,
    connectWallet: wallet.connectWallet,
    
    // Log Props
    logs: logs.logs,
    error: logs.error,
    
    // Order Props (State)
    appState: order.appState,
    orderId: order.orderId,
    selectedOrderId: order.selectedOrderId,
    ethAmount: order.ethAmount,
    borrowAmount: order.borrowAmount,
    lzTxHash: order.lzTxHash,
    ordersRefreshVersion: order.ordersRefreshVersion,
    
    // Order Props (Actions)
    handleCreateOrder: order.handleCreateOrder,
    handleFundOrder: order.handleFundOrder,
    handleAddCollateral: order.handleAddCollateral,
    handleBorrow: order.handleBorrow,
    handleRepay: order.handleRepay,
    handleWithdraw: order.handleWithdraw,
    calculateBorrowAmount: order.calculateBorrowAmount,
    resetFlow: order.resetFlow,
    setSelectedOrderId: order.setSelectedOrderId,
    startPollingForHederaOrder: order.startPollingForHederaOrder,
    startPollingForEthRepay: order.startPollingForEthRepay,
    setLzTxHash: order.setLzTxHash,
    triggerWithdrawRelay: order.triggerWithdrawRelay,
    refreshOrders: order.refreshOrders,
    
  }), [wallet, logs, order]);
};