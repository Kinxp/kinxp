import React, { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

interface WalletContextType {
  isConnected: boolean;
  address: `0x${string}` | undefined;
  chainId: number | undefined;
  connectWallet: () => Promise<void>;
  switchChain: (config: { chainId: number }) => Promise<any>;
  writeContractAsync: any;
  resetWriteContract: () => void;
  isWritePending: boolean;
  isConfirming: boolean;
  writeError: Error | null;
  hash: `0x${string}` | undefined;
  receipt: any;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { isConnected, address, chainId } = useAccount();
  const { switchChainAsync: switchChain } = useSwitchChain();
  
  // Centralize the write hook here
  const { 
    writeContractAsync, 
    data: hash, 
    error: writeError, 
    isPending: isWritePending, 
    reset: resetWriteContract 
  } = useWriteContract();

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const connectWallet = useCallback(async () => {
    if (typeof window !== 'undefined' && window.ethereum) {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
    }
  }, []);

  const value = useMemo(() => ({
    isConnected, address, chainId, connectWallet, switchChain,
    writeContractAsync, resetWriteContract, isWritePending,
    isConfirming, writeError, hash, receipt
  }), [isConnected, address, chainId, connectWallet, switchChain, writeContractAsync, resetWriteContract, isWritePending, isConfirming, writeError, hash, receipt]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
};