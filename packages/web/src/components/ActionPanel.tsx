import React from 'react';
import { useAppContext } from '../context/AppContext';
import { UserOrderSummary, AppState } from '../types';
import { formatUnits } from 'viem'; // We need this to format the collateral amount

// Import all the possible views the panel can show
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
  // Get all necessary state and functions from the global context
  const {
    appState,
    selectedOrderId,
    orderId: newlyCreatedOrderId, // Use a more descriptive name for the linear flow ID
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

  // Find the full data for the currently selected order from the dashboard lists
  const selectedOrder = allOrders.find(o => o.orderId === selectedOrderId);

  // --- RENDER LOGIC ---

  // 1. First, check for any "in-progress" or final states from the context. These take top priority.
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
        // This is the intermediate step in the linear flow, after creating an order.
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

  // 2. If an order is selected from the dashboard lists, show the relevant action view.
  if (selectedOrder) {
    switch (selectedOrder.status) {
      case 'Created':
        // A 'Created' order needs to be funded. The `ethAmount` here is just a default.
        return <FundOrderView orderId={selectedOrder.orderId} ethAmount={ethAmount} onFund={handleFundOrder} />;
      
      case 'Funded':
        // A 'Funded' order can be used for Borrowing or Repaying.
        // --- THIS IS THE FIX ---
        // We get the collateral amount from the selected order object and format it.
        const collateralEth = formatUnits(selectedOrder.amountWei, 18);
        return (
          <div>
             <BorrowView orderId={selectedOrder.orderId} onBorrow={handleBorrow} calculateBorrowAmount={calculateBorrowAmount} />
             <div className="my-4 border-t border-gray-700"></div>
             <RepayView 
                orderId={selectedOrder.orderId} 
                borrowAmount={borrowAmount} // This comes from the context after a successful borrow
                collateralEth={collateralEth} // Pass the collateral amount here
                onRepay={handleRepay} 
             />
          </div>
        );
      
      case 'ReadyToWithdraw':
        return <WithdrawView orderId={selectedOrder.orderId} onWithdraw={handleWithdraw} />;
      
      default:
        return (
          <div className="text-center text-gray-400 p-4">
            <p>This order is in a final state (<span className="font-semibold">{selectedOrder.status}</span>) and has no further actions.</p>
          </div>
        );
    }
  }

  // 3. If nothing else matches (app is IDLE, no order selected), show the default "Create Order" view.
  return <CreateOrderView onSubmit={handleCreateOrder} />;
};

export default ActionPanel;