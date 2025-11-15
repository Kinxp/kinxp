import React, { useState } from 'react';
import { parseEther, formatEther } from 'viem';
import { SpinnerIcon } from '../../Icons';

interface AddCollateralViewProps {
  orderId: string;
  currentCollateralWei: bigint;
  onAddCollateral: (amountEth: string) => void;
  isProcessing?: boolean;
}

const AddCollateralView: React.FC<AddCollateralViewProps> = ({
  orderId,
  currentCollateralWei,
  onAddCollateral,
  isProcessing = false,
}) => {
  const [amount, setAmount] = useState('');
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null);

  const currentCollateralEth = formatEther(currentCollateralWei);
  const totalAfterAdd = amount 
    ? (parseFloat(currentCollateralEth) + parseFloat(amount)).toFixed(6)
    : currentCollateralEth;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and a single decimal point
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      // In a real implementation, you would call a contract method to estimate the fee
      // For now, we'll use a mock value
      setEstimatedFee('0.0001');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount && parseFloat(amount) > 0) {
      onAddCollateral(amount);
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="text-xl font-bold text-gray-100">Add Collateral</h3>
        <p className="text-sm text-gray-400 mt-1">
          Increase your collateral to improve your loan-to-value ratio and reduce liquidation risk.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-gray-900/50 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Current Collateral</span>
            <span className="text-lg font-mono text-gray-200">{currentCollateralEth} ETH</span>
          </div>
          
          <div className="space-y-2">
            <label htmlFor="collateral-amount" className="block text-sm font-medium text-gray-300">
              Additional ETH Amount
            </label>
            <input
              id="collateral-amount"
              type="text"
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.0"
              disabled={isProcessing}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
            />
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div className="pt-3 border-t border-gray-700/50 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">New Total Collateral</span>
                <span className="font-mono text-cyan-400">{totalAfterAdd} ETH</span>
              </div>
              {estimatedFee && (
                <div className="flex justify-between items-center text-xs text-gray-500">
                  <span>Estimated LayerZero Fee</span>
                  <span className="font-mono">~{estimatedFee} ETH</span>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!amount || parseFloat(amount) <= 0 || isProcessing}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <SpinnerIcon /> Processing...
            </>
          ) : (
            'Add Collateral'
          )}
        </button>
      </form>

      <p className="text-xs text-gray-500 text-center">
        Adding collateral will notify Hedera via LayerZero. This may take a few minutes to confirm.
      </p>
    </div>
  );
};

export default AddCollateralView;
