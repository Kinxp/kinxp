import { mcp } from "./mcp_client.js";
import { llmJson } from "./llm.js";

function explorerBase(chainId: number) {
  const map: Record<number, string> = {
    1: "https://eth.blockscout.com",
    10: "https://optimism.blockscout.com",
    137: "https://polygon.blockscout.com",
    8453: "https://base.blockscout.com",
    42161: "https://arbitrum.blockscout.com"
  };
  return (map[chainId] || "https://blockscout.com").replace(/\/$/, "");
}

function bundleLinks(chainId: number, txHash?: string, from?: string, to?: string) {
  const base = explorerBase(chainId);
  const links: string[] = [];
  if (txHash) links.push(`${base}/tx/${txHash}`);
  if (from) links.push(`${base}/address/${from}`);
  if (to) links.push(`${base}/address/${to}`);
  return links;
}

export async function explainTxMCP({ chainId, txHash }: { chainId: number; txHash: string; }) {
  const [summary, info, logs] = await Promise.all([
    mcp.transaction_summary(chainId, txHash),
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash)
  ]);

  const from = info?.from || info?.from_address || info?.from?.hash;
  const to = info?.to || info?.to_address || info?.to?.hash;

  const gasUsedNum = Number(info?.gas_used ?? 0);
  const ePriceNum = Number(info?.effective_gas_price ?? 0);
  const gasBig = Number.isFinite(gasUsedNum) ? BigInt(Math.max(0, Math.trunc(gasUsedNum))) : 0n;
  const priceBig = Number.isFinite(ePriceNum) ? BigInt(Math.max(0, Math.trunc(ePriceNum))) : 0n;
  const feeWei = (gasBig * priceBig).toString();
  const feeEth = (Number(feeWei) / 1e18).toFixed(8);

  const shaped = await llmJson(`
Return STRICT JSON:
{"method":string,"from":string,"to":string,"valueEther":string,"tokenTransfers":[{"symbol":string,"amount":string,"from":string,"to":string}],"risks":[string]}
SUMMARY=${JSON.stringify(summary)}
INFO=${JSON.stringify(info)}
LOGS=${JSON.stringify(logs)}
  `);

  return {
    method: shaped?.method || summary?.method || "unknown",
    from,
    to,
    valueEther: shaped?.valueEther ?? "0",
    tokenTransfers: Array.isArray(shaped?.tokenTransfers) ? shaped.tokenTransfers : [],
    risks: Array.isArray(shaped?.risks) ? shaped.risks : [],
    fee: { wei: feeWei, ether: feeEth },
    chainId,
    links: bundleLinks(chainId, txHash, from, to),
    raw: { summary, info, logs }
  };
}

export async function riskScanMCP({ chainId, address }: { chainId: number; address: string; }) {
  const now = new Date();
  const age_to = now.toISOString();
  const age_from = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();

  const [txs, toks] = await Promise.all([
    mcp.get_transactions_by_address(chainId, address, age_from, age_to, []),
    mcp.get_tokens_by_address(chainId, address)
  ]);

  const shaped = await llmJson(`
Summarize 7d risk for ${address} on chain ${chainId}.
Return STRICT JSON: {"bullets":[string],"links":[string]}
TXS=${JSON.stringify(txs)}
TOKENS=${JSON.stringify(toks)}
  `);

  return {
    bullets: Array.isArray(shaped?.bullets) ? shaped.bullets : ["No critical issues found."],
    links: [ `${explorerBase(chainId)}/address/${address}` ],
    raw: { txs, toks }
  };
}

export async function verifyMilestoneMCP({ xCondition }: { xCondition: any; }) {
  const chainId = Number(xCondition?.chainId);
  const txHash = String(xCondition?.txHash || "");
  if (!chainId || !txHash) {
    return { ok: false, reasons: ["xCondition.chainId/txHash required"], links: [] };
  }

  const [info, logs] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash)
  ]);

  const shaped = await llmJson(`
Validate milestone against X=${JSON.stringify(xCondition)} using INFO and LOGS.
Rules: ok=true only if target event exists, filters match, and confirmations >= minConfirmations (if provided).
Return STRICT JSON: { "ok": boolean, "reasons":[string], "links":[string], "confs": number }
INFO=${JSON.stringify(info)}
LOGS=${JSON.stringify(logs)}
  `);

  return {
    ok: !!shaped?.ok,
    reasons: Array.isArray(shaped?.reasons) ? shaped.reasons : [],
    links: bundleLinks(chainId, txHash, info?.from, info?.to),
    confs: Number(shaped?.confs) || undefined,
    raw: { info, logs }
  };
}
