import React, { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { parseUnits } from 'viem';
import { fetchAllUserOrders } from '../services/blockscoutService';
import { UserOrderSummary } from '../types';
import { useAppContext } from '../context/AppContext';

import OrderActionList from '../components/OrderActionList';
import ActionPanel from '../components/ActionPanel';
import HomePage from '../components/HomePage';
import OrderInfoList from '../components/OrderInfoList';
import CreateOrderView from '../components/CreateOrderView';

const DashboardPage = () => {
  const { isConnected, address } = useAccount();
  const { selectedOrderId, setSelectedOrderId, appState, borrowedOrders, handleCreateOrder } = useAppContext();

  const [allOrders, setAllOrders] = useState<UserOrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refreshOrders = async () => {
      if (!address) return;

      setIsLoading(true);
      setError(null);
      try {
        const orders = await fetchAllUserOrders(address);
        setAllOrders(orders);
      } catch (err) {
        console.error("Failed to fetch orders:", err);
        setError("Could not load order history.");
      } finally {
        setIsLoading(false);
      }
    };

    if (isConnected && address) {
      refreshOrders();
    } else {
      setAllOrders([]);
    }
  }, [isConnected, address, appState]);

  const decoratedOrders = useMemo(() => {
    return allOrders.map(order => {
      // Prefer on-chain Hedera truth when present
      if (order.borrowedUsd && order.borrowedUsd > 0n) return order;

      // Fallback: local cache, only if ETH-side says "Funded"
      const cacheEntry = borrowedOrders[order.orderId.toLowerCase()];
      if (cacheEntry && order.status === 'Funded') {
        try {
          return {
            ...order,
            status: 'Borrowed' as const,
            borrowedUsd: parseUnits(cacheEntry.amount, 6),
          };
        } catch {
          return { ...order, status: 'Borrowed' as const };
        }
      }
      return order;
    });
  }, [allOrders, borrowedOrders]);

  const { fundableOrders, activeOrders, withdrawableOrders, closedOrders } = useMemo(() => {
    const fundable = decoratedOrders.filter(o => o.status === 'Created');
    const active = decoratedOrders.filter(o => o.status === 'Funded' || o.status === 'Borrowed');
    const withdrawable = decoratedOrders.filter(o => o.status === 'ReadyToWithdraw');
    const closed = decoratedOrders.filter(o => o.status === 'Liquidated' || o.status === 'Withdrawn');

    return {
      fundableOrders: fundable,
      activeOrders: active,
      withdrawableOrders: withdrawable,
      closedOrders: closed
    };
  }, [decoratedOrders]);

  const handleSelectOrder = (orderId: `0x${string}`) => {
    setSelectedOrderId(prev => (prev === orderId ? null : orderId));
  };

  if (!isConnected) {
    return <HomePage />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* LEFT: Create Order always on top + dynamic action panel below */}
      <div className="space-y-6">
        <div className="bg-gray-800 rounded-2xl p-6">
          <CreateOrderView onSubmit={handleCreateOrder} />
        </div>

        <div className="bg-gray-800 rounded-2xl p-6">
          <ActionPanel allOrders={decoratedOrders} />
        </div>
      </div>

      {/* RIGHT: Lists */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center text-gray-400 p-4">Loading your orders...</div>
        ) : error ? (
          <div className="text-center text-red-400 p-4">{error}</div>
        ) : (
          <>
            <OrderActionList
              title="Ready to Fund on Sepolia"
              orders={fundableOrders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={handleSelectOrder}
            />
            <OrderActionList
              title="Active Orders"
              orders={activeOrders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={handleSelectOrder}
            />
            <OrderActionList
              title="Ready to Withdraw on Sepolia"
              orders={withdrawableOrders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={handleSelectOrder}
            />
            <OrderInfoList
              title="Closed Orders"
              orders={closedOrders}
            />
            {!isLoading && allOrders.length === 0 && (
              <div className="text-center text-gray-500 p-4 bg-gray-800/50 rounded-lg">
                No orders found for your address. Create a new order to begin.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
