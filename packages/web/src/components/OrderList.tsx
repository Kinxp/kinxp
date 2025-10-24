import React from 'react';
import { formatUnits } from 'viem';
import { OrderStatus, UserOrderSummary } from '../types';

interface OrderListProps {
  orders: UserOrderSummary[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const statusStyles: Record<OrderStatus, string> = {
  Created: 'bg-gray-700/40 text-gray-200 border-gray-600/60',
  Funded: 'bg-blue-600/20 text-blue-300 border-blue-500/30',
  ReadyToWithdraw: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Withdrawn: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30',
  Liquidated: 'bg-red-700/20 text-red-300 border-red-500/40',
};

function formatEth(amountWei: bigint): string {
  if (amountWei === 0n) return '0';
  const eth = parseFloat(formatUnits(amountWei, 18));
  if (Number.isNaN(eth)) return '0';
  if (eth >= 1) return eth.toFixed(4).replace(/\.?0+$/, '');
  return eth.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function shorten(id: string, chars = 6): string {
  if (id.length <= chars * 2) return id;
  return `${id.slice(0, chars + 2)}…${id.slice(-chars)}`;
}

const OrderList: React.FC<OrderListProps> = ({ orders, isLoading, error, onRefresh }) => {
  return (
    <section className="bg-gray-800/70 border border-gray-700/50 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">Your Orders</h3>
        <button
          onClick={onRefresh}
          className="text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {orders.length === 0 && !isLoading ? (
        <p className="text-sm text-gray-400">
          No orders found for this wallet yet. Open a position to see it listed here.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div
              key={order.orderId}
              className="bg-gray-900/60 border border-gray-700/40 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Order ID</p>
                <p className="font-mono text-sm text-gray-200">{shorten(order.orderId)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Collateral</p>
                <p className="text-sm text-gray-100">{formatEth(order.amountWei)} ETH</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
                <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full border ${statusStyles[order.status]}`}>
                  {order.status.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default OrderList;
