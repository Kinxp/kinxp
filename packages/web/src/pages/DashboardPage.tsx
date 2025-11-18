import React, { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { fetchAllUserOrders } from '../services/blockscoutService';
import { UserOrderSummary } from '../types';
import { useAppContext } from '../context/AppContext';
import { config as wagmiConfig } from '../wagmi';
import { ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR } from '../config';

import OrderActionList from '../components/dashboard/OrderActionList';
import ActionPanel from '../components/ActionPanel';
import HomePage from '../components/DashboardPageModal';
import OrderInfoList from '../components/dashboard/OrderInfoList';
import CreateOrderView, { CollateralOrderDebugInfo } from '../components/dashboard/CreateOrderView';
import OrderListSkeleton from '../components/dashboard/OrderListSkeleton';
import DemoDashboardView from '../components/dashboard/DemoDashboardView'; 

const COLLATERAL_KEY_FALLBACK = '__default_collateral__';

const getCollateralKey = (order: UserOrderSummary) =>
  (order.reserveId?.toLowerCase() ?? COLLATERAL_KEY_FALLBACK);

const isOrderEffectivelyClosed = (order: UserOrderSummary) => {
  if (order.status === 'Liquidated' || order.status === 'Withdrawn') return true;
  if (order.status === 'ReadyToWithdraw') {
    return (order.unlockedWei ?? 0n) === 0n;
  }
  return false;
};

const formatTokenAmount = (value?: bigint, decimals = 18, maxDecimals = 4) => {
  if (value === undefined || value === null) return '0';
  const raw = formatUnits(value, decimals);
  if (!raw.includes('.')) return raw;
  const [whole, fraction = ''] = raw.split('.');
  if (maxDecimals <= 0) return whole;
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
};

const formatEthAmount = (value?: bigint) => formatTokenAmount(value, 18, 5);
const formatUsdAmount = (value?: bigint) => formatTokenAmount(value, 6, 2);

const DashboardPage = () => {
  const { isConnected, address } = useAccount();
  const { selectedOrderId, setSelectedOrderId, appState, borrowedOrders, handleCreateOrder, ordersRefreshVersion } = useAppContext();

  const [allOrders, setAllOrders] = useState<UserOrderSummary[]>([]);
  const [defaultReserveId, setDefaultReserveId] = useState<`0x${string}` | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start in loading state
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadDefaultReserveId = async () => {
      try {
        const value = await readContract(wagmiConfig, {
          address: ETH_COLLATERAL_OAPP_ADDR,
          abi: ETH_COLLATERAL_ABI,
          functionName: 'defaultReserveId',
          chainId: ETH_CHAIN_ID,
        }) as `0x${string}`;
        if (!cancelled && value) {
          setDefaultReserveId(value.toLowerCase() as `0x${string}`);
        }
      } catch (err) {
        console.warn('Failed to fetch default reserve id', err);
      }
    };
    loadDefaultReserveId();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setIsLoading(false); // Stop loading if not connected
      setAllOrders([]);
    }
  }, [isConnected, address, appState, ordersRefreshVersion]);

  const decoratedOrders = useMemo(() => {
    return allOrders.map(order => {
      if (order.borrowedUsd && order.borrowedUsd > 0n) return order;
      const cacheEntry = borrowedOrders[order.orderId.toLowerCase()];
      if (cacheEntry && order.status === 'Funded') {
        try {
          return { ...order, status: 'Borrowed' as const, borrowedUsd: parseUnits(cacheEntry.amount, 6) };
        } catch {
          return { ...order, status: 'Borrowed' as const };
        }
      }
      return order;
    });
  }, [allOrders, borrowedOrders]);

  const activeOrdersByCollateral = useMemo(() => {
    return decoratedOrders.reduce<Record<string, UserOrderSummary[]>>((acc, order) => {
      if (isOrderEffectivelyClosed(order)) return acc;
      const key = getCollateralKey(order);
      if (!acc[key]) acc[key] = [];
      acc[key].push(order);
      return acc;
    }, {});
  }, [decoratedOrders]);

  const creationKeyCandidates = useMemo(() => {
    if (defaultReserveId) return [defaultReserveId.toLowerCase()];
    const keys = new Set<string>([COLLATERAL_KEY_FALLBACK]);
    Object.keys(activeOrdersByCollateral).forEach((key) => keys.add(key));
    return Array.from(keys);
  }, [defaultReserveId, activeOrdersByCollateral]);

  const activeOrdersForCreation = useMemo(() => {
    const seen = new Set<string>();
    const collected: UserOrderSummary[] = [];
    creationKeyCandidates.forEach((key) => {
      const bucket = activeOrdersByCollateral[key] ?? [];
      bucket.forEach((order) => {
        const normalized = order.orderId.toLowerCase();
        if (seen.has(normalized)) return;
        seen.add(normalized);
        collected.push(order);
      });
    });
    return collected;
  }, [creationKeyCandidates, activeOrdersByCollateral]);

  const maxOrdersPerCollateral = 1;
  const creationLimitReached = activeOrdersForCreation.length >= maxOrdersPerCollateral;
  const lockedOrder = activeOrdersForCreation[0];
  const collateralLabel = 'Ethereum collateral';

  const creationLimitReason = creationLimitReached && lockedOrder
    ? `Order ${lockedOrder.orderId.slice(0, 12)}… is currently ${lockedOrder.status}. Use that position to add more collateral, borrow, repay, or withdraw before opening another ${collateralLabel}.`
    : creationLimitReached
    ? `Only one ${collateralLabel} order can exist at a time. Manage your active position before creating a new one.`
    : null;

  const collateralDebugOrders: CollateralOrderDebugInfo[] = activeOrdersForCreation.map((order) => {
    const borrowedUsdAmount = order.borrowedUsd ?? 0n;
    const shouldShowBorrowed = order.status === 'Borrowed' && borrowedUsdAmount > 0n;
    return {
      orderId: order.orderId,
      status: order.status,
      collateralEth: formatEthAmount(order.amountWei),
      borrowedUsd: shouldShowBorrowed ? formatUsdAmount(borrowedUsdAmount) : null,
      unlockedEth: order.unlockedWei && order.unlockedWei > 0n ? formatEthAmount(order.unlockedWei) : null,
    };
  });

  const { fundableOrders, activeOrders, withdrawableOrders, closedOrders } = useMemo(() => {
    const fundable = decoratedOrders.filter(o => o.status === 'Created');
    const active = decoratedOrders.filter(o => o.status === 'Funded' || o.status === 'Borrowed');
    const withdrawable = decoratedOrders.filter(o => o.status === 'ReadyToWithdraw' && (o.unlockedWei ?? 0n) > 0n);
    const closed = decoratedOrders.filter(o =>
      o.status === 'Liquidated' ||
      o.status === 'Withdrawn' ||
      (o.status === 'ReadyToWithdraw' && (o.unlockedWei ?? 0n) === 0n)
    );

    return {
      fundableOrders: fundable,
      activeOrders: active,
      withdrawableOrders: withdrawable,
      closedOrders: closed
    };
  }, [decoratedOrders]);

  const handleCreateClick = (amount: string) => {
    if (creationLimitReached) return;
    handleCreateOrder(amount);
  };

  const handleSelectOrder = (orderId: `0x${string}`) => {
    setSelectedOrderId(selectedOrderId === orderId ? null : orderId);
  };

  const handleManageLockedOrder = (orderId: `0x${string}`) => {
    setSelectedOrderId(orderId);
  };
  
  return (
    <div className="relative">
      {isConnected ? (
        // --- LIVE VIEW (for connected users) ---
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-2xl p-6">
              <CreateOrderView
                onSubmit={handleCreateClick}
                isBlocked={creationLimitReached}
                blockedReason={creationLimitReason}
                activeOrders={collateralDebugOrders}
                onInspectOrder={handleManageLockedOrder}
                collateralLabel={collateralLabel}
              />
            </div>
            <div className="bg-gray-800 rounded-2xl p-6">
              <ActionPanel allOrders={decoratedOrders} />
            </div>
          </div>
          <div className="space-y-6">
            {isLoading ? (
              <><OrderListSkeleton /><OrderListSkeleton /></>
            ) : error ? (
              <div className="text-center text-red-400 p-4">{error}</div>
            ) : (
              <>
                <OrderActionList title="Ready to Fund" orders={fundableOrders} selectedOrderId={selectedOrderId} onSelectOrder={handleSelectOrder} />
                <OrderActionList title="Active Orders" orders={activeOrders} selectedOrderId={selectedOrderId} onSelectOrder={handleSelectOrder} />
                <OrderActionList title="Ready to Withdraw" orders={withdrawableOrders} selectedOrderId={selectedOrderId} onSelectOrder={handleSelectOrder} />
                <OrderInfoList title="Closed Orders" orders={closedOrders} />
                {!isLoading && allOrders.length === 0 && (
                  <div className="text-center text-gray-500 p-4 bg-gray-800/50 rounded-lg">No orders found.</div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="blur-[2px]">
            <DemoDashboardView />
          </div>
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <HomePage />
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
