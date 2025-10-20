import React from 'react';

const Header: React.FC = () => {
  return (
    <nav className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 sticky top-0 z-10">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-2xl font-bold text-cyan-400">ChainBridge</h1>
        <button className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
          Connect Wallet
        </button>
      </div>
    </nav>
  );
}

export default Header;