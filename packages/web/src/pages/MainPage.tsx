// src/pages/MainPage.tsx
import React from 'react';
import { useAccount } from 'wagmi';
import { useAppContext } from '../context/AppContext';
import { AppState } from '../types';

import DashboardPageModal from '../components/DashboardPageModal';
import CreateOrderView from '../components/dashboard/CreateOrderView';
import FundOrderView from '../components/actionpanel/FundOrderView';
import ProgressView from '../components/actionpanel/ProgressView';
import BorrowView from '../components/actionpanel/manageorder/BorrowView';
import RepayView from '../components/actionpanel/manageorder/RepayView';
import WithdrawView from '../components/actionpanel/manageorder/WithdrawView';
import UserOrders from '../components/dashboard/UserOrders';

const MainPage = () => {
  const { isConnected } = useAccount();

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
  } = useAppContext();

  const renderContent = () => {
    if (!isConnected) return <DashboardPageModal />;
    switch (appState) {
      case AppState.IDLE:
        return <CreateOrderView onSubmit={handleCreateOrder} />;
      case AppState.ORDER_CREATED:
        return (
          <FundOrderView
            orderId={orderId!}
            ethAmount={ethAmount}
            onFund={handleFundOrder}
          />
        );
      case AppState.READY_TO_BORROW:
        return (
          <BorrowView
            orderId={orderId!}
            onBorrow={handleBorrow}
            calculateBorrowAmount={calculateBorrowAmount}
          />
        );
      case AppState.LOAN_ACTIVE:
        return (
          <RepayView
            orderId={orderId!}
            borrowAmount={borrowAmount}
            collateralEth={ethAmount}
            onRepay={handleRepay}
          />
        );
      case AppState.READY_TO_WITHDRAW:
        return <WithdrawView orderId={orderId!} onWithdraw={handleWithdraw} />;
      case AppState.COMPLETED:
        return (
          <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-2">
            <h3 className="text-xl font-semibold text-gray-100">Withdrawal complete.</h3>
          </div>
        );
      case AppState.ERROR:
        return (
          <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-2">
            <h3 className="text-xl font-semibold text-red-300">Error</h3>
            <p className="text-sm text-gray-400">{error}</p>
          </div>
        );
      default:
        return <ProgressView logs={logs} lzTxHash={lzTxHash} />;
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
