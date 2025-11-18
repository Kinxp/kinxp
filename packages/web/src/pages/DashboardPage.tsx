import React, { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { fetchAllUserOrders } from '../services/blockscoutService';
import { UserOrderSummary } from '../types';
import { useAppContext } from '../context/AppContext';

import ActionPanel from '../components/ActionPanel';
import HomePage from '../components/DashboardPageModal';
import CreateOrderView, { CollateralOrderDebugInfo } from '../components/dashboard/CreateOrderView';
import DemoDashboardView from '../components/dashboard/DemoDashboardView'; 

const isOrderEffectivelyClosed = (order: UserOrderSummary) =>
  order.status === 'Liquidated' || order.status === 'Withdrawn';

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
  const { selectedOrderId, setSelectedOrderId, appState, handleCreateOrder, ordersRefreshVersion } = useAppContext();

  const [allOrders, setAllOrders] = useState<UserOrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true); // Start in loading state
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
      setIsLoading(false); // Stop loading if not connected
      setAllOrders([]);
    }
  }, [isConnected, address, appState, ordersRefreshVersion]);

  const decoratedOrders = useMemo(() => allOrders, [allOrders]);

  const blockingOrders = useMemo(
    () => decoratedOrders.filter(order => !isOrderEffectivelyClosed(order)),
    [decoratedOrders]
  );

  const creationLimitReached = blockingOrders.length > 0;
  const lockedOrder = blockingOrders[0];
  const collateralLabel = 'Ethereum collateral';

  const creationLimitReason = creationLimitReached && lockedOrder
    ? `Position ${lockedOrder.orderId.slice(0, 12)}… is currently ${lockedOrder.status}. Use that position to add more collateral, borrow, repay, or withdraw before starting another ${collateralLabel} position.`
    : creationLimitReached
    ? `Only one ${collateralLabel} position can exist at a time. Manage your active position before attempting a new one.`
    : null;

  const collateralDebugOrders: CollateralOrderDebugInfo[] = blockingOrders.map((order) => {
    const borrowedUsdAmount = order.hederaBorrowedUsd ?? order.borrowedUsd ?? 0n;
    const hederaCollateralWei = order.hederaCollateralWei ?? order.amountWei;
    const shouldShowBorrowed = borrowedUsdAmount > 0n;
    return {
      orderId: order.orderId,
      status: order.status,
      collateralEth: formatEthAmount(order.amountWei),
      borrowedUsd: shouldShowBorrowed ? formatUsdAmount(borrowedUsdAmount) : null,
      unlockedEth: order.unlockedWei && order.unlockedWei > 0n ? formatEthAmount(order.unlockedWei) : null,
      hederaCollateralEth: hederaCollateralWei !== undefined ? formatEthAmount(hederaCollateralWei) : null,
      hederaBorrowedUsd: borrowedUsdAmount > 0n ? formatUsdAmount(borrowedUsdAmount) : null,
    };
  });

  const handleCreateClick = (amount: string) => {
    if (creationLimitReached) return;
    handleCreateOrder(amount);
  };

  useEffect(() => {
    if (creationLimitReached && lockedOrder && selectedOrderId !== lockedOrder.orderId) {
      setSelectedOrderId(lockedOrder.orderId);
    }
    if (!creationLimitReached && selectedOrderId) {
      setSelectedOrderId(null);
    }
  }, [creationLimitReached, lockedOrder, selectedOrderId, setSelectedOrderId]);
  
  if (!isConnected) {
    return (
      <div className="relative">
        <div className="blur-[2px]">
          <DemoDashboardView />
        </div>
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <HomePage />
        </div>
      </div>
    );
  }

  if (creationLimitReached && lockedOrder) {
    return (
      <div className="relative">
        <div className="space-y-6 animate-fade-in">
          <div className="bg-gray-800 rounded-2xl p-6">
            <div className="mb-4 space-y-2">
              <p className="text-sm font-semibold text-gray-100">Manage Position</p>
              <p className="text-xs text-gray-400">
                {creationLimitReason ?? 'Manage your active Ethereum collateral position below.'}
              </p>
            </div>
            <ActionPanel allOrders={decoratedOrders} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="space-y-6">
        <div className="bg-gray-800 rounded-2xl p-6">
          <CreateOrderView
            onSubmit={handleCreateClick}
            activeOrders={collateralDebugOrders}
            collateralLabel={collateralLabel}
          />
          {isLoading && (
            <p className="text-xs text-gray-500 mt-4">
              Loading chain data…
            </p>
          )}
          {error && (
            <p className="text-xs text-red-400 mt-2">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
