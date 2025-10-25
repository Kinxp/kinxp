// src/components/BorrowView.tsx
import React, { useState, useEffect } from 'react';
import { SpinnerIcon } from './Icons';

interface BorrowViewProps {
  orderId: string;
  onBorrow: (amountToBorrow: string) => void;
  // Pass the calculation function down as a prop
  calculateBorrowAmount: () => Promise<{ amount: string, price: string } | null>;
}

const BorrowView: React.FC<BorrowViewProps> = ({ orderId: _orderId, onBorrow, calculateBorrowAmount }) => {
  const [isCalculating, setIsCalculating] = useState(true);
  const [calculatedAmount, setCalculatedAmount] = useState<string | null>(null);
  const [ethPrice, setEthPrice] = useState<string | null>(null);

  // Trigger the calculation when the component first loads
  useEffect(() => {
    const performCalculation = async () => {
      setIsCalculating(true);
      const result = await calculateBorrowAmount();
      if (result) {
        setCalculatedAmount(result.amount);
        setEthPrice(result.price);
      }
      // If result is null, an error was already logged in context
      setIsCalculating(false);
    };
    performCalculation();
  }, [calculateBorrowAmount]); // Dependency on the function prop

  const handleBorrowClick = () => {
    if (calculatedAmount) {
      onBorrow(calculatedAmount);
    }
  };

  const isZero = calculatedAmount === '0' || calculatedAmount === '0.0' || calculatedAmount === '0.00';

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
              <span>Max Borrow Amount (remaining)</span>
              <span>Based on ETH Price: ${ethPrice ?? '...'}</span>
            </div>
            <div className="text-lg font-mono text-cyan-400">
              {calculatedAmount ?? 'Calculation Failed'} hUSD
            </div>
            {isZero && (
              <div className="mt-2 text-xs text-yellow-300">
                Already at your safe borrow limit.
              </div>
            )}
          </div>

          <button
            onClick={handleBorrowClick}
            disabled={!calculatedAmount || isZero}
            className="w-full bg-cyan-600 hover:bg-cyan-700 font-bold py-3 px-4 rounded-lg disabled:opacity-50"
          >
            Borrow {calculatedAmount || ''} hUSD
          </button>
        </>
      )}
    </div>
  );
};

export default BorrowView;
