import React from 'react';
import { OrderData } from '../App';
import { WarningIcon } from './Icons';

interface PositionLiquidatedProps {
  orderData: OrderData;
  onReset: () => void;
}

const PositionLiquidated: React.FC<PositionLiquidatedProps> = ({ orderData, onReset }) => {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-red-500 pl-3">Position Liquidated</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-4 border border-red-500/50">
        {/* ... (rest of the JSX is the same) ... */}
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-500/20">
            <WarningIcon />
          </div>
          <h3 className="mt-2 text-lg font-bold text-red-400">Position Liquidated</h3>
          <p className="text-sm text-gray-400">The value of your ETH collateral fell below the safe threshold.</p>
        </div>
        <div className="bg-gray-900/50 p-4 rounded-lg text-sm">
          <p>Your <strong className="text-white">{orderData.ethAmount} ETH</strong> has been sold to cover your debt.</p>
          <p className="mt-2 text-gray-400">The <strong className="text-white">${orderData.usdValue} H-USD</strong> is now yours to keep. This order is now closed.</p>
        </div>
        <button onClick={onReset} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg">
          Start a New Order
        </button>
      </div>
    </div>
  );
};

export default PositionLiquidated;