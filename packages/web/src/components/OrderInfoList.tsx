import React from 'react';
import { UserOrderSummary } from '../types';
import { formatUnits } from 'viem';

interface OrderInfoListProps {
  title: string;
  orders: UserOrderSummary[];
}

// Helper functions can be shared or kept here
function formatEth(amountWei: bigint) {
  if (!amountWei) return '0';
  const eth = parseFloat(formatUnits(amountWei, 18));
  return eth >= 1 ? eth.toFixed(4) : eth.toFixed(6);
}

function shorten(id: string) {
  if (!id) return '';
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}

const OrderInfoList: React.FC<OrderInfoListProps> = ({ title, orders }) => {
  if (orders.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <h3 className="text-md font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="space-y-2">
        {orders.map(order => (
          <div
            key={order.orderId}
            className="bg-gray-900/70 border border-gray-700/60 rounded-lg p-3 flex items-center justify-between"
          >
            <div>
              <p className="font-mono text-sm text-gray-400">{shorten(order.orderId)}</p>
              <p className="text-xs text-gray-500">{formatEth(order.amountWei)} ETH</p>
            </div>
            {/* No action button, just displays the final status */}
            <span className="text-xs font-medium text-red-300 bg-red-500/10 px-3 py-1 rounded-full">
              {order.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderInfoList;