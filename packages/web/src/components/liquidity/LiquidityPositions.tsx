import React from 'react';
import { formatUnits } from 'ethers';

interface LiquidityPositionsProps {
  userPosition: {
    lpBalance?: string;
    stakedBalance?: string;
    pendingRewards?: string;
    apr?: number;
    stakedValue?: string;
  } | null;
  onWithdraw: (amount: string) => Promise<void>;
  onClaimRewards: () => Promise<void>;
}

const LiquidityPositions: React.FC<LiquidityPositionsProps> = ({
  userPosition,
  onWithdraw,
  onClaimRewards,
}) => {
  if (!userPosition) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center">
        <p className="text-gray-400">No active liquidity positions found</p>
        <p className="text-sm text-gray-500 mt-2">
          Deposit liquidity to start earning rewards
        </p>
      </div>
    );
  }

  const formatValue = (value: string | undefined, decimals = 18) => {
    if (!value) return '0.00';
    return parseFloat(formatUnits(value, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  };

  const positions = [
    {
      name: 'Your LP Tokens',
      value: formatValue(userPosition.lpBalance || '0'),
      symbol: 'LP',
    },
    {
      name: 'Staked LP Tokens',
      value: formatValue(userPosition.stakedBalance || '0'),
      symbol: 'LP',
    },
    {
      name: 'Staked Value',
      value: `$${formatValue(userPosition.stakedValue || '0')}`,
      symbol: '',
    },
    {
      name: 'APR',
      value: userPosition.apr ? `${userPosition.apr.toFixed(2)}%` : '0.00%',
      symbol: '',
    },
  ];

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden shadow">
      <div className="px-6 py-5 border-b border-gray-700">
        <h3 className="text-lg font-medium text-white">Your Liquidity Position</h3>
      </div>
      
      <div className="px-6 py-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {positions.map((position, index) => (
            <div key={index} className="bg-gray-700 p-4 rounded-lg">
              <dt className="text-sm font-medium text-gray-400">{position.name}</dt>
              <dd className="mt-1 text-xl font-semibold text-white">
                {position.value}
                {position.symbol && <span className="ml-1 text-gray-400">{position.symbol}</span>}
              </dd>
            </div>
          ))}
        </div>

        <div className="bg-gray-700 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-300">Pending Rewards</h4>
              <p className="mt-1 text-2xl font-bold text-purple-400">
                {formatValue(userPosition.pendingRewards || '0')}
                <span className="ml-1 text-sm text-gray-400">REWARD</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">
                ≈ ${(parseFloat(formatValue(userPosition.pendingRewards || '0', 18)) * 1.5).toFixed(2)} USD
              </p>
            </div>
            <div className="mt-4 sm:mt-0">
              <button
                onClick={onClaimRewards}
                disabled={!userPosition.pendingRewards || userPosition.pendingRewards === '0'}
                className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Claim Rewards
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="px-6 py-4 bg-gray-900 rounded-b-xl flex justify-end space-x-3">
        <button
          onClick={() => onWithdraw(userPosition.stakedBalance || '0')}
          disabled={!userPosition.stakedBalance || userPosition.stakedBalance === '0'}
          className="px-4 py-2 border border-red-600 rounded-md text-sm font-medium text-red-400 hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Unstake All
        </button>
        <button
          onClick={() => onWithdraw(userPosition.lpBalance || '0')}
          disabled={!userPosition.lpBalance || userPosition.lpBalance === '0'}
          className="px-4 py-2 border border-blue-600 rounded-md text-sm font-medium text-blue-400 hover:bg-blue-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Withdraw All
        </button>
      </div>
    </div>
  );
};

export default LiquidityPositions;
