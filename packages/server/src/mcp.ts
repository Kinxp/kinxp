import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MCP_URL = process.env.BLOCKSCOUT_MCP_URL || "https://mcp.blockscout.com/mcp";

export async function explainTx({ chainId, txHash }: { chainId: number; txHash: string; }) {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: `Explain transaction ${txHash} on chain ${chainId}. Use transaction_summary and get_transaction_logs. Return JSON with keys: method, transfers, fee, risks[], links[].` }
  ];
  const resp: any = await anthropic.messages.create({
    model: "claude-3-7-sonnet-latest",
    max_tokens: 1000,
    // NOTE: Some SDKs expose MCP servers under different fields; adapt if needed.
    // @ts-expect-error - MCP attachment is under active development; adjust per current docs.
    mcp_servers: [{ type: "http", url: MCP_URL }],
    messages
  });
  return unwrap(resp);
}

export async function riskScan({ chainId, address }: { chainId: number; address: string; }) {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: `For ${address} on chain ${chainId} in last 7d: get_transactions_by_address & get_tokens_by_address. Flag unlimited approvals, large novel outflows, risky tags. Return JSON { bullets[], links[] }.` }
  ];
  const resp: any = await anthropic.messages.create({
    model: "claude-3-7-sonnet-latest",
    max_tokens: 1100,
    // @ts-expect-error - see note above
    mcp_servers: [{ type: "http", url: MCP_URL }],
    messages
  });
  return unwrap(resp);
}

export async function verifyMilestone(xCondition: any) {
  const prompt = `Verify X-Condition: ${JSON.stringify(xCondition)}. Use transaction_summary, get_transaction_logs, get_contract_abi if needed. Return JSON { ok:boolean, reasons[], links[], confs:number }.`;
  const resp: any = await anthropic.messages.create({
    model: "claude-3-7-sonnet-latest",
    max_tokens: 1200,
    // @ts-expect-error - see note above
    mcp_servers: [{ type: "http", url: MCP_URL }],
    messages: [{ role: "user", content: prompt }]
  });
  return unwrap(resp);
}

function unwrap(resp: any) {
  // Minimal helper to pull text/JSON out of the SDK response. Adjust as needed.
  try {
    const tool = resp?.content?.[0]?.text || resp;
    return typeof tool === "string" ? JSON.parse(safeJson(tool)) : tool;
  } catch (e) {
    return { raw: resp };
  }
}
function safeJson(t: string){
  const s = t.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >=0 && end >=0 ? s.slice(start, end+1) : "{}";
}
