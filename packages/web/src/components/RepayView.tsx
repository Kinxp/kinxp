// src/components/RepayView.tsx

import React from 'react';

interface RepayViewProps {
  orderId: string;
  // NEW: Accept the borrowed amount as a prop
  borrowAmount: string | null;
  onRepay: () => void;
}

const RepayView: React.FC<RepayViewProps> = ({ orderId, borrowAmount, onRepay }) => {
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 4: Repay Your Loan</h3>
      <p className="text-gray-400">Repay the hUSD to unlock your ETH collateral on Ethereum.</p>
      
      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm space-y-2">
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
        {/* NEW: Display the amount to repay */}
        <div>
          <span className="text-gray-500">Amount to Repay:</span>
          <code className="text-cyan-300 ml-2 font-mono">{borrowAmount ?? '...'} hUSD</code>
        </div>
      </div>

      <button 
        onClick={onRepay} 
        // NEW: Disable the button if the amount isn't loaded yet
        disabled={!borrowAmount}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Approve & Repay {borrowAmount ? `${borrowAmount} hUSD` : ''}
      </button>
      <p className="text-xs text-gray-500">
        This is a two-step process if you haven't approved the token before. You will be asked to sign an `approve` transaction first, followed by the `repay` transaction.
      </p>
    </div>
  );
};

export default RepayView;