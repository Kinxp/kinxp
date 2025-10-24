// src/services/blockscoutService.ts

import { HEDERA_BLOCKSCOUT_API_URL, HEDERA_CREDIT_OAPP_ADDR, HEDERA_ORDER_OPENED_TOPIC } from "../config";

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