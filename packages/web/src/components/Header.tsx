// src/components/Header.tsx
import React from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { NavLink } from 'react-router-dom';

const Header: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
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
              to="/demo" 
              className={({ isActive }) => 
                `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
              }
            >
              Future Demo
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
            <div className="bg-gray-700 text-sm text-cyan-300 font-mono py-2 px-4 rounded-lg">
              {`${address?.slice(0, 6)}...${address?.slice(-4)}`}
            </div>
            <button
              onClick={() => disconnect()}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: connectors[0] })} // Connects with the first available wallet (usually MetaMask)
            className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
};

export default Header;