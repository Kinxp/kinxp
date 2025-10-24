// src/services/blockscoutService.ts

import { HEDERA_BLOCKSCOUT_API_URL, HEDERA_CREDIT_OAPP_ADDR, HEDERA_ORDER_OPENED_TOPIC } from "../config";

/**
 * Polls the Hedera Blockscout API to check if the HederaOrderOpened event has been emitted
 * for a specific, exact orderId.
 * @param orderId The order ID to check for.
 * @returns A promise that resolves to true if the event is found, false otherwise.
 */
export async function pollForHederaOrderOpened(orderId: `0x${string}`): Promise<boolean> {
  // --- THIS IS THE FIX ---
  // We now include topic1 in the API query to ask for a specific orderId.
  const topic1WithoutPrefix = orderId.startsWith('0x') ? orderId.substring(2) : orderId;
  const params = new URLSearchParams({
    module: 'logs',
    action: 'getLogs',
    address: HEDERA_CREDIT_OAPP_ADDR,
    topic0: HEDERA_ORDER_OPENED_TOPIC,
    topic1: topic1WithoutPrefix, // This makes the query highly specific
    topic0_1_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });

  const url = `${HEDERA_BLOCKSCOUT_API_URL}?${params.toString()}`;

  // Log the new, more specific URL for debugging
  console.log("Polling Blockscout with specific URL:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Blockscout API request failed:", response.status, response.statusText);
      return false;
    }

    const data = await response.json();

    // With this specific query, we no longer need to filter on the client side.
    // We only need to check if the API found any results at all.
    // A status of '1' and a non-empty result array means our event was found.
    if (data.status === '1' && Array.isArray(data.result) && data.result.length > 0) {
      console.log("SUCCESS: Blockscout API found a matching event for our orderId!");
      return true;
    }
    
    // Status '0' or an empty result array means the event has not been indexed yet.
    return false;

  } catch (error) {
    console.error("Error fetching or parsing from Blockscout API:", error);
    return false;
  }
}