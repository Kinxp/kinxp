import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { submitToMirrorRelay } from '../services/mirrorRelayService';
import { parseEther, parseUnits, formatUnits } from 'viem';
import toast from 'react-hot-toast';

import {
  ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR,
  HEDERA_CHAIN_ID, HEDERA_CREDIT_ABI, HEDERA_CREDIT_OAPP_ADDR,
  HUSD_TOKEN_ADDR, ERC20_ABI, PYTH_CONTRACT_ADDR, PYTH_ABI,
  BORROW_SAFETY_BPS, USD_CONTROLLER_ABI
} from '../config';
import { fetchPythUpdateData } from '../services/pythService';

const WEI_PER_TINYBAR = 10_000_000_000n;

// This hook manages the state of a single, isolated on-chain action.
// It takes an optional callback to run when a transaction is successful.
export function useAppActions(onActionSuccess?: (receipt: any) => void) {
  const [actionError, setActionError] = useState<string | null>(null);
  
  const { chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();

  // Wagmi hooks for writing contracts and waiting for receipts
  const { 
    data: hash, 
    writeContract, 
    isPending: isWritePending, 
    reset: resetWriteContract,
    error: writeError 
  } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // Generic function to send a transaction, handling network switching
  const sendTxOnChain = useCallback(async (chainIdToSwitch: number, config: any) => {
    setActionError(null);
    const send = async () => {
      try {
        return await writeContract(config);
      } catch (error) {
        console.error('Transaction error:', error);
        throw error;
      }
    };
    
    if (chainId !== chainIdToSwitch) {
      toast('Please switch networks in your wallet.');
      return new Promise((resolve, reject) => {
        switchChain({ chainId: chainIdToSwitch }, { 
          onSuccess: () => send().then(resolve).catch(reject), 
          onError: (err) => {
            setActionError(err.message);
            reject(err);
          } 
        });
      });
    } 
    return send();
  }, [chainId, writeContract, switchChain]);

  // This central useEffect handles all feedback for the transaction lifecycle
  useEffect(() => {
    let toastId: string | undefined;
    if (isWritePending || isConfirming) {
      toastId = toast.loading('Processing transaction...');
    }
    if (receipt) {
      toast.dismiss(toastId);
      toast.success('Transaction confirmed!');
      onActionSuccess?.(receipt); // Call the success callback with the receipt
      resetWriteContract();
    }
    if (writeError) {
      toast.dismiss(toastId);
      const errorMessage = writeError instanceof Error 
        ? writeError.message 
        : typeof writeError === 'object' && writeError !== null && 'message' in writeError 
          ? String(writeError.message)
          : 'Transaction failed';
      
      toast.error(errorMessage);
      setActionError(errorMessage);
      resetWriteContract();
    }
    return () => { if (toastId) toast.dismiss(toastId) };
  }, [isWritePending, isConfirming, receipt, writeError, onActionSuccess, resetWriteContract]);


  // --- WRAPPED ACTION HANDLERS ---
  // Each function is now a clean wrapper that just prepares and sends a transaction.

  const handleCreateOrder = useCallback((ethAmount: string) => {
    toast('Creating order...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'createOrderId' });
  }, [sendTxOnChain]);

  const handleFundOrder = useCallback(async (orderId: `0x${string}`, amountToFund: string) => {
    toast('Funding order...');
    try {
      const nativeFee = parseEther('0.0001');
      const totalValue = parseEther(amountToFund) + nativeFee;
      
      // Store the transaction hash
      const txHash = await sendTxOnChain(ETH_CHAIN_ID, { 
        address: ETH_COLLATERAL_OAPP_ADDR, 
        abi: ETH_COLLATERAL_ABI, 
        functionName: 'fundOrderWithNotify', 
        args: [orderId, parseEther(amountToFund)], 
        value: totalValue 
      }) as `0x${string}`;

      // After successful funding, call the mirror relay service
      if (txHash) {
        if (!address) {
          throw new Error('No connected wallet address found');
        }
        
        toast('Notifying Hedera via mirror relay...');
        try {
          const result = await submitToMirrorRelay({
            orderId,
            txHash,
            collateralToUnlock: parseEther(amountToFund).toString(),
            fullyRepaid: false,
            reserveId: orderId, // Using orderId as reserveId
            borrower: address // Now we're sure address is defined
          });

          if (!result.success) {
            throw new Error(result.error || 'Failed to notify Hedera via mirror relay');
          }
          
          toast.success('Hedera mirror relay notified successfully');
        } catch (mirrorError) {
          console.error('Mirror relay error:', mirrorError);
          toast.error('Funding successful but failed to notify Hedera mirror. Please try again later.');
          // Don't throw the error to keep the funding successful
        }
      }

      return txHash;
    } catch (e) { 
      const error = e as Error;
      setActionError(error.message); 
      throw error;
    }
  }, [sendTxOnChain, address]);
  
  const handleBorrow = useCallback(async (orderId: `0x${string}`, amountToBorrow: string) => {
    toast('Preparing borrow transaction...');
    try {
      const { priceUpdateData } = await fetchPythUpdateData();
      const requiredFeeInTinybars = await readContract(wagmiConfig, { address: PYTH_CONTRACT_ADDR, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [priceUpdateData], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      await sendTxOnChain(HEDERA_CHAIN_ID, { 
        address: HEDERA_CREDIT_OAPP_ADDR, 
        abi: HEDERA_CREDIT_ABI, 
        functionName: 'borrow', 
        args: [orderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300], 
        value: valueInWei, 
        gas: 1_500_000n 
      });
    } catch (e) { 
      const error = e as Error;
      setActionError(error.message); 
      throw error;
    }
  }, [sendTxOnChain]);

  const handleRepay = useCallback(async (orderId: `0x${string}`, repayAmount: string, treasuryAddress: `0x${string}`) => {
    toast('Returning funds to treasury...');
    try {
      await sendTxOnChain(HEDERA_CHAIN_ID, { 
        address: HUSD_TOKEN_ADDR, 
        abi: ERC20_ABI, 
        functionName: 'transfer', 
        args: [treasuryAddress, parseUnits(repayAmount, 6)] 
      });
    } catch (e) {
      const error = e as Error;
      setActionError(error.message);
      throw error;
    }
  }, [sendTxOnChain]);

  const handleRepayAndCross = useCallback(async (orderId: `0x${string}`, repayAmount: string, txHash?: string, reserveId?: string, borrower?: string) => {
    const useRelay = process.env.NEXT_PUBLIC_USE_MIRROR_RELAY === 'true';
    
    if (useRelay) {
      toast('Using mirror relay to process repayment...');
      try {
        if (!txHash || !reserveId || !borrower) {
          throw new Error('Missing required parameters for relay');
        }
        
        const result = await fetch('/api/mirror/relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            txHash,
            collateralToUnlock: '0', // Set appropriate value or get from UI
            fullyRepaid: true,
            reserveId,
            borrower
          })
        });
        
        const data = await result.json();
        if (!result.ok) {
          throw new Error(data.error || 'Failed to process repayment through relay');
        }
        
        toast.success('Repayment processed successfully through relay');
        return data.txHash;
      } catch (e: any) {
        console.error('Relay error:', e);
        setActionError(e.shortMessage || e.message || 'Failed to process repayment through relay');
        throw e; // Re-throw to allow UI to handle the error
      }
    } else {
      // Original direct contract call
      toast('Notifying Ethereum of repayment...');
      try {
        const feeInTinybars = await readContract(wagmiConfig, { 
          address: HEDERA_CREDIT_OAPP_ADDR, 
          abi: HEDERA_CREDIT_ABI, 
          functionName: 'quoteRepayFee', 
          args: [orderId], 
          chainId: HEDERA_CHAIN_ID 
        }) as bigint;
        
        const valueInWei = feeInTinybars * WEI_PER_TINYBAR;
        const txHash = await sendTxOnChain(HEDERA_CHAIN_ID, { 
          address: HEDERA_CREDIT_OAPP_ADDR, 
          abi: HEDERA_CREDIT_ABI, 
          functionName: 'repay', 
          args: [orderId, parseUnits(repayAmount, 6), true], 
          value: valueInWei, 
          gas: 1_500_000n 
        });
        
        return txHash;
      } catch (e: any) { 
        setActionError(e.shortMessage || e.message);
        throw e; // Re-throw to allow UI to handle the error
      }
    }
  }, [sendTxOnChain]);

  const handleWithdraw = useCallback(async (orderId: `0x${string}`) => {
    toast('Withdrawing collateral...');
    try {
      await sendTxOnChain(ETH_CHAIN_ID, { 
        address: ETH_COLLATERAL_OAPP_ADDR, 
        abi: ETH_COLLATERAL_ABI, 
        functionName: 'withdraw', 
        args: [orderId] 
      });
    } catch (e) {
      const error = e as Error;
      setActionError(error.message);
      throw error;
    }
  }, [sendTxOnChain]);


  // Return the state and the action handlers for components to use
  return {
    // State
    isLoading: isWritePending || isConfirming,
    isSuccess: !!receipt,
    error: actionError,
    receipt, // Expose the receipt so we can get data from it (like the orderId)

    // Action Handlers
    handleCreateOrder,
    handleFundOrder,
    handleBorrow,
    handleRepay,
    handleRepayAndCross,
    handleWithdraw,
  };
}