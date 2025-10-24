// src/pages/MainPage.tsx

import React from 'react';
import { useAccount } from 'wagmi';
import { useAppContext } from '../context/AppContext';
import { AppState } from '../types';

// Import all your view components
import HomePage from '../components/HomePage';
import CreateOrderView from '../components/CreateOrderView';
import FundOrderView from '../components/FundOrderView';
import ProgressView from '../components/ProgressView';
import BorrowView from '../components/BorrowView';
import RepayView from '../components/RepayView';
import WithdrawView from '../components/WithdrawView';
import UserOrders from '../components/UserOrders';

const MainPage = () => {
  const { isConnected } = useAccount();
  
  // Get all state and functions from our new global context!
  const {
    appState,
    logs,
    orderId,
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
  } = useAppContext();

  // This render function is now much cleaner
  const renderContent = () => {
    if (!isConnected) return <HomePage />;
    switch (appState) {
      case AppState.IDLE: return <CreateOrderView onSubmit={handleCreateOrder} />;
      case AppState.ORDER_CREATED: return <FundOrderView orderId={orderId!} ethAmount={ethAmount} onFund={handleFundOrder} />;
      case AppState.READY_TO_BORROW: return <BorrowView orderId={orderId!} onBorrow={handleBorrow} calculateBorrowAmount={calculateBorrowAmount} />;
      case AppState.LOAN_ACTIVE: return <RepayView orderId={orderId!} borrowAmount={borrowAmount} collateralEth={ethAmount} onRepay={handleRepay} />;
      case AppState.READY_TO_WITHDRAW: return <WithdrawView orderId={orderId!} onWithdraw={handleWithdraw} />;
      case AppState.COMPLETED: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-green-400">✅ Success!</h3><p>You can now start a new transaction.</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Start Over</button></div>;
      case AppState.ERROR: return <div className="text-center space-y-4"><h3 className="text-2xl font-bold text-red-400">❌ Error</h3><p className="text-sm text-gray-400 mt-2">{error}</p><button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Try Again</button></div>;
      default: return <ProgressView logs={logs} lzTxHash={lzTxHash} />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="max-w-2xl mx-auto">{renderContent()}</div>
      <UserOrders />
    </div>
  );
};

export default MainPage;
