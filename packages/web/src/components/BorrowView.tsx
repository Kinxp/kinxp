// src/components/BorrowView.tsx

import React, { useState, useEffect } from 'react';
import { SpinnerIcon } from './Icons';

interface BorrowViewProps {
  orderId: string;
  onBorrow: (amountToBorrow: string) => void;
  // NEW: Pass the calculation function down as a prop
  calculateBorrowAmount: () => Promise<{ amount: string, price: string } | null>;
}

const BorrowView: React.FC<BorrowViewProps> = ({ orderId, onBorrow, calculateBorrowAmount }) => {
  const [isCalculating, setIsCalculating] = useState(true);
  const [calculatedAmount, setCalculatedAmount] = useState<string | null>(null);
  const [ethPrice, setEthPrice] = useState<string | null>(null);
  const [userAmount, setUserAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  // Trigger the calculation when the component first loads
  useEffect(() => {
    const performCalculation = async () => {
      setIsCalculating(true);
      const result = await calculateBorrowAmount();
      if (result) {
        setCalculatedAmount(result.amount);
        setEthPrice(result.price);
        setUserAmount(result.amount); // Default the input to the max amount
      }
      // If result is null, an error was already logged in App.tsx
      setIsCalculating(false);
    };
    performCalculation();
  }, [calculateBorrowAmount]); // Dependency on the function prop

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUserAmount(value);
    if (calculatedAmount && parseFloat(value) > parseFloat(calculatedAmount)) {
      setAmountError(`Amount cannot exceed the maximum of ${calculatedAmount} hUSD.`);
    } else if (parseFloat(value) <= 0) {
      setAmountError("Amount must be greater than zero.");
    } else {
      setAmountError(null);
    }
  };
  
  const handleBorrowClick = () => {
    if (userAmount && !amountError) {
      onBorrow(userAmount);
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 3: Borrow hUSD</h3>
      <p className="text-gray-400">Your collateral is confirmed. We are calculating your borrow amount...</p>
      
      {isCalculating ? (
        <div className="flex items-center justify-center gap-2 py-4 text-gray-400">
          <SpinnerIcon />
          <span>Calculating...</span>
        </div>
      ) : (
        <>
          <div className="bg-gray-900/50 p-3 rounded-lg text-left">
            <div className="flex justify-between items-center text-xs text-gray-400">
              <span>Max Borrow Amount</span>
              <span>Based on ETH Price: ${ethPrice ?? '...'}</span>
            </div>
            <div className="text-lg font-mono text-cyan-400 cursor-pointer" onClick={() => calculatedAmount && setUserAmount(calculatedAmount)}>
              {calculatedAmount ?? 'Calculation Failed'} hUSD
            </div>
          </div>
          
          <div>
            <label htmlFor="borrow-amount" className="block text-sm text-left">Amount to Borrow (hUSD)</label>
            <input id="borrow-amount" type="number" value={userAmount} onChange={handleAmountChange} className={`w-full bg-gray-900 border rounded-md p-3 text-center text-lg ${amountError ? 'border-red-500' : 'border-gray-600'}`}/>
            {amountError && <p className="text-red-400 text-xs mt-1 text-left">{amountError}</p>}
          </div>
          
          <button onClick={handleBorrowClick} disabled={!calculatedAmount || !!amountError || !userAmount} className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg disabled:opacity-50">
            Borrow {userAmount || ''} hUSD
          </button>
        </>
      )}
    </div>
  );
};

export default BorrowView;