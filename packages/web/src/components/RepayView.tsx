// src/components/RepayView.tsx

import React from 'react';

interface RepayViewProps {
  orderId: string;
  onRepay: () => void;
}

const RepayView: React.FC<RepayViewProps> = ({ orderId, onRepay }) => {
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 4: Repay Your Loan</h3>
      <p className="text-gray-400">You have an active loan. Repay the hUSD to unlock your ETH collateral on Ethereum.</p>
      
      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm">
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
      </div>

      <button onClick={onRepay} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg">
        Repay hUSD & Cross to Ethereum
      </button>
    </div>
  );
};

export default RepayView;