import React from 'react';

interface WithdrawViewProps {
  orderId: string;
  onWithdraw: () => void;
}

const WithdrawView: React.FC<WithdrawViewProps> = ({ orderId, onWithdraw }) => {
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Withdraw Your Collateral</h3>
      <p className="text-gray-400">Your repayment has been confirmed on Ethereum. You can now withdraw your original ETH.</p>

      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm">
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
      </div>

      <button onClick={onWithdraw} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg">
        Withdraw ETH
      </button>
    </div>
  );
};

export default WithdrawView;
