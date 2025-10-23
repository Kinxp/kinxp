const BASE = (process.env.MCP_REST_BASE || "").replace(/\/$/, "");
if (!BASE) throw new Error("MCP_REST_BASE not configured");

function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.set(k, String(v));
  }
  return u.toString();
}

async function get(path: string, params: Record<string, any>) {
  const url = `${BASE}${path.startsWith("/") ? path : "/" + path}?${qs(params)}`;
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`[MCP-REST] ${path} ${r.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const mcpRest = {
  get_latest_block: (chain_id: number) =>
    get("/v1/get_latest_block", { chain_id }),

  get_transaction_info: (chain_id: number, transaction_hash: string, include_raw_input = true) =>
    get("/v1/get_transaction_info", { chain_id, transaction_hash, include_raw_input }),

  get_transaction_logs: (chain_id: number, transaction_hash: string) =>
    get("/v1/get_transaction_logs", { chain_id, transaction_hash }),

  transaction_summary: (chain_id: number, transaction_hash: string) =>
    get("/v1/transaction_summary", { chain_id, transaction_hash }),

  get_tokens_by_address: (chain_id: number, address: string) =>
    get("/v1/get_tokens_by_address", { chain_id, address }),

  get_transactions_by_address: (
    chain_id: number,
    address: string,
    age_from?: string,
    age_to?: string,
    methods?: string | string[],
    extraParams?: Record<string, any>
  ) => {
    const methodsParam = Array.isArray(methods) ? methods.join(",") : methods;
    return get("/v1/get_transactions_by_address", {
      chain_id,
      address,
      age_from,
      age_to,
      methods: methodsParam,
      ...(extraParams || {})
    });
  },
};
