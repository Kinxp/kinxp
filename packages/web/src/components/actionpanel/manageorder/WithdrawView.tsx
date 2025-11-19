import React from 'react';
import { formatUnits } from 'viem';

interface WithdrawViewProps {
  orderId: string;
  onWithdraw: () => void;
  availableWei?: bigint;
}
const formatEth = (value?: bigint) => {
  const wei = value ?? 0n;
  return formatUnits(wei, 18);
};
const WithdrawView: React.FC<WithdrawViewProps> = ({ orderId, onWithdraw, availableWei }) => {
  const formattedAvailable = availableWei ? formatEth(availableWei) : '0';
  const disabled = !availableWei || availableWei === 0n;
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Withdraw Your Collateral</h3>
      <p className="text-gray-400">Your repayment has been confirmed on Ethereum. You can now withdraw your original ETH.</p>

      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm">
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
        <div className="mt-2">
          <span className="text-gray-500">Available to Withdraw:</span>
          <span className={`ml-2 font-semibold ${disabled ? 'text-gray-500' : 'text-white'}`}>
            {disabled ? '0 ETH' : `${formattedAvailable} ETH`}
          </span>
        </div>
      </div>

      <button
        onClick={onWithdraw}
        disabled={disabled}
        className={`w-full font-bold py-3 px-4 rounded-lg ${disabled ? 'bg-gray-600 text-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}`}
      >
        {disabled ? 'No ETH available' : 'Withdraw ETH'}
      </button>
    </div>
  );
};

export default WithdrawView;
