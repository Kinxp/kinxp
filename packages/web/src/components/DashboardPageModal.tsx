import React from 'react';
import { useConnect } from 'wagmi';

const WalletIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
);

const DashboardPageModal: React.FC = () => {
  const { connectors, connect, isPending } = useConnect();

  const handleConnect = () => {
    if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    } else {
      alert("No wallet connector found. Please install a web3 wallet like MetaMask.");
    }
  };

  return (
    // 1. Add classes to make this component look like a modal overlay.
    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/60 p-6 sm:p-10 rounded-2xl text-center shadow-lg max-w-5xl mx-auto animate-fade-in">      
      {/* 2. Restore the original rich content. */}
      <h1 className="text-4xl sm:text-5xl font-bold mb-4">
        <span className="bg-gradient-to-r from-cyan-400 to-blue-500 text-transparent bg-clip-text">
          Unlock Liquidity Across Chains
        </span>
      </h1>
      
      <p className="text-lg text-gray-300 mb-12 max-w-2xl mx-auto">
        Leverage your Ethereum (ETH) as collateral to instantly borrow USD on the high-speed Hedera network.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 text-left">
        {/* Step 1: Lock */}
        <div className="bg-gray-900/50 p-5 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3 mb-2">
              <div className="bg-cyan-500/10 text-cyan-400 rounded-md p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <h3 className="font-bold text-lg text-white">1. Secure Collateral</h3>
          </div>
          <p className="text-sm text-gray-400">Lock your ETH in a secure, audited smart contract on the Ethereum Sepolia testnet.</p>
        </div>
        
        {/* Step 2: Borrow */}
        <div className="bg-gray-900/50 p-5 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3 mb-2">
              <div className="bg-cyan-500/10 text-cyan-400 rounded-md p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <h3 className="font-bold text-lg text-white">2. Borrow Instantly</h3>
          </div>
          <p className="text-sm text-gray-400">Receive native HTS-backed US Dollars (hUSD) on the Hedera testnet, ready to use.</p>
        </div>

        {/* Step 3: Repay & Withdraw */}
        <div className="bg-gray-900/50 p-5 rounded-lg border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
                <div className="bg-cyan-500/10 text-cyan-400 rounded-md p-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                </div>
                <h3 className="font-bold text-lg text-white">3. Repay & Withdraw</h3>
            </div>
          <p className="text-sm text-gray-400">Repay your loan on Hedera at any time to instantly unlock your original ETH collateral.</p>
        </div>
      </div>

      <button
        onClick={handleConnect}
        disabled={isPending}
        className="w-full max-w-xs mx-auto bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-3"
      >
        <WalletIcon />
        {isPending ? 'Connecting...' : 'Connect Wallet'}
      </button>

    </div>
  );
};

export default DashboardPageModal;