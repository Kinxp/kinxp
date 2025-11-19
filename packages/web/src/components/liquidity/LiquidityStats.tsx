import React from 'react';
import { formatUnits } from 'ethers';

interface LiquidityStatsProps {
  poolInfo: {
    totalAssets: bigint;
    totalSupply: bigint;
    rewardRatePerDay: bigint; // Changed from 'rewardRate' to match service
    assetAddress: string;
    rewardsTokenAddress: string;
  };
}

const LiquidityStats: React.FC<LiquidityStatsProps> = ({ poolInfo }) => {
  // Safely format values handling potential nulls/undefined
  const formatValue = (value: bigint | string | undefined | null, decimals = 18) => {
    if (value === undefined || value === null) return '0.00';
    try {
      const formatted = formatUnits(value, decimals);
      return parseFloat(formatted).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch (err) {
      console.error("Error formatting value:", value, err);
      return "0.00";
    }
  };

  const stats = [
    {
      name: 'Total Value Locked',
      // Assuming Underlying is USDC (6 decimals) based on your deposit logic
      value: `$${formatValue(poolInfo.totalAssets, 6)}`, 
      description: 'Total assets deposited in the pool',
    },
    {
      name: 'Total LP Tokens',
      // LP Tokens are usually 18 decimals, or match underlying
      value: formatValue(poolInfo.totalSupply, 18), 
      description: 'Total LP tokens in circulation',
    },
    {
      name: 'Reward Rate',
      // Using the correct property 'rewardRatePerDay'
      value: `${formatValue(poolInfo.rewardRatePerDay, 18)} / day`, 
      description: 'Rewards distributed per day',
    },
    {
      name: 'Your Share',
      value: '0.00%', // This would require user position calculation
      description: 'Your share of the liquidity pool',
    },
  ];

  return (
    <div className="bg-gray-800 rounded-xl p-6 shadow-lg mb-8">
      <h2 className="text-xl font-semibold mb-6 text-white">Pool Statistics</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <div key={index} className="bg-gray-700 p-4 rounded-lg">
            <dt className="text-sm font-medium text-gray-400">{stat.name}</dt>
            <dd className="mt-1 text-2xl font-semibold text-white">
              {stat.value}
            </dd>
            <p className="mt-1 text-xs text-gray-400">{stat.description}</p>
          </div>
        ))}
      </div>
      
      <div className="mt-6 pt-6 border-t border-gray-700">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Contract Addresses</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Asset Token</p>
            <p className="text-sm text-blue-400 font-mono break-all">
              {poolInfo.assetAddress}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Reward Token</p>
            <p className="text-sm text-blue-400 font-mono break-all">
              {poolInfo.rewardsTokenAddress}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidityStats;