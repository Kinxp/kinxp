import React from 'react';
import OrderActionList from './OrderActionList';
import OrderInfoList from './OrderInfoList';
import { UserOrderSummary } from '../../types';

// Import the components we want to include in our demo preview
import CreateOrderView from './CreateOrderView';
import ActionPanel from '../ActionPanel';

// Realistic fake data for the demo lists
const FAKE_ORDERS: UserOrderSummary[] = [
  { orderId: '0x1a2b3c4d5e6f...', amountWei: 1500000000000000000n, status: 'Borrowed', borrowedUsd: 2000000000n },
  { orderId: '0x3c4d5e6f7g8h...', amountWei: 500000000000000000n, status: 'ReadyToWithdraw' },
  { orderId: '0x5e6f7g8h9i0j...', amountWei: 2000000000000000000n, status: 'Funded' },
  { orderId: '0x7g8h9i0j1k2l...', amountWei: 1000000000000000000n, status: 'Withdrawn' },
  { orderId: '0x9k8j7h6g5f4d...', amountWei: 750000000000000000n, status: 'Created' },
];

const DemoDashboardView = () => {
  // Filter the fake data just like the real component does
  const fundable = FAKE_ORDERS.filter(o => o.status === 'Created');
  const active = FAKE_ORDERS.filter(o => o.status === 'Funded' || o.status === 'Borrowed');
  const withdrawable = FAKE_ORDERS.filter(o => o.status === 'ReadyToWithdraw');
  const closed = FAKE_ORDERS.filter(o => o.status === 'Withdrawn');
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* --- THIS IS THE FIX --- */}
      {/* LEFT COLUMN: Render the actual components for a realistic preview */}
      <div className="space-y-6">
        <div className="bg-gray-800 rounded-2xl p-6">
          {/* 
            We render the real CreateOrderView. The `onSubmit` function does nothing
            in demo mode. The overlay will prevent clicks anyway.
          */}
          <CreateOrderView onSubmit={() => { console.log("CreateOrder (Demo) clicked"); }} />
        </div>

        <div className="bg-gray-800 rounded-2xl p-6">
          {/*
            We render the real ActionPanel. By passing an empty array, it will show
            its default "Select an order" message, which is a perfect preview.
          */}
          <ActionPanel allOrders={[]} />
        </div>
      </div>
      
      {/* RIGHT COLUMN: Render the real list components with fake data */}
      <div className="space-y-6">
        <OrderActionList title="Ready to Fund on Sepolia" orders={fundable} selectedOrderId={null} onSelectOrder={() => {}} />
        <OrderActionList title="Active Orders" orders={active} selectedOrderId={null} onSelectOrder={() => {}} />
        <OrderActionList title="Ready to Withdraw on Sepolia" orders={withdrawable} selectedOrderId={null} onSelectOrder={() => {}} />
        <OrderInfoList title="Closed Orders" orders={closed} />
      </div>
    </div>
  );
};

export default DemoDashboardView;