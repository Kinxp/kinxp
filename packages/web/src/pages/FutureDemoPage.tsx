import React, { useState, useMemo } from 'react';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { MockOrderSummary, MockReserveInfo, MockReserveConfig } from '../types/demo';
import ReserveBadge from '../components/demo/ReserveBadge';
import ReserveInfoPanel from '../components/demo/ReserveInfoPanel';
import AddCollateralView from '../components/demo/AddCollateralView';
import EnhancedWithdrawView from '../components/demo/EnhancedWithdrawView';
import BorrowView from '../components/actionpanel/manageorder/BorrowView';
import RepayView from '../components/actionpanel/manageorder/RepayView';
import CreateOrderView from '../components/dashboard/CreateOrderView';

// ============================================================================
// MOCK DATA - Will be replaced with real contract calls after deployment
// 
// TO UPDATE WHEN CONTRACTS ARE DEPLOYED:
// 1. Replace MOCK_RESERVES with ReserveRegistry.getReserveConfig() calls
// 2. Replace MOCK_ORDERS with real contract reads (EthCollateralOApp.orders() + HederaCreditOApp.getOutstandingDebt())
// 3. Replace mock handlers with real contract write calls
// 4. Update contract addresses in config.ts
// ============================================================================

const MOCK_RESERVES: MockReserveInfo[] = [
  {
    reserveId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
    label: 'Standard Reserve',
    maxLtvBps: 7500, // 75%
    liquidationThresholdBps: 8000, // 80%
    baseRateBps: 500, // 5% APR
    originationFeeBps: 100, // 1%
    controller: '0x00000000000000000000000000000000006ca0cb',
    active: true,
  },
  {
    reserveId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
    label: 'Conservative Reserve',
    maxLtvBps: 6000, // 60%
    liquidationThresholdBps: 7000, // 70%
    baseRateBps: 300, // 3% APR
    originationFeeBps: 50, // 0.5%
    controller: '0x00000000000000000000000000000000006ca0cb',
    active: true,
  },
];

const DEFAULT_RESERVE = MOCK_RESERVES[0];

const MOCK_ORDERS: MockOrderSummary[] = [
  {
    orderId: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
    reserveId: DEFAULT_RESERVE.reserveId,
    amountWei: parseEther('0.5'),
    unlockedWei: 0n,
    status: 'Borrowed',
    borrowedUsd: parseUnits('1500', 6),
    outstandingDebt: parseUnits('1505.25', 6), // Includes accrued interest
    reserveLabel: DEFAULT_RESERVE.label,
    lastBorrowRateBps: 500,
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
  },
  {
    orderId: '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`,
    reserveId: DEFAULT_RESERVE.reserveId,
    amountWei: parseEther('1.0'),
    unlockedWei: parseEther('0.3'), // Partial repayment made
    status: 'Borrowed',
    borrowedUsd: parseUnits('2000', 6),
    outstandingDebt: parseUnits('2010.50', 6),
    reserveLabel: DEFAULT_RESERVE.label,
    lastBorrowRateBps: 500,
    createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
  },
  {
    orderId: '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`,
    reserveId: DEFAULT_RESERVE.reserveId,
    amountWei: parseEther('0.25'),
    unlockedWei: parseEther('0.25'), // Fully repaid
    status: 'ReadyToWithdraw',
    borrowedUsd: 0n,
    outstandingDebt: 0n,
    reserveLabel: DEFAULT_RESERVE.label,
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
  },
  {
    orderId: '0x4444444444444444444444444444444444444444444444444444444444444444' as `0x${string}`,
    reserveId: DEFAULT_RESERVE.reserveId,
    amountWei: parseEther('0.1'),
    unlockedWei: 0n,
    status: 'Funded',
    borrowedUsd: 0n,
    outstandingDebt: 0n,
    reserveLabel: DEFAULT_RESERVE.label,
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FutureDemoPage: React.FC = () => {
  const [selectedOrderId, setSelectedOrderId] = useState<`0x${string}` | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'create'>('orders');
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedOrder = useMemo(() => {
    return selectedOrderId 
      ? MOCK_ORDERS.find(o => o.orderId === selectedOrderId) || null
      : null;
  }, [selectedOrderId]);

  const selectedReserve = useMemo(() => {
    if (!selectedOrder) return DEFAULT_RESERVE;
    return MOCK_RESERVES.find(r => r.reserveId === selectedOrder.reserveId) || DEFAULT_RESERVE;
  }, [selectedOrder]);

  // Group orders by status
  const { activeOrders, withdrawableOrders, fundableOrders } = useMemo(() => {
    return {
      activeOrders: MOCK_ORDERS.filter(o => o.status === 'Borrowed' || o.status === 'Funded'),
      withdrawableOrders: MOCK_ORDERS.filter(o => o.status === 'ReadyToWithdraw'),
      fundableOrders: MOCK_ORDERS.filter(o => o.status === 'Created'),
    };
  }, []);

  // Mock handlers (will be replaced with real contract calls)
  const handleCreateOrder = (amount: string) => {
    console.log('Mock: Creating order with', amount, 'ETH');
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert(`Mock: Order created! (In production, this would create a real order)`);
    }, 1000);
  };

  const handleAddCollateral = (amountEth: string) => {
    console.log('Mock: Adding collateral', amountEth, 'ETH to order', selectedOrderId);
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert(`Mock: Collateral added! (In production, this would call addCollateralWithNotify)`);
    }, 1500);
  };

  const handleWithdraw = () => {
    console.log('Mock: Withdrawing from order', selectedOrderId);
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert(`Mock: Withdrawal processed! (In production, this would call withdraw)`);
    }, 1000);
  };

  const handleBorrow = (amount: string) => {
    console.log('Mock: Borrowing', amount, 'hUSD');
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert(`Mock: Borrow successful! (In production, this would call borrow)`);
    }, 1500);
  };

  const handleRepay = () => {
    console.log('Mock: Repaying order', selectedOrderId);
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert(`Mock: Repayment processed! (In production, this would call repay)`);
    }, 1500);
  };

  const mockCalculateBorrowAmount = async () => {
    if (!selectedOrder) return null;
    // Mock calculation
    const ethPrice = 3300; // Mock price
    const collateralUsd = Number(formatUnits(selectedOrder.amountWei, 18)) * ethPrice;
    const maxBorrow = (collateralUsd * selectedReserve.maxLtvBps) / 10000;
    const alreadyBorrowed = Number(formatUnits(selectedOrder.borrowedUsd || 0n, 6));
    const remaining = Math.max(0, maxBorrow - alreadyBorrowed);
    return {
      amount: remaining.toFixed(2),
      price: ethPrice.toFixed(2),
    };
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-600/20 to-cyan-600/20 border border-indigo-500/30 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100 mb-2">Future Demo - Enhanced Features</h1>
            <p className="text-sm text-gray-400">
              Preview of the enhanced UI with reserve system, partial withdrawals, and collateral management.
              <span className="ml-2 text-amber-400">⚠️ Using mock data - will be replaced with real contracts</span>
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
              {/* Reserve Info Panel */}
              {selectedOrder && (
                <ReserveInfoPanel reserve={selectedReserve} />
              )}

              {/* Action Panel based on order status */}
              {selectedOrder && (
                <div className="bg-gray-800 rounded-2xl p-6">
                  {selectedOrder.status === 'Funded' && (
                    <BorrowView
                      orderId={selectedOrder.orderId}
                      onBorrow={handleBorrow}
                      calculateBorrowAmount={mockCalculateBorrowAmount}
                    />
                  )}

                  {selectedOrder.status === 'Borrowed' && (
                    <div className="space-y-4">
                      {/* Repay View */}
                      <RepayView
                        orderId={selectedOrder.orderId}
                        borrowAmount={selectedOrder.outstandingDebt 
                          ? formatUnits(selectedOrder.outstandingDebt, 6) 
                          : formatUnits(selectedOrder.borrowedUsd || 0n, 6)}
                        collateralEth={formatUnits(selectedOrder.amountWei, 18)}
                        onRepay={handleRepay}
                      />

                      {/* Add Collateral View */}
                      <AddCollateralView
                        orderId={selectedOrder.orderId}
                        currentCollateralWei={selectedOrder.amountWei}
                        onAddCollateral={handleAddCollateral}
                        isProcessing={isProcessing}
                      />
                    </div>
                  )}

                  {selectedOrder.status === 'ReadyToWithdraw' && (
                    <EnhancedWithdrawView
                      orderId={selectedOrder.orderId}
                      totalCollateralWei={selectedOrder.amountWei}
                      unlockedWei={selectedOrder.unlockedWei}
                      onWithdraw={handleWithdraw}
                      isProcessing={isProcessing}
                    />
                  )}
                </div>
              )}

              {!selectedOrder && (
                <div className="bg-gray-800/50 rounded-xl p-6 text-center text-gray-400">
                  Select an order from the right to manage it.
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column: Order Lists */}
        <div className="space-y-6">
          {/* Active Orders */}
          {activeOrders.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <h3 className="text-md font-semibold text-gray-300 mb-3">Active Orders</h3>
              <div className="space-y-3">
                {activeOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    reserve={MOCK_RESERVES.find(r => r.reserveId === order.reserveId) || DEFAULT_RESERVE}
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
                    reserve={MOCK_RESERVES.find(r => r.reserveId === order.reserveId) || DEFAULT_RESERVE}
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
                    reserve={MOCK_RESERVES.find(r => r.reserveId === order.reserveId) || DEFAULT_RESERVE}
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
  order: MockOrderSummary;
  reserve: MockReserveInfo;
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

  const totalEth = formatUnits(order.amountWei, 18);
  const unlockedEth = formatUnits(order.unlockedWei, 18);
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
            <ReserveBadge reserveLabel={order.reserveLabel || reserve.label} />
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Collateral:</span>
              <span className="text-gray-200 font-mono">{totalEth} ETH</span>
            </div>
            {order.unlockedWei > 0n && (
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

