import { readContract } from 'wagmi/actions';
import { config as wagmiConfig } from '../wagmi';
import { Address, keccak256, encodeAbiParameters } from 'viem';
import { ETH_CHAIN_ID, ETH_COLLATERAL_ABI, ETH_COLLATERAL_OAPP_ADDR } from '../config';
import { OrderStatus, UserOrderSummary } from '../types';

const ORDER_ID_ABI = [
  { name: 'user', type: 'address' },
  { name: 'nonce', type: 'uint96' },
  { name: 'chainId', type: 'uint256' },
] as const;

function deriveStatus({
  funded,
  repaid,
  liquidated,
}: {
  funded: boolean;
  repaid: boolean;
  liquidated: boolean;
}): OrderStatus {
  if (liquidated) return 'Liquidated';
  if (repaid) {
    return funded ? 'ReadyToWithdraw' : 'Withdrawn';
  }
  return funded ? 'Funded' : 'Created';
}

export async function fetchUserOrders(user: Address): Promise<UserOrderSummary[]> {
  const nonce = (await readContract(wagmiConfig, {
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'nonces',
    args: [user],
    chainId: ETH_CHAIN_ID,
  })) as bigint;

  if (nonce === 0n) return [];

  const orders: UserOrderSummary[] = [];
  for (let i = 1n; i <= nonce; i++) {
    const orderId = keccak256(
      encodeAbiParameters(ORDER_ID_ABI, [user, i, BigInt(ETH_CHAIN_ID)])
    ) as `0x${string}`;

    try {
      const { owner, amountWei, funded, repaid, liquidated } = (await readContract(wagmiConfig, {
        address: ETH_COLLATERAL_OAPP_ADDR,
        abi: ETH_COLLATERAL_ABI,
        functionName: 'orders',
        args: [orderId],
        chainId: ETH_CHAIN_ID,
      })) as {
        owner: Address;
        amountWei: bigint;
        funded: boolean;
        repaid: boolean;
        liquidated: boolean;
      };

      if (owner?.toLowerCase?.() !== user.toLowerCase()) {
        // Skip entries that might not belong to the current user (shouldn't happen, but defensive).
        continue;
      }

      orders.push({
        orderId,
        amountWei,
        funded,
        repaid,
        liquidated,
        status: deriveStatus({ funded, repaid, liquidated }),
      });
    } catch (err) {
      console.error(`Failed to load order ${orderId}`, err);
    }
  }

  return orders.reverse();
}
