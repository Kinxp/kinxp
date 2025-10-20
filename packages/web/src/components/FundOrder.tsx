import React, { useState } from 'react';
import { OrderData } from '../App'; // Import the shared type
import { CopyIcon, SpinnerIcon } from './Icons';

interface FundOrderProps {
  orderData: OrderData;
  onPaymentVerified: () => void;
}

const FundOrder: React.FC<FundOrderProps> = ({ orderData, onPaymentVerified }) => {
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const handleVerify = () => {
    setIsVerifying(true);
    setTimeout(() => {
      onPaymentVerified();
    }, 2500);
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-yellow-400 pl-3">Step 2: Fund Your Order</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-4">
        {/* ... (rest of the JSX is the same) ... */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">Your Order is Created</h3>
          <span className="bg-yellow-500/20 text-yellow-300 text-xs font-medium px-2.5 py-1 rounded-full">Pending Payment</span>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Your unique Order ID</label>
          <div className="mt-1 flex items-center bg-gray-900 border border-gray-600 rounded-md p-3">
            <span className="font-mono text-gray-300 flex-grow">{orderData.ethOrderId}</span>
            <CopyIcon />
          </div>
        </div>
        <div className="text-sm text-gray-300">
          <p>To proceed, send exactly <strong className="text-white">{orderData.ethAmount} ETH</strong> to the smart contract.</p>
        </div>
        <button onClick={handleVerify} disabled={isVerifying} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
          {isVerifying ? (<><SpinnerIcon /> Verifying Payment...</>) : ('I Have Paid, Verify Now')}
        </button>
      </div>
    </div>
  );
};

export default FundOrder;