// src/services/sepoliaService.ts

import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR } from '../config';

/**
 * Polls the EthCollateralOApp contract on Sepolia to check if an order has been marked as repaid.
 * @param orderId The order ID to check.
 * @returns A promise that resolves to true when the order is marked as repaid.
 */
export async function pollForEthRepaid(orderId: `0x${string}`): Promise<boolean> {
  try {
    const orderData = await readContract(wagmiConfig, {
      address: ETH_COLLATERAL_OAPP_ADDR,
      abi: ETH_COLLATERAL_ABI,
      functionName: 'orders',
      args: [orderId],
      chainId: ETH_CHAIN_ID,
    }) as { amount: bigint; owner: string; repaid: boolean; open: boolean };

    console.log(`[Polling Sepolia] Checking order ${orderId.slice(0,10)}... Repaid status: ${orderData.repaid}`);

    return orderData.repaid === true;
  } catch (error) {
    console.error('[Polling Sepolia] Error fetching order status:', error);
    return false; // Continue polling on error
  }
}