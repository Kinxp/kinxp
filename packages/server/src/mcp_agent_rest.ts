import { mcpRest as mcp } from "./mcp_rest.js";

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
  const b = explorerBase(chainId);
  const out: string[] = [];
  if (tx) out.push(`${b}/tx/${tx}`);
  if (from) out.push(`${b}/address/${from}`);
  if (to) out.push(`${b}/address/${to}`);
  return out;
}

export async function explainTxREST({ chainId, txHash }: { chainId: number; txHash: string; }) {
  const [info, logs, summary] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
    mcp.transaction_summary(chainId, txHash),
  ]);

  const data = info?.data ?? info ?? {};
  const from = data.from || data.from_address || data?.from?.hash;
  const to = data.to || data.to_address || data?.to?.hash;
  const gasUsed = Number(data.gas_used ?? 0);
  const ePrice = Number(data.effective_gas_price ?? 0);
  const feeWei = String(BigInt(gasUsed || 0) * BigInt(ePrice || 0));
  const feeEth = (Number(feeWei) / 1e18).toFixed(8);
  const valueWei = data.value ?? "0";

  return {
    method: summary?.data?.method || data.method || "unknown",
    from,
    to,
    valueEther: valueWei ? String(Number(valueWei) / 1e18) : "0",
    tokenTransfers: data.token_transfers || [],
    fee: { wei: feeWei, ether: feeEth },
    risks: [],
    chainId,
    links: links(chainId, txHash, from, to),
    raw: { summary, info, logs },
  };
}

export async function riskScanREST({ chainId, address }: { chainId: number; address: string; }) {
  const now = new Date(); const to = now.toISOString();
  const from = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();

  const [txs, toks] = await Promise.all([
    mcp.get_transactions_by_address(chainId, address, from, to),
    mcp.get_tokens_by_address(chainId, address),
  ]);

  const items = txs?.data?.items || txs?.items || [];
  const approvals = items.filter((t: any) => /approve|approval/i.test(t?.method || ""));
  const largeOut = items.filter((t: any) => Number(t?.value || 0) > 1e20).length;

  const bullets: string[] = [];
  if (approvals.length) bullets.push(`Found ${approvals.length} approval txs in last 7d.`);
  if (largeOut) bullets.push(`Detected ${largeOut} large outflows.`);
  if (!bullets.length) bullets.push("No obvious risks detected (basic checks).");

  return {
    bullets,
    links: [ `${explorerBase(chainId)}/address/${address}` ],
    raw: { txs, toks },
  };
}

export async function verifyMilestoneREST({ xCondition }: { xCondition: any; }) {
  const chainId = Number(xCondition?.chainId);
  const txHash = String(xCondition?.txHash || "");
  if (!chainId || !txHash) {
    return { ok: false, reasons: ["xCondition.chainId and xCondition.txHash required"], links: [] };
  }

  const [info, logs] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
  ]);

  const data = info?.data ?? info ?? {};
  const from = data.from || data.from_address || data?.from?.hash;
  const to = data.to || data.to_address || data?.to?.hash;
  const confs = Number(data?.confirmations ?? data?.confs ?? 0);
  const minConf = Number(xCondition?.minConfirmations ?? 0);

  const reasons: string[] = [];
  let ok = true;

  if (minConf && confs < minConf) {
    ok = false;
    reasons.push(`Confirmations ${confs} is below required minimum ${minConf}.`);
  }

  return {
    ok,
    reasons: reasons.length ? reasons : ["Manual verification recommended."],
    links: links(chainId, txHash, from, to),
    confs,
    chainId,
    raw: { info, logs },
  };
}
