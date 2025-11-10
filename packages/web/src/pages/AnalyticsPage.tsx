import React from 'react';
import { useAccount, useConnect } from 'wagmi';
import CollateralChart from '../components/analytics/CollateralChart';
import TotalBorrowedChart from '../components/analytics/TotalBorrowedChart';
import StatusPieChart from '../components/analytics/StatusPieChart';
import DemoAnalyticsView from '../components/analytics/DemoAnalyticsView';

const AnalyticsPage = () => {
  const { isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();

  const handleConnect = () => {
    if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <h1 className="text-3xl font-bold text-white">Portfolio Analytics</h1>
      {!isConnected && (
          <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1">
              Showing Demo Data
          </p>
      )}
      <div className="relative">
        {/* If the user is connected, show the real charts. */}
        {isConnected ? (
          <div className="space-y-8 animate-fade-in">
            <CollateralChart />
            <TotalBorrowedChart />
            <StatusPieChart />
          </div>
        ) : (
          // If not connected, show the Demo View and the "Connect Wallet" overlay.
          <div>
            <DemoAnalyticsView />
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
              <div className="bg-gray-800/80 backdrop-blur-md border border-gray-700 p-8 rounded-2xl text-center shadow-lg">
                <h2 className="text-2xl font-bold text-white mb-2">View Your Personal Analytics</h2>
                <p className="text-gray-300 mb-6">Connect your wallet to see a detailed breakdown of your portfolio.</p>
                <button
                  onClick={handleConnect}
                  disabled={isPending}
                  className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {isPending ? 'Connecting...' : 'Connect Wallet'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
    </div>
  );
};

export default AnalyticsPage;