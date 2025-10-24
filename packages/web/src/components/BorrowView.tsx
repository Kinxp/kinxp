// src/components/BorrowView.tsx

import React, { useState } from 'react';

interface BorrowViewProps {
  orderId: string;
  onBorrow: () => void;
}

const BorrowView: React.FC<BorrowViewProps> = ({ orderId, onBorrow }) => {
  const [borrowAmount, setBorrowAmount] = useState('1.50'); // Example amount

  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 3: Borrow hUSD</h3>
      <p className="text-gray-400">Your collateral is confirmed on Hedera. You can now borrow hUSD against it.</p>
      
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">Amount to Borrow (hUSD)</label>
        <input 
          type="text" 
          value={borrowAmount} 
          onChange={(e) => setBorrowAmount(e.target.value)} 
          className="w-full bg-gray-900 border-gray-600 rounded-md p-3 text-center"
          disabled // For now, we use a fixed amount from App.tsx logic
        />
      </div>
      
      <button onClick={onBorrow} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg">
        Borrow hUSD
      </button>
    </div>
  );
};

export default BorrowView;