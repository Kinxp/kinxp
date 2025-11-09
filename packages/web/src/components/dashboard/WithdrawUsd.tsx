import React from 'react';
import { OrderData } from '../../App';
import { CheckIcon, CopyIcon } from '../Icons';

interface WithdrawUsdProps {
  orderData: OrderData;
  onWithdraw: () => void;
}

const WithdrawUsd: React.FC<WithdrawUsdProps> = ({ orderData, onWithdraw }) => {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-green-400 pl-3">Step 3: Withdraw USD on Hedera</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-4">
         {/* ... (rest of the JSX is the same) ... */}
         <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-500/20">
            <CheckIcon />
          </div>
          <h3 className="mt-2 text-lg font-bold">ETH Deposit Confirmed!</h3>
          <p className="text-sm text-gray-400">Your Hedera withdrawal order is now ready.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Hedera Order ID</label>
          <div className="mt-1 flex items-center bg-gray-900 border border-gray-600 rounded-md p-3">
            <span className="font-mono text-gray-300 flex-grow">{orderData.hederaOrderId}</span>
            <CopyIcon />
          </div>
        </div>
        <button onClick={onWithdraw} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg">
          Withdraw ${orderData.usdValue} H-USD
        </button>
      </div>
    </div>
  );
};

export default WithdrawUsd;