import React from 'react';
import { UserOrderSummary } from '../../types';
import FundOrderView from './FundOrderView';
import BorrowView from './manageorder/BorrowView';
import RepayView from './manageorder/RepayView';
import WithdrawView from './manageorder/WithdrawView';
import AddCollateralView from './manageorder/AddCollateralView';
import { SpinnerIcon } from '../Icons';

// This component receives all the props it needs to make decisions
interface ManageOrderViewProps {
  selectedOrder: UserOrderSummary;
  isCheckingHedera: boolean;
  isHederaConfirmed: boolean;
  isRelaying: boolean;
  ethAmount: string;
  borrowAmountForRepay: string | null;
  collateralEth: string | null;
  repayable: boolean;
  onFund: (amount: string) => void;
  onBorrow: (amount: string) => void;
  onCalculateBorrow: () => Promise<any>;
  onRepay: () => void;
  onWithdraw: () => void;
  onAddCollateral: (amount: string) => void;
  handleTrackConfirmation: () => void;
  handleRelayConfirmation: () => Promise<void>;
}

export const ManageOrderView: React.FC<ManageOrderViewProps> = (props) => {
  switch (props.selectedOrder.status) {
    case 'Created':
      return <FundOrderView orderId={props.selectedOrder.orderId} ethAmount={props.ethAmount} onFund={props.onFund} />;

    case 'Funded':
    case 'Borrowed':
      if (props.isCheckingHedera) {
        return <div className="text-center p-4"><SpinnerIcon /> <p className="mt-2 text-sm text-gray-400">Confirming status on Hedera...</p></div>;
      }
      if (props.isHederaConfirmed) {
        return (
          <div className="space-y-4">
            <BorrowView 
              orderId={props.selectedOrder.orderId} 
              onBorrow={props.onBorrow} 
              calculateBorrowAmount={props.onCalculateBorrow} 
            />
            
            {/* Add Collateral Section */}
            <div className="my-4 border-t border-gray-700" />
            <AddCollateralView
              orderId={props.selectedOrder.orderId}
              currentCollateralWei={BigInt(props.selectedOrder.amountWei)}
              onAddCollateral={props.onAddCollateral}
              isProcessing={false} // You might want to manage this state
            />
            
            {/* Repay Section */}
            {props.repayable && (
              <>
                <div className="my-4 border-t border-gray-700" />
                <RepayView 
                  orderId={props.selectedOrder.orderId} 
                  borrowAmount={props.borrowAmountForRepay} 
                  collateralEth={props.collateralEth} 
                  onRepay={props.onRepay} 
                />
              </>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-4 p-4">
          <div className="text-center space-y-2 mb-4">
            <h3 className="font-semibold text-lg">Waiting for Cross-Chain Confirmation</h3>
            <p className="text-sm text-gray-400">Your funds are on Sepolia, but the message has not yet arrived on Hedera.</p>
          </div>
          
          <div className="space-y-3">
            <button 
              onClick={props.handleTrackConfirmation} 
              className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg transition-colors"
              disabled={props.isCheckingHedera}
            >
              {props.isCheckingHedera ? 'Checking...' : 'Track Confirmation'}
            </button>
            
            <div className="relative flex items-center my-4">
              <div className="flex-grow border-t border-gray-700"></div>
              <span className="flex-shrink mx-4 text-sm text-gray-500">OR</span>
              <div className="flex-grow border-t border-gray-700"></div>
            </div>
            
            <button 
              onClick={props.handleRelayConfirmation}
              disabled={props.isRelaying}
              className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {props.isRelaying ? 'Processing...' : 'Use Relay to Speed Up'}
            </button>
            
            <p className="text-xs text-gray-500 text-center mt-2">
              The relay will help deliver your cross-chain message faster.
            </p>
          </div>
        </div>
      );

    case 'Funded':
      return (
        <div className="space-y-4 p-4">
          <div className="text-center space-y-2 mb-4">
            <h3 className="font-semibold text-lg">Waiting for Cross-Chain Confirmation</h3>
            <p className="text-sm text-gray-400">Your funds are on Sepolia, but the message has not yet arrived on Hedera.</p>
          </div>
          
          <div className="space-y-3">
            <button 
              onClick={props.handleTrackConfirmation} 
              className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg transition-colors"
              disabled={props.isCheckingHedera}
            >
              {props.isCheckingHedera ? 'Checking...' : 'Track Confirmation'}
            </button>
            
            <div className="relative flex items-center my-4">
              <div className="flex-grow border-t border-gray-700"></div>
              <span className="flex-shrink mx-4 text-sm text-gray-500">OR</span>
              <div className="flex-grow border-t border-gray-700"></div>
            </div>
            
            <button 
              onClick={props.handleRelayConfirmation}
              disabled={props.isRelaying}
              className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {props.isRelaying ? 'Processing...' : 'Use Relay to Speed Up'}
            </button>
            
            <p className="text-xs text-gray-500 text-center mt-2">
              The relay will help deliver your cross-chain message faster.
            </p>
          </div>
        </div>
      );

    case 'ReadyToWithdraw':
      return <WithdrawView orderId={props.selectedOrder.orderId} onWithdraw={props.onWithdraw} />;

    default:
      return <div className="text-center text-gray-400 p-4"><p>This order is in a final state (<span className="font-semibold">{props.selectedOrder.status}</span>).</p></div>;
  }
};