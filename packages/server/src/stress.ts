// src/stress.ts
import { mcpRest as mcp } from "./mcp_rest.js";
import { explorerBase } from "./config.js";

const DEBUG = (process.env.STRESS_DEBUG || "").trim() === "1";
const MCP_BASE = (process.env.MCP_REST_BASE || "").trim();

const log = (...a: any[]) => { if (DEBUG) console.log("[STRESS]", ...a); };

// ---------- env helpers ----------
function explodeList(val?: string): string[] {
  if (!val) return [];
  return val.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}
function envList(prefix: string, chainId: number): string[] {
  const env = process.env as Record<string, string | undefined>;
  const merged = [env[`${prefix}_${chainId}`], env[prefix]].filter(Boolean).join(",");
  const list = explodeList(merged).map((s) => s.toLowerCase());
  return Array.from(new Set(list));
}
function minutesAgoISO(mins: number) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString();
}

// ---------- normalizers ----------
function pick<T = any>(...vals: any[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v as T;
  return undefined;
}
function normAddr(x: any): string {
  const s = pick<string>(x?.hash, x?.address, x?.addr, typeof x === "string" ? x : undefined);
  return (s || "").toLowerCase();
}
function getMethod(t: any): string {
  return (
    pick<string>(
      t?.method,
      t?.data?.method,
      t?.summary?.method,
      t?.decoded_call?.name,
      t?.decoded_input?.name,
      t?.input?.function_name
    ) || ""
  );
}
function getTo(t: any): string {
  return (normAddr(t?.to) || normAddr(t?.to_address) || (t?.to ? String(t?.to).toLowerCase() : "") || "").toLowerCase();
}
function getFrom(t: any): string {
  return (normAddr(t?.from) || normAddr(t?.from_address) || (t?.from ? String(t?.from).toLowerCase() : "") || "").toLowerCase();
}
function getValueWei(t: any): bigint {
  const raw = pick<any>(t?.value, t?.data?.value, t?.msg_value, t?.eth_value_wei, t?.transfer_value_wei);
  try {
    if (typeof raw === "string") return BigInt(raw);
    if (typeof raw === "number") return BigInt(Math.trunc(raw));
    if (typeof raw === "bigint") return raw;
  } catch {}
  return 0n;
}
function weiToEthNum(wei: bigint): number {
  const s = wei.toString();
  if (s.length <= 18) return Number(`0.${"0".repeat(18 - s.length)}${s}`.replace(/0+$/, "")) || 0;
  const int = s.slice(0, s.length - 18);
  const frac = s.slice(s.length - 18).replace(/0+$/, "");
  return Number(frac ? `${int}.${frac}` : int);
}

// ---------- fetch with multi-stage fallback ----------
type AttemptRow = {
  kind: "liquidation" | "dex" | "cex";
  addr: string;
  methods?: string;
  age_from: string;
  age_to: string;
  http_ok: boolean;
  items?: number;
  ms: number;
  error?: string;
};

async function callOnce(
  kind: AttemptRow["kind"],
  chainId: number,
  addr: string,
  from: string,
  to: string,
  methods?: string
) {
  const t0 = Date.now();
  try {
    const txs = await mcp.get_transactions_by_address(chainId, addr, from, to, methods);
    const ms = Date.now() - t0;
    const items = pick<any[]>(txs?.data?.items, txs?.items, txs?.result, txs?.data) || [];
    const okRow: AttemptRow = { kind, addr, methods, age_from: from, age_to: to, http_ok: true, items: items.length, ms };
    log("OK", okRow);
    return { items, row: okRow };
  } catch (e: any) {
    const ms = Date.now() - t0;
    const errMsg = String(e?.message || e);
    const errRow: AttemptRow = { kind, addr, methods, age_from: from, age_to: to, http_ok: false, ms, error: errMsg };
    log("ERR", errRow);
    return { items: [] as any[], row: errRow };
  }
}

async function tryGetTxs(
  kind: AttemptRow["kind"],
  chainId: number,
  addr: string,
  windowMins: number,
  methods?: string,
  doChunked = false
): Promise<{ items: any[]; attempts: AttemptRow[] }> {
  const attempts: AttemptRow[] = [];

  // 1) First attempt: full window
  {
    const from = minutesAgoISO(windowMins);
    const to = new Date().toISOString();
    const { items, row } = await callOnce(kind, chainId, addr, from, to, methods);
    attempts.push(row);
    if (row.http_ok) return { items, attempts };
    // if it's not a timeout-ish error, bail early
    if (!/524|timeout|timed out|Time-out/i.test(row.error || "")) {
      return { items: [], attempts };
    }
  }

  // 2) Second attempt: half window (min 10m)
  {
    const half = Math.max(10, Math.floor(windowMins / 2));
    const from = minutesAgoISO(half);
    const to = new Date().toISOString();
    const { items, row } = await callOnce(kind, chainId, addr, from, to, methods);
    attempts.push(row);
    if (row.http_ok) return { items, attempts };
  }

  // 3) Third attempt (optional): chunked scan in 5-min slices from now backwards
  if (doChunked) {
    const chunk = 5;
    const now = Date.now();
    // Scan up to 6 chunks (~30m) or until success
    for (let i = 0; i < 6; i++) {
      const to = new Date(now - i * chunk * 60 * 1000).toISOString();
      const from = new Date(new Date(to).getTime() - chunk * 60 * 1000).toISOString();
      const { items, row } = await callOnce(kind, chainId, addr, from, to, methods);
      attempts.push(row);
      if (row.http_ok) return { items, attempts };
    }
  }

  return { items: [], attempts };
}

type StressPart = { label: string; score: number; count?: number; valueEth?: number; links?: string[] };

export async function getMarketStress(chainId: number, windowMins = 30): Promise<{
  score: number;
  parts: StressPart[];
  debug?: any;
}> {
  const age_to = new Date().toISOString();
  const age_from = minutesAgoISO(windowMins);

  log("BEGIN", { MCP_BASE, chainId, windowMins, age_from, age_to });

  const aavePools = envList("AAVE_POOL_ADDR", chainId);
  const compAddrs = envList("COMPOUND_ADDR", chainId);
  const routers = [...envList("UNIV2_ROUTER", chainId), ...envList("UNIV3_ROUTER", chainId), ...envList("ONEINCH_ROUTER", chainId)];
  const cexAddrs = [...envList("BINANCE_HOT", chainId), ...envList("COINBASE_HOT", chainId)];

  log("ENV_ADDRS", { aavePools, compAddrs, routers, cexAddrs });

  const debugCalls: AttemptRow[] = [];
  const warnings: string[] = [];

  // ===== Liquidations (method-filter + chunked fallback) =====
  const LIQ_METHODS = "liquidationCall,liquidateBorrow,liquidatePosition,liquidate";
  const liquidParts: StressPart[] = [];
  for (const addr of [...aavePools, ...compAddrs]) {
    const { items, attempts } = await tryGetTxs("liquidation", chainId, addr, windowMins, LIQ_METHODS, true);
    debugCalls.push(...attempts);

    const hadSuccess = attempts.some((a) => a.http_ok);
    if (!hadSuccess) warnings.push(`timeout_liquidations:${addr.slice(0, 10)}…`);

    const liqs = items.filter((t) => /liquid/i.test(getMethod(t)));
    if (DEBUG) log("LIQ_SUMMARY", { addr, items: items.length, liqCount: liqs.length });

    if (liqs.length) {
      liquidParts.push({
        label: `Liquidations@${addr.slice(0, 6)}`,
        score: Math.min(40, liqs.length * 2),
        count: liqs.length,
        links: [`${explorerBase(chainId)}/address/${addr}`],
      });
    }
  }

  // ===== DEX Routers =====
  const dexParts: StressPart[] = [];
  for (const addr of routers) {
    const { items, attempts } = await tryGetTxs("dex", chainId, addr, windowMins /* no methods */);
    debugCalls.push(...attempts);

    const swaps = items.filter((t) => {
      const m = getMethod(t);
      const to = getTo(t);
      return /(swap|multicall|exact|router)/i.test(m) || to === addr.toLowerCase();
    });

    const ethValue = swaps.reduce((acc: number, t: any) => {
      const to = getTo(t);
      if (to !== addr.toLowerCase()) return acc;
      return acc + weiToEthNum(getValueWei(t));
    }, 0);

    const score = Math.min(30, swaps.length * 0.5 + Math.min(10, ethValue));
    dexParts.push({
      label: `DEX@${addr.slice(0, 6)}`,
      score,
      count: swaps.length,
      valueEth: Number(ethValue.toFixed(3)),
      links: [`${explorerBase(chainId)}/address/${addr}`],
    });
    if (DEBUG) log("DEX_SUMMARY", { addr, items: items.length, swaps: swaps.length, ethValue, score });
  }

  // ===== CEX inflows =====
  const cexParts: StressPart[] = [];
  for (const addr of cexAddrs) {
    const { items, attempts } = await tryGetTxs("cex", chainId, addr, windowMins /* no methods */);
    debugCalls.push(...attempts);

    const inbound = items.filter((t) => getTo(t) === addr.toLowerCase() && getValueWei(t) > 0n);
    const ethIn = inbound.reduce((acc: number, t) => acc + weiToEthNum(getValueWei(t)), 0);
    const score = Math.min(30, inbound.length * 0.7 + Math.min(15, ethIn));
    cexParts.push({
      label: `CEXIn@${addr.slice(0, 6)}`,
      score,
      count: inbound.length,
      valueEth: Number(ethIn.toFixed(3)),
      links: [`${explorerBase(chainId)}/address/${addr}`],
    });
    if (DEBUG) log("CEX_SUMMARY", { addr, items: items.length, inbound: inbound.length, ethIn, score });
  }

  const parts = [...liquidParts, ...dexParts, ...cexParts];
  const score = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.score, 0)));
  log("END", { score, partsCount: parts.length });

  return {
    score,
    parts,
    ...(DEBUG
      ? {
          debug: {
            chainId,
            windowMins,
            age_from,
            age_to,
            MCP_BASE,
            calls: debugCalls,
            warnings
          },
        }
      : {}),
  };
}
