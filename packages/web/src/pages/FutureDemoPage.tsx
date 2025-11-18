import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { fetchAllUserOrders } from '../services/blockscoutService';
import {
  RESERVE_REGISTRY_ABI,
  RESERVE_REGISTRY_ADDR,
  HEDERA_CHAIN_ID,
  ETH_CHAIN_ID,
  ETH_COLLATERAL_ABI,
  ETH_COLLATERAL_OAPP_ADDR,
} from '../config';
import { AppState, ReserveInfo, UserOrderSummary } from '../types';
import { useAppContext } from '../context/AppContext';
import ReserveBadge from '../components/demo/ReserveBadge';
import ReserveInfoPanel from '../components/demo/ReserveInfoPanel';
import AddCollateralView from '../components/demo/AddCollateralView';
import EnhancedWithdrawView from '../components/demo/EnhancedWithdrawView';
import BorrowView from '../components/actionpanel/manageorder/BorrowView';
import RepayView from '../components/actionpanel/manageorder/RepayView';
import CreateOrderView from '../components/dashboard/CreateOrderView';
import FundOrderView from '../components/actionpanel/FundOrderView';

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

type DecoratedOrder = UserOrderSummary & {
  reserve?: ReserveInfo;
};

const PROCESSING_STATES = new Set<AppState>([
  AppState.ORDER_CREATING,
  AppState.FUNDING_IN_PROGRESS,
  AppState.CROSSING_TO_HEDERA,
  AppState.BORROWING_IN_PROGRESS,
  AppState.RETURNING_FUNDS,
  AppState.REPAYING_IN_PROGRESS,
  AppState.CROSSING_TO_ETHEREUM,
  AppState.WITHDRAWING_IN_PROGRESS,
]);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FutureDemoPage: React.FC = () => {
  const { address } = useAccount();
  const {
    handleCreateOrder,
    handleFundOrder,
    handleBorrow,
    handleAddCollateral,
    handleRepay,
    handleWithdraw,
    calculateBorrowAmount,
    selectedOrderId,
    setSelectedOrderId,
    appState,
    ethAmount,
    lzTxHash,
    startPollingForHederaOrder,
    ordersRefreshVersion,
  } = useAppContext();

  const [activeTab, setActiveTab] = useState<'orders' | 'create'>('orders');
  const [orders, setOrders] = useState<UserOrderSummary[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [reserves, setReserves] = useState<Record<string, ReserveInfo>>({});
  const [defaultReserveId, setDefaultReserveId] = useState<`0x${string}` | null>(null);
  const [isLoadingReserves, setIsLoadingReserves] = useState(false);
  const fetchedReserveIdsRef = useRef<Set<string>>(new Set());

  const isProcessing = PROCESSING_STATES.has(appState);

  const storeReserve = useCallback((reserve: ReserveInfo) => {
    setReserves(prev => ({ ...prev, [reserve.reserveId.toLowerCase()]: reserve }));
  }, []);

  const fetchReserveConfig = useCallback(
    async (reserveId: `0x${string}` | undefined) => {
      if (!reserveId || reserveId === ZERO_BYTES32) return;
      const key = reserveId.toLowerCase();
      if (fetchedReserveIdsRef.current.has(key)) return;
      fetchedReserveIdsRef.current.add(key);

      setIsLoadingReserves(true);
      try {
        const bundle = await readContract(wagmiConfig, {
          address: RESERVE_REGISTRY_ADDR,
          abi: RESERVE_REGISTRY_ABI,
          functionName: 'getReserveConfig',
          args: [reserveId],
          chainId: HEDERA_CHAIN_ID,
        }) as readonly [
          {
            reserveId: `0x${string}`;
            label: string;
            controller: `0x${string}`;
            protocolTreasury: `0x${string}`;
            debtTokenDecimals: number;
            active: boolean;
            frozen: boolean;
          },
          {
            maxLtvBps: number;
            liquidationThresholdBps: number;
            liquidationBonusBps: number;
            closeFactorBps: number;
            reserveFactorBps: number;
            liquidationProtocolFeeBps: number;
          },
          {
            baseRateBps: number;
            slope1Bps: number;
            slope2Bps: number;
            optimalUtilizationBps: number;
            originationFeeBps: number;
          },
          unknown
        ];

        const [metadata, risk, interest] = bundle;

        const reserve: ReserveInfo = {
          reserveId,
          label: metadata.label,
          maxLtvBps: Number(risk.maxLtvBps),
          liquidationThresholdBps: Number(risk.liquidationThresholdBps),
          baseRateBps: Number(interest.baseRateBps),
          originationFeeBps: Number(interest.originationFeeBps),
          controller: metadata.controller,
          active: Boolean(metadata.active) && !Boolean(metadata.frozen),
        };

        storeReserve(reserve);
      } catch (error) {
        console.error(`Failed to fetch reserve config for ${reserveId}`, error);
      } finally {
        setIsLoadingReserves(false);
      }
    },
    [storeReserve]
  );

  const loadDefaultReserve = useCallback(async () => {
    let reserveId: `0x${string}` | null = null;

    try {
      const registryReserveId = await readContract(wagmiConfig, {
        address: RESERVE_REGISTRY_ADDR,
        abi: RESERVE_REGISTRY_ABI,
        functionName: 'defaultReserveId',
        chainId: HEDERA_CHAIN_ID,
      }) as `0x${string}`;

      if (registryReserveId && registryReserveId !== ZERO_BYTES32) {
        reserveId = registryReserveId;
      }
    } catch (error) {
      console.warn('Could not load default reserve from registry', error);
    }

    if (!reserveId) {
      try {
        const fallbackReserveId = await readContract(wagmiConfig, {
          address: ETH_COLLATERAL_OAPP_ADDR,
          abi: ETH_COLLATERAL_ABI,
          functionName: 'defaultReserveId',
          chainId: ETH_CHAIN_ID,
        }) as `0x${string}`;

        if (fallbackReserveId && fallbackReserveId !== ZERO_BYTES32) {
          reserveId = fallbackReserveId;
        }
      } catch (fallbackError) {
        console.warn('Could not load default reserve from Ethereum fallback', fallbackError);
      }
    }

    if (reserveId) {
      setDefaultReserveId(reserveId);
      await fetchReserveConfig(reserveId);
    }
  }, [fetchReserveConfig]);

  useEffect(() => {
    loadDefaultReserve();
  }, [loadDefaultReserve]);

  const loadOrders = useCallback(async () => {
    if (!address) {
      setOrders([]);
      setSelectedOrderId(null);
      return;
    }

    setIsLoadingOrders(true);
    try {
      const userOrders = await fetchAllUserOrders(address);
      setOrders(userOrders);

      if (userOrders.length > 0) {
        const alreadySelected = userOrders.some(order => order.orderId === selectedOrderId);
        if (!alreadySelected) {
          setSelectedOrderId(userOrders[0].orderId);
        }
      }
    } catch (error) {
      console.error('Failed to fetch user orders for Future Demo page:', error);
    } finally {
      setIsLoadingOrders(false);
    }
  }, [address, selectedOrderId, setSelectedOrderId, ordersRefreshVersion]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!address) return;
    if (!PROCESSING_STATES.has(appState)) {
      loadOrders();
    }
  }, [address, appState, loadOrders]);

  useEffect(() => {
    orders.forEach(order => {
      if (order.reserveId) {
        fetchReserveConfig(order.reserveId);
      }
    });
  }, [orders, fetchReserveConfig]);

  const decoratedOrders: DecoratedOrder[] = useMemo(() => {
    return orders.map(order => {
      const reserve = order.reserveId ? reserves[order.reserveId.toLowerCase()] : undefined;
      return { ...order, reserve };
    });
  }, [orders, reserves]);

  const selectedOrder = useMemo(() => {
    return selectedOrderId ? decoratedOrders.find(order => order.orderId === selectedOrderId) || null : null;
  }, [decoratedOrders, selectedOrderId]);

  const defaultReserve = useMemo(() => {
    if (defaultReserveId) {
      const stored = reserves[defaultReserveId.toLowerCase()];
      if (stored) return stored;
    }
    const firstReserve = Object.values(reserves)[0];
    return firstReserve ?? null;
  }, [defaultReserveId, reserves]);

  const selectedReserve = useMemo(() => {
    return selectedOrder?.reserve ?? defaultReserve ?? null;
  }, [selectedOrder, defaultReserve]);

  const { activeOrders, withdrawableOrders, fundableOrders } = useMemo(() => {
    return {
      activeOrders: decoratedOrders.filter(order => order.status === 'Borrowed' || order.status === 'Funded'),
      withdrawableOrders: decoratedOrders.filter(order => order.status === 'ReadyToWithdraw' && (order.unlockedWei ?? 0n) > 0n),
      fundableOrders: decoratedOrders.filter(order => order.status === 'Created'),
    };
  }, [decoratedOrders]);

  const handleAddCollateralSafe = useCallback(
    async (amountEth: string) => {
      if (!amountEth) return;
      try {
        await handleAddCollateral(amountEth);
      } catch (error) {
        console.error('Failed to add collateral from demo page', error);
      }
    },
    [handleAddCollateral]
  );

  const handleBorrowSafe = useCallback(
    async (amount: string) => {
      if (!amount) return;
      try {
        await handleBorrow(amount);
      } catch (error) {
        console.error('Failed to borrow from demo page', error);
      }
    },
    [handleBorrow]
  );

  const handleFundOrderSafe = useCallback(
    (amount: string) => {
      if (!amount || Number(amount) <= 0) return;
      handleFundOrder(amount);
    },
    [handleFundOrder]
  );

  const borrowAmountForOrder = useMemo(() => {
    if (!selectedOrder) return '0';
    if (selectedOrder.outstandingDebt !== undefined && selectedOrder.outstandingDebt > 0n) {
      return formatUnits(selectedOrder.outstandingDebt, 6);
    }
    if (selectedOrder.borrowedUsd !== undefined && selectedOrder.borrowedUsd > 0n) {
      return formatUnits(selectedOrder.borrowedUsd, 6);
    }
    return '0';
  }, [selectedOrder]);

  const fundAmountForOrder = useMemo(() => {
    if (!selectedOrder) return ethAmount;
    const fromContract = formatUnits(selectedOrder.amountWei ?? 0n, 18);
    if (Number(fromContract) > 0) {
      return fromContract;
    }
    return ethAmount;
  }, [selectedOrder, ethAmount]);

  const handleBorrowSubmit = useCallback(
    (amount: string) => {
      void handleBorrowSafe(amount);
    },
    [handleBorrowSafe],
  );

  const handleAddCollateralSubmit = useCallback(
    (amount: string) => {
      void handleAddCollateralSafe(amount);
    },
    [handleAddCollateralSafe],
  );

  const handleRepayClick = useCallback(() => {
    void handleRepay();
  }, [handleRepay]);

  const handleWithdrawClick = useCallback(() => {
    handleWithdraw();
  }, [handleWithdraw]);

  const handleManualLayerZeroCheck = useCallback(() => {
    if (!selectedOrder) return;
    startPollingForHederaOrder(selectedOrder.orderId, lzTxHash ?? undefined);
  }, [selectedOrder, startPollingForHederaOrder, lzTxHash]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-600/20 to-cyan-600/20 border border-indigo-500/30 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100 mb-2">Future Demo - Enhanced Features</h1>
            <p className="text-sm text-gray-400">
              Preview of the enhanced UI with reserve system, partial withdrawals, and collateral management.
              <span className="ml-2 text-cyan-300">Live data sourced from the deployed contracts.</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'orders'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'create'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Create
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Order Management */}
        <div className="space-y-6">
          {activeTab === 'create' ? (
            <div className="bg-gray-800 rounded-2xl p-6">
              <CreateOrderView onSubmit={handleCreateOrder} />
            </div>
          ) : (
            <>
              {selectedOrder && selectedReserve && (
                <ReserveInfoPanel reserve={selectedReserve} />
              )}

              {!selectedOrder && (isLoadingOrders || isLoadingReserves) && (
                <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400 animate-pulse">
                  {address ? 'Loading your orders...' : 'Connect your wallet to load orders.'}
                </div>
              )}

              {/* Action Panel based on order status */}
              {selectedOrder && (
                <div className="bg-gray-800 rounded-2xl p-6">
                  {selectedOrder.status === 'Funded' && (
                    selectedOrder.hederaReady ? (
                      <BorrowView
                        orderId={selectedOrder.orderId}
                        onBorrow={handleBorrowSubmit}
                        calculateBorrowAmount={calculateBorrowAmount}
                      />
                    ) : (
                      <div className="bg-gray-900/60 border border-indigo-500/30 rounded-2xl p-6 text-center space-y-4">
                        <h3 className="text-xl font-bold text-indigo-200">Bridging in Progress</h3>
                        <p className="text-sm text-gray-400">
                          Your collateral has been funded on Ethereum and is now crossing to Hedera via LayerZero.
                          This usually takes a couple of minutes. Once confirmed, borrowing will unlock automatically.
                        </p>
                        <div className="flex flex-col items-center gap-2 text-gray-300">
                          <span className="animate-spin h-6 w-6 rounded-full border-2 border-indigo-400 border-t-transparent" />
                          <span className="text-xs text-gray-500">
                            Waiting for Hedera confirmation...
                          </span>
                        </div>
                        {lzTxHash && (
                          <a
                            href={`https://testnet.layerzeroscan.com/tx/${lzTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs font-mono text-cyan-400 hover:text-cyan-300 break-all"
                          >
                            View LayerZero tx: {lzTxHash}
                          </a>
                        )}
                        <button
                          onClick={handleManualLayerZeroCheck}
                          className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                        >
                          Re-check Hedera Status
                        </button>
                      </div>
                    )
                  )}

                  {selectedOrder.status === 'Created' && (
                    <FundOrderView
                      orderId={selectedOrder.orderId}
                      ethAmount={fundAmountForOrder ?? '0'}
                      onFund={handleFundOrderSafe}
                    />
                  )}

                  {selectedOrder.status === 'Borrowed' && (
                    <div className="space-y-4">
                      {/* Repay View */}
                      <RepayView
                        orderId={selectedOrder.orderId}
                        borrowAmount={borrowAmountForOrder}
                        collateralEth={formatUnits(selectedOrder.amountWei, 18)}
                        onRepay={handleRepayClick}
                      />

                      {/* Add Collateral View */}
                      <AddCollateralView
                        orderId={selectedOrder.orderId}
                        currentCollateralWei={selectedOrder.amountWei}
                        onAddCollateral={handleAddCollateralSubmit}
                        isProcessing={isProcessing}
                      />
                    </div>
                  )}

                  {selectedOrder.status === 'ReadyToWithdraw' && (
                    <EnhancedWithdrawView
                      orderId={selectedOrder.orderId}
                      totalCollateralWei={selectedOrder.amountWei}
                      unlockedWei={selectedOrder.unlockedWei ?? 0n}
                      onWithdraw={handleWithdrawClick}
                      isProcessing={isProcessing}
                    />
                  )}
                </div>
              )}

              {!selectedOrder && (
                <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400">
                  {!address
                    ? 'Connect your wallet to view and manage orders.'
                    : isLoadingOrders
                      ? 'Loading your orders...'
                      : orders.length === 0
                        ? 'No orders yet. Create one to get started.'
                        : 'Select an order from the right to manage it.'}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column: Order Lists */}
        <div className="space-y-6">
          {isLoadingOrders && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-gray-400 animate-pulse">
              Loading orders…
            </div>
          )}
          {/* Active Orders */}
          {activeOrders.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <h3 className="text-md font-semibold text-gray-300 mb-3">Active Orders</h3>
              <div className="space-y-3">
                {activeOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    reserve={order.reserve ?? defaultReserve ?? undefined}
                    isSelected={selectedOrderId === order.orderId}
                    onSelect={() => setSelectedOrderId(order.orderId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ready to Withdraw */}
          {withdrawableOrders.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <h3 className="text-md font-semibold text-gray-300 mb-3">Ready to Withdraw</h3>
              <div className="space-y-3">
                {withdrawableOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    reserve={order.reserve ?? defaultReserve ?? undefined}
                    isSelected={selectedOrderId === order.orderId}
                    onSelect={() => setSelectedOrderId(order.orderId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fundable Orders */}
          {fundableOrders.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <h3 className="text-md font-semibold text-gray-300 mb-3">Ready to Fund</h3>
              <div className="space-y-3">
                {fundableOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    reserve={order.reserve ?? defaultReserve ?? undefined}
                    isSelected={selectedOrderId === order.orderId}
                    onSelect={() => setSelectedOrderId(order.orderId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// ORDER CARD COMPONENT
// ============================================================================

interface OrderCardProps {
  order: DecoratedOrder;
  reserve?: ReserveInfo | null;
  isSelected: boolean;
  onSelect: () => void;
}

const OrderCard: React.FC<OrderCardProps> = ({ order, reserve, isSelected, onSelect }) => {
  const statusStyles: Record<string, string> = {
    Created: "bg-gray-700/40 text-gray-200 border-gray-600/60",
    Funded: "bg-blue-600/20 text-blue-300 border-blue-500/30",
    Borrowed: "bg-indigo-600/20 text-indigo-300 border-indigo-500/30",
    ReadyToWithdraw: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    Withdrawn: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
    Liquidated: "bg-red-700/20 text-red-300 border-red-500/40",
  };

  const amountWei = order.amountWei ?? 0n;
  const unlockedWei = order.unlockedWei ?? 0n;
  const totalEth = formatUnits(amountWei, 18);
  const unlockedEth = formatUnits(unlockedWei, 18);
  const borrowedUsd = order.outstandingDebt
    ? formatUnits(order.outstandingDebt, 6)
    : order.borrowedUsd
      ? formatUnits(order.borrowedUsd, 6)
      : '0';

  return (
    <div
      onClick={onSelect}
      className={`bg-gray-900/60 border rounded-xl px-4 py-3 space-y-3 cursor-pointer hover:bg-gray-900 transition-all ${
        isSelected 
          ? 'border-cyan-500 ring-2 ring-cyan-500/50' 
          : 'border-gray-700/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <p className="font-mono text-sm text-gray-200 truncate">
              {order.orderId.slice(0, 10)}...{order.orderId.slice(-8)}
            </p>
            <ReserveBadge reserveLabel={reserve?.label ?? 'Reserve'} maxLtvBps={reserve?.maxLtvBps} />
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Collateral:</span>
              <span className="text-gray-200 font-mono">{totalEth} ETH</span>
            </div>
            {unlockedWei > 0n && (
              <div className="flex justify-between">
                <span className="text-gray-400">Unlocked:</span>
                <span className="text-cyan-400 font-mono">{unlockedEth} ETH</span>
              </div>
            )}
            {order.borrowedUsd && order.borrowedUsd > 0n && (
              <div className="flex justify-between">
                <span className="text-gray-400">Debt:</span>
                <span className="text-gray-200 font-mono">
                  {borrowedUsd} hUSD
                  {order.outstandingDebt && order.outstandingDebt !== order.borrowedUsd && (
                    <span className="text-gray-500 ml-1">
                      (incl. interest)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full border ${
            statusStyles[order.status] || statusStyles.Created
          }`}>
            {order.status.replace(/([A-Z])/g, ' $1').trim()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FutureDemoPage;
