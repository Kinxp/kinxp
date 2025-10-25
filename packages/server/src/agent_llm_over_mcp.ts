import { mcpRest as mcp } from "./mcp_rest.js";

// ---------- helpers ----------
function explorerBase(chainId) {
  const map = {
    1: "https://eth.blockscout.com",
    10: "https://optimism.blockscout.com",
    137: "https://polygon.blockscout.com",
    8453: "https://base.blockscout.com",
    42161: "https://arbitrum.blockscout.com",
    11155111: "https://eth-sepolia.blockscout.com",
  };
  return (map[chainId] || "https://blockscout.com").replace(/\/$/, "");
}
function links(chainId, tx, from, to) {
  const base = explorerBase(chainId);
  const out = [];
  if (tx) out.push(`${base}/tx/${tx}`);
  if (from) out.push(`${base}/address/${from}`);
  if (to) out.push(`${base}/address/${to}`);
  return out;
}
function toBI(v) {
  if (v === null || v === undefined) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
    if (/^\d+$/.test(s)) return BigInt(s);
  }
  return 0n;
}
function formatEther(wei) {
  try {
    let w = toBI(wei);
    const neg = w < 0n;
    if (neg) w = -w;
    const s = w.toString().padStart(19, "0");
    const whole = s.slice(0, -18) || "0";
    let frac = s.slice(-18).replace(/0+$/, "");
    const out = (neg ? "-" : "") + whole + (frac ? "." + frac : "");
    // clamp to readable precision
    return out.includes(".")
      ? out.split(".")[0] + "." + out.split(".")[1].slice(0, 8).replace(/0+$/, "").replace(/\.$/, "")
      : out;
  } catch {
    return "0";
  }
}

// Extract decoded ERC20 transfers when Blockscout provides them.
// We won’t use these to display the collateral amount for “Funded”;
// that always comes from the order’s amount, not from logs.
function extractTokenTransfers(logs) {
  const out = [];
  if (!Array.isArray(logs)) return out;
  for (const l of logs) {
    const name = l?.decoded?.name || l?.name;
    if (name !== "Transfer") continue;
    const params = l?.decoded?.params || l?.params || [];
    const p = (k) => {
      const f = params.find((x) => (x?.name || "").toLowerCase() === k);
      return f?.value ?? null;
    };
    const vRaw = p("value");
    // try to detect token metadata if blockscout includes it
    const symbol =
      l?.token?.symbol ||
      l?.asset?.symbol ||
      (l?.address && l.address.toLowerCase() === "0x0000000000000000000000000000000000000000" ? "ETH" : undefined) ||
      "TOKEN";
    const decimals =
      Number(l?.token?.decimals ?? l?.asset?.decimals) || (symbol === "ETH" ? 18 : 18);

    // scale value to human
    let amount = "0";
    try {
      const v = toBI(vRaw);
      const s = v.toString().padStart(decimals + 1, "0");
      const whole = s.slice(0, -decimals) || "0";
      let frac = s.slice(-decimals).replace(/0+$/, "");
      amount = frac ? `${whole}.${frac}` : whole;
    } catch {
      amount = "0";
    }
    out.push({
      symbol,
      amount,
      from: p("from") || undefined,
      to: p("to") || undefined,
    });
  }
  return out;
}

// ---------- public API (deterministic; no LLM used for numbers) ----------
export async function explainTxLLM_MCP({ chainId, txHash }) {
  const [info, logs, summary] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
    mcp.transaction_summary(chainId, txHash),
  ]);

  const from =
    info?.from ||
    summary?.from ||
    info?.sender ||
    (typeof info?.tx === "object" ? info.tx.from : undefined) ||
    undefined;
  const to =
    info?.to ||
    summary?.to ||
    (typeof info?.tx === "object" ? info.tx.to : undefined) ||
    undefined;

  const method =
    info?.method ||
    info?.method_id ||
    info?.input_method ||
    summary?.method ||
    (typeof info?.tx === "object" ? info.tx?.method : undefined) ||
    "";

  const valueWei = toBI(info?.value ?? summary?.value);
  const gasUsed = toBI(info?.gas_used ?? info?.gasUsed ?? summary?.gas_used);
  const gasPrice =
    toBI(info?.gas_price ?? info?.gasPrice ?? info?.effective_gas_price ?? summary?.gas_price);
  const feeWei = gasUsed * gasPrice;

  const tokenTransfers = extractTokenTransfers(logs);

  return {
    method: String(method || ""),
    from: from || "",
    to: to || "",
    valueEther: formatEther(valueWei),
    tokenTransfers,
    feeEther: formatEther(feeWei),
    risks: [],
    chainId,
    links: links(chainId, txHash, from, to),
    raw: { summary, info, logs },
  };
}

export async function riskScanLLM_MCP({ chainId, address }) {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();

  const [txs, toks] = await Promise.all([
    mcp.get_transactions_by_address(chainId, address, from, to),
    mcp.get_tokens_by_address(chainId, address),
  ]);

  // keep this endpoint simple & deterministic too
  return {
    bullets: [
      `Scanned ${Array.isArray(txs) ? txs.length : 0} txs in the last 7d.`,
      `Holding ${Array.isArray(toks) ? toks.length : 0} tokens.`,
    ],
    links: [`${explorerBase(chainId)}/address/${address}`],
    raw: { txs, toks },
  };
}

export async function verifyMilestoneLLM_MCP({ xCondition }) {
  const chainId = Number(xCondition?.chainId);
  const txHash = String(xCondition?.transaction_hash || xCondition?.txHash || "");
  if (!chainId || !txHash) return { ok: false, reasons: ["chainId/transaction_hash required"], links: [] };

  const [info, logs] = await Promise.all([
    mcp.get_transaction_info(chainId, txHash, true),
    mcp.get_transaction_logs(chainId, txHash),
  ]);

  // naive confirmation heuristic (no LLM)
  const confirmations =
    Number(info?.confirmations ?? info?.tx?.confirmations ?? 0) || 0;
  const ok = confirmations >= 1;

  return {
    ok,
    reasons: ok ? [] : ["not enough confirmations"],
    confs: confirmations,
    links: [`${explorerBase(chainId)}/tx/${txHash}`],
    raw: { info, logs },
  };
}
