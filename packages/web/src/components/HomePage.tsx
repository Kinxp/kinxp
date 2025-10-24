// src/components/HomePage.tsx

import React from 'react';
import { useConnect } from 'wagmi';

const HomePage: React.FC = () => {
  const { connectors, connect, isPending } = useConnect();

  const handleConnect = () => {
    // We connect to the first available connector, which is typically MetaMask's injected provider
    if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    } else {
        alert("No wallet connector found. Please install MetaMask.");
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 text-center animate-fade-in">
      <h2 className="text-4xl font-bold text-cyan-400 mb-4">Welcome to KINXP</h2>
      <p className="text-lg text-gray-300 mb-8">
        The simplest way to swap your Ethereum (ETH) for US Dollars (USD) on the Hedera network.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 text-left">
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
          <h3 className="font-bold text-white mb-2">Secure Collateral</h3>
          <p className="text-sm text-gray-400">Lock your ETH in a secure smart contract on the Ethereum network.</p>
        </div>
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
          <h3 className="font-bold text-white mb-2">Fast Liquidity</h3>
          <p className="text-sm text-gray-400">Instantly borrow HTS-backed USD on Hedera's high-speed network.</p>
        </div>
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
          <h3 className="font-bold text-white mb-2">Cross-Chain</h3>
          <p className="text-sm text-gray-400">Powered by LayerZero for seamless and trustless communication.</p>
        </div>
      </div>

      <button
        onClick={handleConnect}
        disabled={isPending}
        className="w-full max-w-xs mx-auto bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-3"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        {isPending ? 'Connecting...' : 'Connect Wallet to Get Started'}
      </button>
    </div>
  );
};

export default HomePage;