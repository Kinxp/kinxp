import React, { useState } from 'react';

interface CreateOrderViewProps { onSubmit: (amount: string) => void; }

const CreateOrderView: React.FC<CreateOrderViewProps> = ({ onSubmit }) => {
  const [amount, setAmount] = useState('0.001');
  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4">
      <h3 className="text-xl font-bold">Start Cross-Chain Loan</h3>
      <p className="text-gray-400">Enter the amount of Sepolia ETH to use as collateral.</p>
      <input 
        type="text" 
        value={amount} 
        onChange={(e) => setAmount(e.target.value)} 
        className="w-full bg-gray-900 border-gray-600 rounded-md p-3 text-center"
      />
    <button onClick={() => onSubmit(amount)} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg">
        Create Order
      </button>
    </div>
  );
};

export default CreateOrderView;