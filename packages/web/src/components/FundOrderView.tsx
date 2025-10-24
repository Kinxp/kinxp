// src/components/FundOrderView.tsx

import React from 'react';

interface FundOrderViewProps {
  orderId: string;
  ethAmount: string; 
  onFund: (amountToFund: string) => void; // UPDATED: onFund now takes an argument
}

const FundOrderView: React.FC<FundOrderViewProps> = ({ orderId, ethAmount, onFund }) => {
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 2: Fund Your Order</h3>
      <p className="text-gray-400">Your order has been created on Ethereum. Now, fund it with your collateral to proceed.</p>
      
      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm space-y-2">
        <div>
          <span className="text-gray-500">Amount to Fund:</span>
          <span className="font-bold text-white ml-2">{ethAmount} ETH</span>
        </div>
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
      </div>

      <button onClick={() => onFund(ethAmount)} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg">
        Fund Order & Cross to Hedera
      </button>
    </div>
  );
};

export default FundOrderView;