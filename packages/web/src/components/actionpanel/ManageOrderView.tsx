import React from 'react';
import { formatUnits } from 'viem';
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
  handleTrackRepayConfirmation: () => void;
}

export const ManageOrderView: React.FC<ManageOrderViewProps> = (props) => {
  const orderLabel = props.selectedOrder.orderId.slice(0, 10);

  const renderOrderHeader = () => (
    <div className="bg-gray-900/60 border border-gray-700 rounded-xl px-4 py-3 text-sm mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-gray-500">Selected Order</p>
          <p className="font-mono text-cyan-300 text-xs">{props.selectedOrder.orderId}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Status</p>
          <p className="text-sm font-semibold text-white">{props.selectedOrder.status}</p>
        </div>
      </div>
      {props.selectedOrder.reserveId && (
        <p className="text-[11px] text-gray-500 mt-1">
          Reserve: <span className="font-mono text-gray-300">{props.selectedOrder.reserveId}</span>
        </p>
      )}
    </div>
  );

  switch (props.selectedOrder.status) {
    case 'Created':
      return (
        <div className="space-y-4">
          {renderOrderHeader()}
          <FundOrderView
            orderId={props.selectedOrder.orderId}
            ethAmount={props.ethAmount}
            onFund={props.onFund}
          />
        </div>
      );

    case 'Funded':
    case 'Borrowed':
      if (props.isCheckingHedera && !(props.selectedOrder.unlockedWei && props.selectedOrder.unlockedWei > 0n)) {
        return <div className="text-center p-4"><SpinnerIcon /> <p className="mt-2 text-sm text-gray-400">Confirming status on Hedera...</p></div>;
      }
      const unlockedWei = props.selectedOrder.unlockedWei ?? 0n;
      const hasUnlocked = unlockedWei > 0n;
      if (props.isHederaConfirmed || hasUnlocked) {
          const unlockedEth = hasUnlocked ? formatUnits(unlockedWei, 18) : null;
          return (
        <div className="space-y-4">
          {renderOrderHeader()}
          {hasUnlocked && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <p className="text-sm text-amber-200 font-semibold">Unlocked ETH available</p>
              <p className="text-lg font-mono text-white mt-1">{unlockedEth} ETH</p>
              <p className="text-xs text-amber-100/80 mt-1">
                This collateral is ready to withdraw on Sepolia. Withdraw it below or keep it deposited as extra buffer.
              </p>
              <button
                onClick={props.onWithdraw}
                className="mt-3 w-full bg-amber-500/80 hover:bg-amber-500 text-gray-900 font-bold py-2 rounded-lg transition-colors"
              >
                Withdraw unlocked ETH
              </button>
            </div>
          )}
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
          {renderOrderHeader()}
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
          </div>
        </div>
      );

    case 'PendingRepayConfirmation':
      return (
        <div className="space-y-4 p-4">
          {renderOrderHeader()}
          <div className="text-center space-y-2 mb-4">
            <h3 className="font-semibold text-lg">Waiting for Repay Confirmation</h3>
            <p className="text-sm text-gray-400">Your repay cleared on Hedera. Bridge the message back to Sepolia to unlock your ETH.</p>
          </div>
          
          <div className="space-y-3">
            <button 
              onClick={props.handleTrackRepayConfirmation} 
              className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg transition-colors"
              disabled={props.isCheckingHedera}
            >
              {props.isCheckingHedera ? 'Checking...' : 'Track Ethereum Confirmation'}
            </button>
          </div>
        </div>
      );

    case 'ReadyToWithdraw':
      return (
        <div className="space-y-4">
          {renderOrderHeader()}
          <WithdrawView
            orderId={props.selectedOrder.orderId}
            onWithdraw={props.onWithdraw}
            availableWei={props.selectedOrder.unlockedWei}
          />
        </div>
      );

    default:
      return (
        <div className="space-y-4 p-4">
          {renderOrderHeader()}
          <div className="text-center text-gray-400">
            <p>This order is in a final state (<span className="font-semibold">{props.selectedOrder.status}</span>).</p>
          </div>
        </div>
      );
  }
};
