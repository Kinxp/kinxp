const MCP_HTTP_URL = (process.env.MCP_HTTP_URL || "").replace(/\/$/, "");

if (!MCP_HTTP_URL) {
  console.warn("[MCP] MCP_HTTP_URL not set; MCP routes will 500");
}

async function callTool(tool: string, args: Record<string, any>): Promise<any> {
  if (!MCP_HTTP_URL) throw new Error("MCP_HTTP_URL not configured");
  const res = await fetch(MCP_HTTP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, args })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[MCP] ${tool} failed ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const mcp = {
  transaction_summary: (chain_id: number, hash: string) =>
    callTool("transaction_summary", { chain_id, hash }),

  get_transaction_logs: (chain_id: number, hash: string, cursor?: string) =>
    callTool("get_transaction_logs", { chain_id, hash, cursor }),

  get_transaction_info: (chain_id: number, hash: string, include_raw_input = true) =>
    callTool("get_transaction_info", { chain_id, hash, include_raw_input }),

  get_tokens_by_address: (chain_id: number, address: string, cursor?: string) =>
    callTool("get_tokens_by_address", { chain_id, address, cursor }),

  get_transactions_by_address: (
    chain_id: number, address: string, age_from: string, age_to: string, methods: string[] = [], cursor?: string
  ) =>
    callTool("get_transactions_by_address", { chain_id, address, age_from, age_to, methods, cursor }),

  get_contract_abi: (chain_id: number, address: string) =>
    callTool("get_contract_abi", { chain_id, address }),
};
