// src/components/OrderActionList.tsx

import React from 'react';
import { UserOrderSummary } from '../types';
import { formatUnits } from 'viem';

interface OrderActionListProps {
  title: string;
  orders: UserOrderSummary[];
  selectedOrderId: `0x${string}` | null;
  onSelectOrder: (orderId: `0x${string}`) => void;
  actionText: string;
}

function formatEth(amountWei: bigint) {
  const eth = parseFloat(formatUnits(amountWei, 18));
  return eth >= 1 ? eth.toFixed(4) : eth.toFixed(6);
}

function shorten(id: string) {
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}

const OrderActionList: React.FC<OrderActionListProps> = ({ title, orders, selectedOrderId, onSelectOrder, actionText }) => {
  if (orders.length === 0) {
    return null; // Don't render the list if it's empty
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <h3 className="text-md font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="space-y-2">
        {orders.map(order => (
          <div
            key={order.orderId}
            className={`
              bg-gray-900/70 border rounded-lg p-3 flex items-center justify-between transition-all
              ${selectedOrderId === order.orderId 
                ? 'border-cyan-500 ring-2 ring-cyan-500/50' 
                : 'border-gray-700/60 hover:border-gray-500'}
            `}
          >
            <div>
              <p className="font-mono text-sm text-gray-200">{shorten(order.orderId)}</p>
              <p className="text-xs text-gray-400">{formatEth(order.amountWei)} ETH</p>
            </div>
            <button
              onClick={() => onSelectOrder(order.orderId)}
              className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-sm py-1.5 px-3 rounded-md"
            >
              {actionText}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderActionList;