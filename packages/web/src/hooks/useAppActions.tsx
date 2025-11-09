import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
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
  const { data: hash, writeContract, isPending: isWritePending, reset: resetWriteContract } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // Generic function to send a transaction, handling network switching
  const sendTxOnChain = useCallback((chainIdToSwitch: number, config: any) => {
    setActionError(null);
    const send = () => writeContract(config);
    if (chainId !== chainIdToSwitch) {
      toast('Please switch networks in your wallet.');
      switchChain({ chainId: chainIdToSwitch }, { onSuccess: send, onError: (err) => setActionError(err.message) });
    } else { send(); }
  }, [chainId, writeContract, switchChain]);

  // This central useEffect handles all feedback for the transaction lifecycle
  useEffect(() => {
    let toastId: string | undefined;
    if (isConfirming) {
      toastId = toast.loading('Confirming transaction...');
    }
    if (receipt) {
      toast.dismiss(toastId);
      toast.success('Transaction confirmed!');
      onActionSuccess?.(receipt); // Call the success callback with the receipt
      resetWriteContract();
    }
    if (writeError) {
      toast.dismiss(toastId);
      const message = writeError.shortMessage || 'Transaction failed.';
      toast.error(message);
      setActionError(message);
      resetWriteContract();
    }
    return () => { if (toastId) toast.dismiss(toastId) };
  }, [isConfirming, receipt, writeError, onActionSuccess, resetWriteContract]);


  // --- WRAPPED ACTION HANDLERS ---
  // Each function is now a clean wrapper that just prepares and sends a transaction.

  const handleCreateOrder = useCallback((ethAmount: string) => {
    toast('Creating order...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'createOrderId' });
  }, [sendTxOnChain]);

  const handleFundOrder = useCallback((orderId: `0x${string}`, amountToFund: string) => {
    toast('Funding order...');
    const nativeFee = parseEther('0.0001');
    const totalValue = parseEther(amountToFund) + nativeFee;
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'fundOrderWithNotify', args: [orderId, parseEther(amountToFund)], value: totalValue });
  }, [sendTxOnChain]);
  
  const handleBorrow = useCallback(async (orderId: `0x${string}`, amountToBorrow: string) => {
    toast('Preparing borrow transaction...');
    try {
      const { priceUpdateData } = await fetchPythUpdateData();
      const requiredFeeInTinybars = await readContract(wagmiConfig, { address: PYTH_CONTRACT_ADDR, abi: PYTH_ABI, functionName: 'getUpdateFee', args: [priceUpdateData], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = requiredFeeInTinybars * WEI_PER_TINYBAR;
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'borrow', args: [orderId, parseUnits(amountToBorrow, 6), priceUpdateData, 300], value: valueInWei, gas: 1_500_000n });
    } catch (e: any) { setActionError(e.shortMessage || e.message); }
  }, [sendTxOnChain]);

  const handleRepay = useCallback(async (orderId: `0x${string}`, repayAmount: string, treasuryAddress: `0x${string}`) => {
    toast('Returning funds to treasury...');
    sendTxOnChain(HEDERA_CHAIN_ID, { address: HUSD_TOKEN_ADDR, abi: ERC20_ABI, functionName: 'transfer', args: [treasuryAddress, parseUnits(repayAmount, 6)] });
  }, [sendTxOnChain]);

  const handleRepayAndCross = useCallback(async (orderId: `0x${string}`, repayAmount: string) => {
    toast('Notifying Ethereum of repayment...');
    try {
      const feeInTinybars = await readContract(wagmiConfig, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'quoteRepayFee', args: [orderId], chainId: HEDERA_CHAIN_ID }) as bigint;
      const valueInWei = feeInTinybars * WEI_PER_TINYBAR;
      sendTxOnChain(HEDERA_CHAIN_ID, { address: HEDERA_CREDIT_OAPP_ADDR, abi: HEDERA_CREDIT_ABI, functionName: 'repay', args: [orderId, parseUnits(repayAmount, 6), true], value: valueInWei, gas: 1_500_000n });
    } catch (e: any) { setActionError(e.shortMessage || e.message); }
  }, [sendTxOnChain]);

  const handleWithdraw = useCallback((orderId: `0x${string}`) => {
    toast('Withdrawing collateral...');
    sendTxOnChain(ETH_CHAIN_ID, { address: ETH_COLLATERAL_OAPP_ADDR, abi: ETH_COLLATERAL_ABI, functionName: 'withdraw', args: [orderId] });
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