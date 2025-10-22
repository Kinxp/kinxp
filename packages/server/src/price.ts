// src/price.ts

/**
 * Fetch ETH/USD from Pyth Hermes v2 (if configured).
 * Returns { price, source } where price is a Number (e.g., 2623.45)
 * Safe to call even if PYTH_* env vars are missing—will just return { price: undefined }.
 */
export async function getEthUsdFromPyth(): Promise<{ price?: number; source: string }> {
  const endpoint = process.env.PYTH_ENDPOINT;
  const id = process.env.PYTH_PRICE_ID_USD;
  if (!endpoint || !id) return { price: undefined, source: "manual-or-missing" };

  try {
    const base = endpoint.replace(/\/$/, "");
    const res = await fetch(`${base}/v2/price_feeds/${id}`);
    if (!res.ok) return { price: undefined, source: `pyth-http-${res.status}` };
    const j: any = await res.json();

    // Try object shape
    const p = j?.price?.price ?? j?.ema_price?.price ?? j?.parsed?.price ?? j?.parsed?.ema_price;
    const expo = j?.price?.expo ?? j?.ema_price?.expo ?? j?.parsed?.expo ?? j?.parsed?.ema_expo;

    if (typeof p === "number" && typeof expo === "number") {
      // Pyth uses negative exponents typically (e.g., expo = -8)
      const price = p * Math.pow(10, expo);
      if (isFinite(price) && price > 0) return { price, source: "pyth" };
    }

    // Try array shape (some gateways wrap in a list)
    if (Array.isArray(j) && j.length) {
      const it = j[0];
      const p2 = it?.price?.price;
      const e2 = it?.price?.expo;
      if (typeof p2 === "number" && typeof e2 === "number") {
        const price = p2 * Math.pow(10, e2);
        if (isFinite(price) && price > 0) return { price, source: "pyth" };
      }
    }
  } catch {
    // fall through
  }
  return { price: undefined, source: "pyth-unavailable" };
}
