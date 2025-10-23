import { mcpRest as mcp } from "./mcp_rest.js";
import { ollamaJson } from "./ollama.js";

function explorerBase(chainId: number) {
  const map: Record<number, string> = {
    1: "https://eth.blockscout.com",
    10: "https://optimism.blockscout.com",
    137: "https://polygon.blockscout.com",
    8453: "https://base.blockscout.com",
    42161: "https://arbitrum.blockscout.com",
  };
  return (map[chainId] || "https://blockscout.com").replace(/\/$/, "");
}

function links(chainId: number, tx?: string, from?: string, to?: string) {
  const base = explorerBase(chainId);
  const out: string[] = [];
  if (tx) out.push(`${base}/tx/${tx}`);
  if (from) out.push(`${base}/address/${from}`);
  if (to) out.push(`${base}/address/${to}`);
  return out;
}

export async function explainTxLLM_MCP({ chainId, tx  Hash }: { chainId: number; txHash: string; }) {
  const [info, logs, summary] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
    mcp.transaction_summary(chainId, txHash), 
  ]);

  const prompt = `
You are a blockchain analyst. Using these three JSON blobs from Blockscout MCP:
INFO=${JSON.stringify(info)}
LOGS=${JSON.stringify(logs)}
SUMMARY=${JSON.stringify(summary)}

Return STRICT JSON with keys:
{
  "method": string,
  "from": string,
  "to": string,
  "valueEther": string,
  "tokenTransfers": [{"symbol":string,"amount":string,"from":string,"to":string}],
  "feeEther": string,
  "risks": [string]
}
If data is missing, fill with safe defaults. Do not add extra keys.`;

  const shaped: any = await ollamaJson(prompt);
  const from = shaped?.from;
  const to = shaped?.to;

  return {
    ...shaped,
    chainId,
    links: links(chainId, txHash, from, to),
    raw: { summary, info, logs }
  };
}

export async function riskScanLLM_MCP({ chainId, address }: { chainId: number; address: string; }) {
  const now = new Date(); const to = now.toISOString();
  const from = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();

  const [txs, toks] = await Promise.all([
    mcp.get_transactions_by_address(chainId, address, from, to),
    mcp.get_tokens_by_address(chainId, address),
  ]);

  const prompt = `
You are a blockchain risk analyst. Analyze TRANSACTIONS and TOKENS for address ${address} on chain ${chainId}.
Return STRICT JSON:
{"bullets":[string],"links":[string]}
TRANSACTIONS=${JSON.stringify(txs)}
TOKENS=${JSON.stringify(toks)}
`;

  const shaped: any = await ollamaJson(prompt);
  if (!Array.isArray(shaped?.links)) shaped.links = [];
  shaped.links.push(`${explorerBase(chainId)}/address/${address}`);
  return shaped;
}

export async function verifyMilestoneLLM_MCP({ xCondition }: { xCondition: any; }) {
  const chainId = Number(xCondition?.chainId);
  const txHash = String(xCondition?.transaction_hash || xCondition?.txHash || "");
  if (!chainId || !txHash) return { ok: false, reasons: ["chainId/transaction_hash required"], links: [] };

  const [info, logs] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
  ]);

  const prompt = `
Validate milestone condition X against INFO and LOGS.
X=${JSON.stringify(xCondition)}
INFO=${JSON.stringify(info)}
LOGS=${JSON.stringify(logs)}

Return STRICT JSON:
{"ok":boolean,"reasons":[string],"confs":number}
`;

  const shaped: any = await ollamaJson(prompt);
  return {
    ok: !!shaped?.ok,
    reasons: Array.isArray(shaped?.reasons) ? shaped.reasons : [],
    confs: Number(shaped?.confs) || undefined,
    links: [
      `${explorerBase(chainId)}/tx/${txHash}`
    ],
    raw: { info, logs }
  };
}
