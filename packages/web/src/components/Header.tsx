// src/components/Header.tsx
import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { NavLink } from 'react-router-dom';

const Header: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  
  // State to control the wallet selection modal
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const handleConnect = (connector: any) => {
    connect({ connector });
    setIsWalletModalOpen(false);
  };

  return (
    <>
      <nav className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold text-cyan-400">KINXP</h1>
          
          <div className="flex items-center gap-4 border-b border-gray-700/50 pb-2">
             <NavLink 
                to="/" 
                className={({ isActive }) => 
                  `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
                }
              >
                Home
              </NavLink>
              <NavLink 
                to="/dashboard" 
                className={({ isActive }) => 
                  `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
                }
              >
                Dashboard
              </NavLink>
              <NavLink 
                to="/analytics" 
                className={({ isActive }) => 
                  `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
                }
              >
                Analytics
              </NavLink>
              <NavLink 
                to="/liquidity" 
                className={({ isActive }) => 
                  `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
                }
              >
                Liquidity
              </NavLink>
          </div>

          {isConnected ? (
            <div className="flex items-center gap-4">
              <div className="bg-gray-700 text-sm text-cyan-300 font-mono py-2 px-4 rounded-lg border border-gray-600">
                {`${address?.slice(0, 6)}...${address?.slice(-4)}`}
              </div>
              <button
                onClick={() => disconnect()}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              // Instead of connecting immediately, we open the modal
              onClick={() => setIsWalletModalOpen(true)} 
              className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </nav>

      {/* Wallet Selection Modal */}
      {isWalletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 w-full max-w-sm shadow-2xl relative">
            
            {/* Close Button */}
            <button 
              onClick={() => setIsWalletModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-xl font-bold text-white mb-6 text-center">Select Wallet</h2>
            
            <div className="flex flex-col gap-3">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => handleConnect(connector)}
                  className="flex items-center justify-between bg-gray-700 hover:bg-gray-600 text-white p-4 rounded-lg transition-colors border border-gray-600 hover:border-cyan-500"
                >
                  <span className="font-medium">{connector.name}</span>
                  {/* Optional: You can add wallet icons here if available */}
                </button>
              ))}
            </div>
            
            {connectors.length === 0 && (
              <p className="text-gray-400 text-center">No wallets detected.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default Header;