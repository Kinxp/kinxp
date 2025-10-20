import React, { useState } from 'react';

// Define the props this component expects
interface CreateOrderProps {
  onCreateOrder: (ethAmount: number) => void;
}

const CreateOrder: React.FC<CreateOrderProps> = ({ onCreateOrder }) => {
  const [ethAmount, setEthAmount] = useState<string>('');
  const estimatedUsd = ethAmount ? (parseFloat(ethAmount) * 3267.17).toFixed(2) : '0.00';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (ethAmount && parseFloat(ethAmount) > 0) {
      onCreateOrder(parseFloat(ethAmount));
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-cyan-400 pl-3">Step 1: Create New Exchange Order</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-4">
        {/* ... (rest of the JSX is the same as the JavaScript version) ... */}
        <h3 className="text-lg font-bold">Bridge ETH to USD on Hedera</h3>
        <p className="text-sm text-gray-400">Lock your Ethereum (ETH) to receive US Dollars (H-USD) on the Hedera network.</p>
        
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="eth-amount" className="block text-sm font-medium text-gray-300">Amount of ETH to lock</label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <input 
                type="number" 
                step="0.01"
                min="0"
                name="eth-amount" 
                id="eth-amount" 
                className="block w-full bg-gray-900 border-gray-600 rounded-md p-3 focus:ring-cyan-500 focus:border-cyan-500" 
                placeholder="1.5"
                value={ethAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEthAmount(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="text-gray-400 sm:text-sm">ETH</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 p-3 rounded-lg text-center mt-4">
            <p className="text-sm text-gray-400">You will be able to withdraw approx.</p>
            <p className="text-2xl font-bold text-cyan-400">${estimatedUsd} H-USD</p>
            <p className="text-xs text-gray-500">Based on current Pyth oracle price: 1 ETH = $3267.17</p>
          </div>
          
          <button type="submit" className="w-full mt-4 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg disabled:bg-gray-500 disabled:cursor-not-allowed" disabled={!ethAmount || parseFloat(ethAmount) <= 0}>
            Create Order on Ethereum
          </button>
        </form>
      </div>
    </div>
  );
}

export default CreateOrder;