// src/services/pythService.ts

const PYTH_HERMES_URL = 'https://hermes.pyth.network';
const ETH_USD_PRICE_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

// --- NEW: Define a return type for our function ---
export interface PythData {
  priceUpdateData: `0x${string}`[];
  scaledPrice: bigint; // Price with 18 decimals
}

/**
 * Fetches the latest price update data and the parsed price from Pyth.
 */
export async function fetchPythUpdateData(): Promise<PythData> {
  // Use `parsed=true` to get the human-readable price info as well
  const url = `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${ETH_USD_PRICE_ID}&encoding=hex&parsed=true`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pyth API request failed: ${response.statusText}`);
    const data = await response.json();

    // Error checking
    if (!data?.binary?.data?.length) throw new Error("No binary price update data found in Pyth API response.");
    if (!data?.parsed?.[0]?.price?.price) throw new Error("No parsed price data found in Pyth API response.");

    // Get the raw data for the transaction
    const priceUpdateData = data.binary.data.map((d: string) => `0x${d}`);
    
    // --- NEW: Parse and scale the price, just like the script ---
    const parsed = data.parsed[0].price;
    const price = BigInt(parsed.price);
    const expo = Number(parsed.expo);
    
    const targetDecimals = 18;
    const expDiff = targetDecimals + expo;
    const scaledPrice = expDiff >= 0 ? price * (10n ** BigInt(expDiff)) : price / (10n ** BigInt(-expDiff));

    console.log("Successfully fetched Pyth price data.");
    return { priceUpdateData, scaledPrice };

  } catch (error) {
    console.error("Error fetching from Pyth API:", error);
    throw error;
  }
}