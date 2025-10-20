import React, { useState } from 'react';
import Header from './components/Header';
import CreateOrder from './components/CreateOrder';
import FundOrder from './components/FundOrder';
import WithdrawUsd from './components/WithdrawUsd';
import PositionDashboard from './components/PositionDashboard';
import PositionLiquidated from './components/PositionLiquidated';

// Use an enum for clearer, type-safe state management
enum AppState {
  IDLE = 'IDLE',
  ORDER_CREATED = 'ORDER_CREATED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  LOAN_ACTIVE = 'LOAN_ACTIVE',
  LIQUIDATED = 'LIQUIDATED',
}

// Define the shape of our order data to be used across components
export interface OrderData {
  ethAmount: number;
  ethOrderId: string;
  usdValue: string;
  hederaOrderId: string;
  liquidationPrice: string;
}

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [orderData, setOrderData] = useState<OrderData | null>(null);

  const handleCreateOrder = (ethAmount: number) => {
    setOrderData({
      ethAmount,
      ethOrderId: '0x8a3f...b4e1',
      usdValue: (ethAmount * 3267.17).toFixed(2),
      liquidationPrice: (ethAmount * 3267.17 * 0.6).toFixed(2), // Example liquidation logic
      hederaOrderId: 'HED-ORD-f791...a55c',
    });
    setAppState(AppState.ORDER_CREATED);
  };

  const handlePaymentVerified = () => {
    setAppState(AppState.PAYMENT_CONFIRMED);
  };
  
  const handleWithdraw = () => {
    setAppState(AppState.LOAN_ACTIVE);
  };

  const handleRepay = () => {
    alert("Repayment successful! Your ETH has been released.");
    handleReset();
  };

  const handleLiquidation = () => {
    setAppState(AppState.LIQUIDATED);
  };

  const handleReset = () => {
    setOrderData(null);
    setAppState(AppState.IDLE);
  };

  const renderCurrentStep = () => {
    switch (appState) {
      case AppState.IDLE:
        return <CreateOrder onCreateOrder={handleCreateOrder} />;
      case AppState.ORDER_CREATED:
        // Type assertion tells TypeScript we know orderData is not null here
        return <FundOrder orderData={orderData!} onPaymentVerified={handlePaymentVerified} />;
      case AppState.PAYMENT_CONFIRMED:
        return <WithdrawUsd orderData={orderData!} onWithdraw={handleWithdraw} />;
      case AppState.LOAN_ACTIVE:
        return <PositionDashboard orderData={orderData!} onRepay={handleRepay} onLiquidate={handleLiquidation} />;
      case AppState.LIQUIDATED:
        return <PositionLiquidated orderData={orderData!} onReset={handleReset} />;
      default:
        return <CreateOrder onCreateOrder={handleCreateOrder} />;
    }
  };

  return (
    <div className="bg-gray-900 min-h-screen text-white font-sans">
      <Header />
      <main className="container mx-auto p-4 sm:p-8">
        <div className="max-w-md mx-auto">
          {renderCurrentStep()}
        </div>
      </main>
    </div>
  );
}

export default App;