import React from 'react';
import { useAccount } from 'wagmi';
import CollateralChart from '../components/analytics/CollateralChart';
import TotalBorrowedChart from '../components/analytics/TotalBorrowedChart';
import StatusPieChart from '../components/analytics/StatusPieChart';

const AnalyticsPage = () => {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <div className="text-center text-gray-400">Please connect your wallet to view your analytics.</div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <h1 className="text-3xl font-bold text-white">Portfolio Analytics</h1>
      
      {/* Each chart is now its own self-contained component */}
      <CollateralChart />
      <TotalBorrowedChart />
      <StatusPieChart />
      
    </div>
  );
};

export default AnalyticsPage;