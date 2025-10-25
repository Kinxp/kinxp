import React from 'react';
import { useAppContext } from '../context/AppContext';
import { UserOrderSummary, AppState } from '../types';
import { formatUnits } from 'viem';

import CreateOrderView from './CreateOrderView';
import FundOrderView from './FundOrderView';
import BorrowView from './BorrowView';
import RepayView from './RepayView';
import WithdrawView from './WithdrawView';
import ProgressView from './ProgressView';

interface ActionPanelProps {
  allOrders: UserOrderSummary[];
}

const ActionPanel: React.FC<ActionPanelProps> = ({ allOrders }) => {
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
  } = useAppContext();

  const selectedOrder = allOrders.find(o => o.orderId === selectedOrderId);
  const collateralEth = selectedOrder ? formatUnits(selectedOrder.amountWei, 18) : null;
  const borrowAmountForRepay = selectedOrder?.borrowedUsd
    ? formatUnits(selectedOrder.borrowedUsd, 6)
    : borrowAmount;

  const repayable = !!borrowAmountForRepay && Number(borrowAmountForRepay) > 0;

  // In-progress / terminal states take priority
  if (appState !== AppState.IDLE && appState !== AppState.LOAN_ACTIVE) {
    switch (appState) {
      case AppState.ORDER_CREATING:
      case AppState.FUNDING_IN_PROGRESS:
      case AppState.CROSSING_TO_HEDERA:
      case AppState.BORROWING_IN_PROGRESS:
      case AppState.RETURNING_FUNDS:
      case AppState.REPAYING_IN_PROGRESS:
      case AppState.CROSSING_TO_ETHEREUM:
      case AppState.WITHDRAWING_IN_PROGRESS:
        return <ProgressView logs={logs} lzTxHash={lzTxHash} />;

      case AppState.ORDER_CREATED:
        return <FundOrderView orderId={newlyCreatedOrderId!} ethAmount={ethAmount} onFund={handleFundOrder} />;

      case AppState.COMPLETED:
        return (
          <div className="text-center space-y-4">
            <h3 className="text-2xl font-bold text-green-400">✅ Success!</h3>
            <p>The last action was completed successfully.</p>
            <button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Start Over</button>
          </div>
        );

      case AppState.ERROR:
        return (
          <div className="text-center space-y-4">
            <h3 className="text-2xl font-bold text-red-400">❌ Error</h3>
            <p className="text-sm text-gray-400 mt-2">{error}</p>
            <button onClick={resetFlow} className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg">Try Again</button>
          </div>
        );
    }
  }

  // When a row is selected, show relevant actions for that order
  if (selectedOrder) {
    switch (selectedOrder.status) {
      case 'Created':
        return <FundOrderView orderId={selectedOrder.orderId} ethAmount={ethAmount} onFund={handleFundOrder} />;

      case 'Funded':
        return (
          <div className="space-y-4">
            <BorrowView orderId={selectedOrder.orderId} onBorrow={handleBorrow} calculateBorrowAmount={calculateBorrowAmount} />
            {repayable && (
              <>
                <div className="my-4 border-t border-gray-700" />
                <RepayView
                  orderId={selectedOrder.orderId}
                  borrowAmount={borrowAmountForRepay}
                  collateralEth={collateralEth}
                  onRepay={handleRepay}
                />
              </>
            )}
          </div>
        );

      case 'Borrowed':
        return repayable ? (
          <RepayView
            orderId={selectedOrder.orderId}
            borrowAmount={borrowAmountForRepay}
            collateralEth={collateralEth}
            onRepay={handleRepay}
          />
        ) : (
          <div className="text-center text-gray-400 p-4">No outstanding debt to repay.</div>
        );

      case 'ReadyToWithdraw':
        return <WithdrawView orderId={selectedOrder.orderId} onWithdraw={handleWithdraw} />;

      default:
        return (
          <div className="text-center text-gray-400 p-4">
            <p>This order is in a final state (<span className="font-semibold">{selectedOrder.status}</span>).</p>
          </div>
        );
    }
  }

  // No selection: show a lightweight hint (Create panel is always rendered above)
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400">
      Select an order from the right to manage it.
    </div>
  );
};

export default ActionPanel;
