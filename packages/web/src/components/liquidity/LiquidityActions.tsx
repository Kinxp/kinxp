import React from 'react';
import { formatUnits } from 'ethers';

interface LiquidityActionsProps {
  activeTab: 'deposit' | 'withdraw';
  amount: string;
  setAmount: (amount: string) => void;
  onDeposit: () => Promise<void>;
  onWithdraw: () => Promise<void>;
  onClaimRewards: () => Promise<void>;
  isProcessing: boolean;
  userPosition: any;
}

const LiquidityActions: React.FC<LiquidityActionsProps> = ({
  activeTab,
  amount,
  setAmount,
  onDeposit,
  onWithdraw,
  onClaimRewards,
  isProcessing,
  userPosition,
}) => {
  const handleMax = () => {
    if (activeTab === 'deposit') {
      // TODO: Get user's token balance
      // setAmount(formatUnits(userBalance, 18));
    } else {
      // Set to user's LP token balance for withdrawal
      // setAmount(formatUnits(userPosition?.lpBalance || '0', 18));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'deposit') {
      onDeposit();
    } else {
      onWithdraw();
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="amount" className="block text-sm font-medium text-gray-300">
              {activeTab === 'deposit' ? 'Amount to deposit' : 'Amount to withdraw'}
            </label>
            <button
              type="button"
              onClick={handleMax}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Max
            </button>
          </div>
          
          <div className="relative rounded-md shadow-sm">
            <input
              type="text"
              name="amount"
              id="amount"
              className="block w-full rounded-lg border-0 bg-gray-700 text-white p-4 pr-24 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                // Allow only numbers and decimal point
                const value = e.target.value.replace(/[^0-9.]/g, '');
                // Ensure only one decimal point
                const parts = value.split('.');
                if (parts.length > 2) return;
                setAmount(value);
              }}
              disabled={isProcessing}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
              <span className="text-gray-400 sm:text-sm">
                {activeTab === 'deposit' ? 'USDC' : 'LP'}
              </span>
            </div>
          </div>
          
          <div className="mt-2 text-sm text-gray-400">
            {activeTab === 'deposit' ? (
              <span>Balance: 0.00 USDC</span>
            ) : (
              <span>Your LP Balance: {userPosition?.lpBalance || '0.00'} LP</span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <button
            type="submit"
            disabled={!amount || isProcessing}
            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white ${
              !amount || isProcessing
                ? 'bg-gray-600 cursor-not-allowed'
                : activeTab === 'deposit'
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-red-600 hover:bg-red-700'
            } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
          >
            {isProcessing ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </span>
            ) : activeTab === 'deposit' ? (
              'Deposit'
            ) : (
              'Withdraw'
            )}
          </button>

          <button
            type="button"
            onClick={onClaimRewards}
            disabled={isProcessing || !userPosition?.pendingRewards || userPosition.pendingRewards === '0'}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Claim Rewards
            {userPosition?.pendingRewards && userPosition.pendingRewards !== '0' && (
              <span className="ml-2 px-2 py-0.5 bg-purple-800 rounded-full text-xs">
                {parseFloat(formatUnits(userPosition.pendingRewards, 18)).toFixed(4)} REWARD
              </span>
            )}
          </button>
        </div>
      </form>
      
      <div className="mt-6 p-4 bg-gray-700 rounded-lg">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Transaction Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Exchange Rate</span>
            <span className="text-white">1 USDC = 1.00 LP</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Price Impact</span>
            <span className="text-green-400">0.05%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Liquidity Provider Fee</span>
            <span className="text-white">0.3%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidityActions;
