const BASE = (process.env.BLOCKSCOUT_API_BASE || "").replace(/\/$/, "");

export async function fetchTx(hash: string) {
  ensureBase();
  const response = await fetch(`${BASE}/api/v2/transactions/${hash}`);
  if (!response.ok) {
    throw new Error(`tx fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchAddressTxs(address: string, page = 1) {
  ensureBase();
  const response = await fetch(`${BASE}/api/v2/addresses/${address}/transactions?page=${page}`);
  if (!response.ok) {
    throw new Error(`addr txs fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchTokensByAddress(address: string) {
  ensureBase();
  const response = await fetch(`${BASE}/api/v2/addresses/${address}/tokens`);
  if (!response.ok) {
    throw new Error(`addr tokens fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function ensureBase() {
  if (!BASE) {
    throw new Error("BLOCKSCOUT_API_BASE not configured");
  }
}
