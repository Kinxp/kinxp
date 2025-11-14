import React, { useState, useMemo, useEffect } from 'react';
import { formatUnits, parseEther, parseUnits } from 'viem';
import { useAccount } from 'wagmi';
import { OrderStatus, UserOrderSummary } from '../types';
import ReserveBadge from '../components/demo/ReserveBadge';
import ReserveInfoPanel from '../components/demo/ReserveInfoPanel';
import AddCollateralView from '../components/demo/AddCollateralView';
import EnhancedWithdrawView from '../components/demo/EnhancedWithdrawView';
import BorrowView from '../components/actionpanel/manageorder/BorrowView';
import RepayView from '../components/actionpanel/manageorder/RepayView';
import CreateOrderView from '../components/dashboard/CreateOrderView';
import { fetchAllUserOrders } from '../services/blockscoutService';

// Types for the reserve info
interface ReserveInfo {
  reserveId: `0x${string}`;
  label: string;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  baseRateBps: number;
  originationFeeBps: number;
  controller: `0x${string}`;
  active: boolean;
}

const DashboardPageV2: React.FC = () => {
  const { address } = useAccount();
  const [orders, setOrders] = useState<UserOrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<UserOrderSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'create'>('orders');
  const [isLoading, setIsLoading] = useState(true);

  // Fetch user orders on mount and when address changes
  useEffect(() => {
    const loadOrders = async () => {
      if (!address) {
        setOrders([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const userOrders = await fetchAllUserOrders(address);
        setOrders(userOrders);
      } catch (error) {
        console.error('Failed to fetch orders:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadOrders();
  }, [address]);

  // Mock reserves - in a real app, this would come from the ReserveRegistry
  const mockReserves: ReserveInfo[] = [
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
    // Add more reserves as needed
  ];

  // Get reserve info for an order
  const getReserveInfo = (reserveId?: `0x${string}`) => {
    if (!reserveId) return null;
    return mockReserves.find(r => r.reserveId === reserveId) || null;
  };

  // Handle order creation
  const handleOrderCreated = (newOrder: UserOrderSummary) => {
    setOrders(prev => [...prev, newOrder]);
    setActiveTab('orders');
  };

  // Render the order list
  const renderOrderList = () => (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-center py-8">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No orders found</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map(order => {
            const reserve = getReserveInfo(order.reserveId);
            return (
              <div 
                key={order.orderId} 
                className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-blue-500 transition-colors cursor-pointer"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="flex justify-between items-start">
                  <h3 className="text-lg font-medium">
                    Order #{order.orderId.slice(0, 8)}...
                  </h3>
                  {reserve && <ReserveBadge reserveLabel={reserve.label} />}
                </div>
                
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Collateral:</span>
                    <span>{formatUnits(order.amountWei, 18)} ETH</span>
                  </div>
                  {order.unlockedWei !== undefined && order.unlockedWei > 0n && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Unlocked:</span>
                      <span>{formatUnits(order.unlockedWei, 18)} ETH</span>
                    </div>
                  )}
                  {order.borrowedUsd !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Borrowed:</span>
                      <span>${formatUnits(order.borrowedUsd, 8)} USD</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <span className={`px-2 py-1 rounded text-xs ${
                    order.status === 'Borrowed' ? 'bg-green-900/30 text-green-400' :
                    order.status === 'Created' ? 'bg-blue-900/30 text-blue-400' :
                    order.status === 'Funded' ? 'bg-purple-900/30 text-purple-400' :
                    'bg-gray-700/30 text-gray-400'
                  }`}>
                    {order.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Render the order creation form
  const renderCreateOrder = () => (
    <div className="max-w-2xl mx-auto bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-6">Create New Order</h2>
      <CreateOrderView onOrderCreated={handleOrderCreated} />
    </div>
  );

  // Render the selected order details modal
  const renderOrderDetails = () => {
    if (!selectedOrder) return null;
    
    const reserve = getReserveInfo(selectedOrder.reserveId);
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
        <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-xl font-semibold">
                Order #{selectedOrder.orderId.slice(0, 8)}...
              </h2>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            {reserve && (
              <div className="mb-6">
                <h3 className="font-medium mb-2">Reserve</h3>
                <ReserveInfoPanel 
                  reserve={{
                    ...reserve,
                    active: true,
                    // Add any other required properties from MockReserveInfo
                    controller: reserve.controller || '0x0000000000000000000000000000000000000000',
                    reserveId: reserve.reserveId || '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
                  }}
                />
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3">Collateral</h3>
                <EnhancedWithdrawView 
                  orderId={selectedOrder.orderId}
                  totalCollateralWei={selectedOrder.amountWei}
                  unlockedWei={selectedOrder.unlockedWei || 0n}
                  onWithdraw={() => {
                    // For now, we'll just close the modal
                    // The actual withdrawal will be handled by the EnhancedWithdrawView
                    setSelectedOrder(null);
                  }}
                  isProcessing={false}
                />
              </div>
              
              <div>
                <h3 className="font-medium mb-3">Borrow</h3>
                {selectedOrder.status === 'Funded' ? (
                  <BorrowView 
                    orderId={selectedOrder.orderId}
                    onBorrow={(amountToBorrow) => {
                      // Update the order in the list
                      setOrders(prev => prev.map(o => 
                        o.orderId === selectedOrder.orderId 
                          ? { ...o, status: 'Borrowed', borrowedUsd: BigInt(amountToBorrow) }
                          : o
                      ));
                      setSelectedOrder(null);
                    }}
                    calculateBorrowAmount={async () => {
                      // In a real app, this would calculate the max borrow amount based on collateral
                      return {
                        amount: '100', // Example fixed amount
                        price: '2000'  // Example ETH price in USD
                      };
                    }}
                  />
                ) : (
                  <RepayView 
                    orderId={selectedOrder.orderId}
                    borrowAmount={selectedOrder.borrowedUsd?.toString() || '0'}
                    collateralEth={formatUnits(selectedOrder.amountWei, 18)}
                    onRepay={() => {
                      // Update the order in the list
                      setOrders(prev => prev.map(o => 
                        o.orderId === selectedOrder.orderId 
                          ? { ...o, status: 'ReadyToWithdraw', borrowedUsd: 0n }
                          : o
                      ));
                      setSelectedOrder(null);
                    }}
                  />
                )}
              </div>
              
              <div className="md:col-span-2">
                <h3 className="font-medium mb-3">Add Collateral</h3>
                <AddCollateralView 
                  orderId={selectedOrder.orderId}
                  currentCollateralWei={selectedOrder.amountWei}
                  onAddCollateral={(amountEth) => {
                    // Convert amount from ETH to wei
                    const amountWei = parseEther(amountEth);
                    // Update the order in the list
                    setOrders(prev => prev.map(o => 
                      o.orderId === selectedOrder.orderId 
                        ? { ...o, amountWei: o.amountWei + amountWei }
                        : o
                    ));
                    setSelectedOrder(null);
                  }}
                  isProcessing={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 rounded-l-lg ${activeTab === 'orders' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            My Orders
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 rounded-r-lg ${activeTab === 'create' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            Create Order
          </button>
        </div>
      </div>

      {activeTab === 'orders' ? renderOrderList() : renderCreateOrder()}
      
      {selectedOrder && renderOrderDetails()}
    </div>
  );
};

export default DashboardPageV2;
