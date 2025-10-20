import React from 'react';
import { OrderData } from '../App';

interface PositionDashboardProps {
  orderData: OrderData;
  onRepay: () => void;
  onLiquidate: () => void;
}

const PositionDashboard: React.FC<PositionDashboardProps> = ({ orderData, onRepay, onLiquidate }) => {
  // ... (rest of the logic and JSX is the same) ...
  const currentEthPrice = 3267.17;
  const healthFactor = (orderData.ethAmount * currentEthPrice) / parseFloat(orderData.usdValue);
  const healthPercentage = Math.min(((healthFactor - 1) / 1) * 100, 100);

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-blue-400 pl-3">Active Position Dashboard</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">Your Position Details</h3>
          <span className="bg-green-500/20 text-green-300 text-xs font-medium px-2.5 py-1 rounded-full">Healthy</span>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">ETH Collateral</span>
            <span className="font-medium">{orderData.ethAmount} ETH (${(orderData.ethAmount * currentEthPrice).toFixed(2)})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">USD Debt</span>
            <span className="font-medium">{orderData.usdValue} H-USD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Liquidation Price</span>
            <span className="font-medium text-yellow-400">ETH &lt; ${orderData.liquidationPrice}</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Health Factor</label>
          <div className="w-full bg-gray-700 rounded-full h-2.5 mt-1">
            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${healthPercentage}%` }}></div>
          </div>
        </div>
        <div className="flex flex-col space-y-3">
          <button onClick={onRepay} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg">
            Repay H-USD
          </button>
          <button onClick={onLiquidate} className="w-full bg-red-800/50 hover:bg-red-800 text-red-300 text-sm py-2 px-4 rounded-lg transition-colors">
            Simulate Liquidation Event
          </button>
        </div>
      </div>
    </div>
  );
};

export default PositionDashboard;