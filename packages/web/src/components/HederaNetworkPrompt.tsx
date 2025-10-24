// src/components/HederaNetworkPrompt.tsx
import React from 'react';
import { useSwitchChain } from 'wagmi';
import { HEDERA_CHAIN_ID } from '../config';

interface HederaNetworkPromptProps {
  onNetworkAdded: () => void;
}

const HederaNetworkPrompt: React.FC<HederaNetworkPromptProps> = ({ onNetworkAdded }) => {
  const { switchChain, isPending, error } = useSwitchChain();

  const handleSwitch = () => {
    // We simply ask Wagmi to switch to the desired chain ID.
    // Wagmi will handle the logic of trying to switch first,
    // and if the network doesn't exist in the user's wallet,
    // it will then attempt to add it using the configuration from your wagmi.ts file.
    switchChain({ chainId: HEDERA_CHAIN_ID }, {
      // This callback will run only if the switch (or subsequent add) is successful.
      onSuccess: onNetworkAdded,
      onError: (err) => {
        // This provides more specific feedback if the switch fails.
        console.error("Failed to switch to Hedera Testnet:", err);
      }
    });
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold text-yellow-300">Action Required</h3>
      <p className="text-gray-400">
        To check the status on Hedera, your wallet needs to be connected to the Hedera Testnet.
      </p>
      <p className="text-xs text-gray-500">
        If the network is not in your wallet, MetaMask will prompt you to add it.
      </p>
      <button 
        onClick={handleSwitch}
        disabled={isPending}
        className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-wait"
      >
        {isPending ? 'Check Your Wallet...' : 'Switch to Hedera Testnet'}
      </button>
      {error && (
        <p className="text-red-400 text-sm mt-2">
          Error: {error.shortMessage || error.message}. Please try adding the network manually.
        </p>
      )}
    </div>
  );
};

export default HederaNetworkPrompt;