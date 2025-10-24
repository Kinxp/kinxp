// src/services/blockscoutService.ts
import { multicall } from 'wagmi/actions';
// --- THIS IS THE FIX ---
// Add 'pad' and 'toHex' to the import statement from viem
import { decodeAbiParameters, pad, toHex } from 'viem';
import { config as wagmiConfig } from '../wagmi';
import { UserOrderSummary, OrderStatus } from '../types';

import {
  ETH_CHAIN_ID,
  ETH_COLLATERAL_ABI,
  ETH_COLLATERAL_OAPP_ADDR,
  SEPOLIA_BLOCKSCOUT_API_URL,
  MARK_REPAID_TOPIC,
  ORDER_CREATED_TOPIC,
  HEDERA_BLOCKSCOUT_API_URL,
  HEDERA_CREDIT_OAPP_ADDR,
  HEDERA_ORDER_OPENED_TOPIC
} from "../config";
/**
 * Polls the Hedera Blockscout API using a highly specific query that has been proven to work.
 * @param orderId The order ID to check for (e.g., '0x...').
 * @returns A promise that resolves to true if the event is found, false otherwise.
 */
export async function pollForHederaOrderOpened(orderId: `0x${string}`): Promise<boolean> {

  // Construct the URL with all required parameters for a specific topic query.
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address: HEDERA_CREDIT_OAPP_ADDR,
    topic0: HEDERA_ORDER_OPENED_TOPIC,
    topic1: orderId, // Use the prefix-less version
    topic0_1_opr: 'and',         // The required logical operator
    fromBlock: '0',              // Required parameter
    toBlock: 'latest',           // Required parameter
  });

  const url = `${HEDERA_BLOCKSCOUT_API_URL}?${params.toString()}`;

  // Log the exact URL for verification
  console.log("Polling Blockscout with PROVEN specific URL:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Blockscout API request failed:", response.status, response.statusText);
      return false;
    }

    const data = await response.json();

    // With this specific query, we just need to check if the API found any results.
    // A status of '1' and a non-empty result array means our event was found.
    if (data.status === '1' && Array.isArray(data.result) && data.result.length > 0) {
      console.log("SUCCESS: Blockscout API found a matching event for our specific orderId!");
      return true;
    }
    
    // Status '0' means the specific event has not been indexed yet. This is normal during polling.
    return false;

  } catch (error) {
    console.error("Error fetching or parsing from Blockscout API:", error);
    return false;
  }
}

/**
 * Fetches all orders associated with a user wallet.
 * @param userAddress The EVM address of the user.
 * @returns A promise that resolves to an array of UserOrderSummary objects.
 */
export async function fetchAllUserOrders(userAddress: `0x${string}`): Promise<UserOrderSummary[]> {
  
  const paddedUserAddress = `0x${userAddress.substring(2).padStart(64, '0')}`;
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address: HEDERA_CREDIT_OAPP_ADDR,
    topic0: HEDERA_ORDER_OPENED_TOPIC,
    topic2: paddedUserAddress,
    topic0_2_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });
  const url = `${HEDERA_BLOCKSCOUT_API_URL}?${params.toString()}`;
  console.log(url)
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Blockscout API request failed: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.message !== 'OK' || !Array.isArray(data.result) || data.result.length === 0) {
    console.log("No orders found for this user on Hedera Blockscout.");
    return [];
  }
  console.log(data)
  const hederaOrders = data.result.map((log: any) => {
    const [amountWei] = decodeAbiParameters([{ type: 'uint256', name: 'ethAmountWei' }], log.data);
    return { orderId: log.topics[1] as `0x${string}`, amountWei: amountWei as bigint };
  });

  if (hederaOrders.length === 0) {
    return [];
  }

  const ethContractCalls = hederaOrders.map(order => ({
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'orders',
    args: [order.orderId],
  }));

  const ethOrderStates = await multicall(wagmiConfig, {
    chainId: ETH_CHAIN_ID,
    contracts: ethContractCalls,
    allowFailure: true,
  });

  // --- THIS IS THE CORRECTED LOGIC BLOCK ---
  const combinedOrders: UserOrderSummary[] = hederaOrders.map((hOrder, index) => {
    const ethState = ethOrderStates[index];
    let status: OrderStatus = 'Created'; // Default status

    if (ethState.status === 'success' && ethState.result) {
      // Use the correct fields: funded, repaid, liquidated
      const ethData = ethState.result as { amountWei: bigint, owner: string, funded: boolean, repaid: boolean, liquidated: boolean };
      
      // Determine the status based on the contract's actual logic.
      // The order of these checks is important.
      if (ethData.liquidated) {
        status = 'Liquidated';
      } else if (ethData.repaid && !ethData.funded) {
        // The `withdraw` function sets `funded` to false, so this means withdrawn.
        status = 'Withdrawn';
      } else if (ethData.repaid && ethData.funded) {
        status = 'ReadyToWithdraw';
      } else if (ethData.funded) {
        status = 'Funded';
      }
      // If none of the above, it remains in the default 'Created' state.
    } else {
      console.warn(`Could not fetch on-chain status for order ${hOrder.orderId}`);
    }
    return {
      orderId: hOrder.orderId,
      amountWei: hOrder.amountWei,
      status: status,
    };
  });
  console.log(combinedOrders)

  return combinedOrders;
}

/**
 * Fetches only the orders that have been created on Sepolia but not yet funded.
 * It does this by finding all 'OrderCreated' events and filtering out any that
 * already appear in the list of funded/active orders.
 * @param userAddress The user's wallet address.
 * @param existingOrderIds A set of order IDs that are already known to be funded or closed.
 * @returns A promise that resolves to an array of UserOrderSummary objects with 'Created' status.
 */
export async function fetchCreatedOrdersFromSepolia(
  userAddress: `0x${string}`,
  existingOrderIds: Set<string>
): Promise<UserOrderSummary[]> {
  
  const paddedUserAddress = `0x${userAddress.substring(2).padStart(64, '0')}`;

  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address: ETH_COLLATERAL_OAPP_ADDR,
    topic0: ORDER_CREATED_TOPIC,
    topic2: paddedUserAddress, // The user address is the second indexed topic
    topic0_2_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });

  const url = `${SEPOLIA_BLOCKSCOUT_API_URL}?${params.toString()}`;
  console.log("Fetching CREATED orders from Sepolia URL:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch created orders from Sepolia Blockscout");
    
    const data = await response.json();
    if (data.message !== 'OK' || !Array.isArray(data.result) || data.result.length === 0) {
      return [];
    }

    const createdOrders: UserOrderSummary[] = data.result.map((log: any) => ({
      orderId: log.topics[1] as `0x${string}`,
      amountWei: 0n, // Amount is 0 until funded
      status: 'Created',
    }));

    // Filter out any orders that we already fetched from the Hedera-based list.
    // This prevents duplicates if Blockscout indexing is slightly delayed.
    return createdOrders.filter(order => !existingOrderIds.has(order.orderId));

  } catch (error) {
    console.error("Error fetching created orders from Sepolia:", error);
    return [];
  }
}
/**
 * Polls the Sepolia Blockscout API for a specific MarkRepaid event by its orderId.
 * @param orderId The order ID to check for.
 * @returns A promise that resolves to an object with the event data if found, otherwise null.
 */
export async function pollForSepoliaRepayEvent(orderId: `0x${string}`): Promise<{ orderId: `0x${string}` } | null> {
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address: ETH_COLLATERAL_OAPP_ADDR,
    topic0: MARK_REPAID_TOPIC,
    topic1: orderId,
    topic0_1_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });

  const url = `${SEPOLIA_BLOCKSCOUT_API_URL}?${params.toString()}`;
  console.log("Polling Sepolia Blockscout with URL:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Sepolia Blockscout API request failed:", response.status, response.statusText);
      return null; // Return null on failure
    }

    const data = await response.json();

    if (data.message === 'OK' && Array.isArray(data.result) && data.result.length > 0) {
      const log = data.result[0];
      const foundOrderId = log.topics[1] as `0x${string}`;
      console.log(`SUCCESS: Sepolia Blockscout found a matching MarkRepaid event for ${foundOrderId.slice(0,10)}...`);
      // Return the found data instead of just 'true'
      return { orderId: foundOrderId };
    }

    // Return null if the event is not found yet
    return null;

  } catch (error) {
    console.error("Error fetching from Sepolia Blockscout API:", error);
    return null; // Return null on error
  }
}