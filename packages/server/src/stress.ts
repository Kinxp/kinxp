// src/stress.ts - MCP + Ollama for AI-powered analysis
import { Buffer } from "buffer";
import { mcpRest as mcp } from "./mcp_rest.js";
import { explorerBase } from "./config.js";

const DEBUG = true;
const log = (...a: any[]) => console.log("[STRESS]", ...a);

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2"; // or "mistral", "phi3", etc

const AAVE_POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
const UNI_V2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const UNI_V3_ROUTER = "0xE592427a0AEce92De3Edee1F18E0157C05861564";
const ONEINCH_V5 = "0x1111111254EEB25477B68fb85Ed929f73A960582";
const COW_SETTLER = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";
const BINANCE_HOT = "0xf977814e90da44bfa03b6295a0616a897441acec";

const DEX_TARGETS = [
  UNI_V2_ROUTER,
  UNI_V3_ROUTER,
  ONEINCH_V5,
  COW_SETTLER
];

const DEX_TARGET_SET = new Set(DEX_TARGETS.map((addr) => addr.toLowerCase()));

const DEX_LABELS: Record<string, string> = {
  [UNI_V2_ROUTER.toLowerCase()]: "Uniswap V2",
  [UNI_V3_ROUTER.toLowerCase()]: "Uniswap V3",
  [ONEINCH_V5.toLowerCase()]: "1inch v5",
  [COW_SETTLER.toLowerCase()]: "CowSwap Settler"
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

const DEFAULT_WINDOW_SECONDS = parsePositiveInt(process.env.STRESS_WINDOW_DEFAULT_SECONDS, 600);
const MIN_WINDOW_SECONDS = parsePositiveInt(process.env.STRESS_WINDOW_MIN_SECONDS, DEFAULT_WINDOW_SECONDS);
const FALLBACK_WINDOW_SECONDS = Math.max(
  MIN_WINDOW_SECONDS,
  parsePositiveInt(process.env.STRESS_WINDOW_FALLBACK_SECONDS, 60 * 60 * 24 * 7) // 7 days
);

// Ollama API call
async function analyzeWithOllama(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3, // Lower = more focused
          num_predict: 200  // Max tokens
        }
      }),
      signal: AbortSignal.timeout(30000) // 30s timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.response || "";
  } catch (e: any) {
    log(`Ollama error: ${e.message}`);
    return "";
  }
}

function unwrapMcpPayload(raw: any): any {
  let current = raw;
  const visited = new Set<any>();

  for (let depth = 0; depth < 6; depth++) {
    if (current === null || current === undefined) {
      return current;
    }

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) {
        return trimmed;
      }
      try {
        current = JSON.parse(trimmed);
        continue;
      } catch {
        return current;
      }
    }

    if (typeof current !== "object") {
      return current;
    }

    if (visited.has(current)) {
      return current;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      return current;
    }

    // Node Buffer representation
    if (typeof current.type === "string" && Array.isArray((current as any).data)) {
      try {
        const buffer = Buffer.from((current as any).data);
        current = buffer.toString("utf8");
        continue;
      } catch {
        return current;
      }
    }

    if (typeof (current as any).bodyText === "string") {
      current = (current as any).bodyText;
      continue;
    }

    if (typeof (current as any).body === "string") {
      current = (current as any).body;
      continue;
    }

    if (typeof (current as any).payload === "string") {
      current = (current as any).payload;
      continue;
    }

    if (typeof (current as any).data === "string") {
      current = (current as any).data;
      continue;
    }

    if ((current as any).data && typeof (current as any).data === "object") {
      current = (current as any).data;
      continue;
    }

    if (typeof (current as any).text === "string") {
      current = (current as any).text;
      continue;
    }

    return current;
  }

  return current;
}

function normalizeTxPage(raw: any) {
  const data = unwrapMcpPayload(raw);
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.result)
    ? data.result
    : Array.isArray(data?.transactions)
    ? data.transactions
    : Array.isArray(data)
    ? data
    : [];

  const nextParams =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data.next_page_params ??
        data.nextPageParams ??
        data.next ??
        data.nextCursor ??
        data.next_cursor ??
        data.cursor ??
        null)
      : null;

  return { data, items, nextParams };
}

function isRecognizedTxPayload(normalized: { data: any }) {
  const data = normalized.data;
  if (Array.isArray(data)) {
    return true;
  }
  if (!data || typeof data !== "object") {
    return false;
  }
  if (
    Array.isArray((data as any).items) ||
    Array.isArray((data as any).result) ||
    Array.isArray((data as any).transactions)
  ) {
    return true;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "next_page_params") ||
    Object.prototype.hasOwnProperty.call(data, "nextPageParams") ||
    Object.prototype.hasOwnProperty.call(data, "next") ||
    Object.prototype.hasOwnProperty.call(data, "next_cursor") ||
    Object.prototype.hasOwnProperty.call(data, "cursor")
  ) {
    return true;
  }
  return false;
}

function sanitizeNextParams(input: any): Record<string, string> | null {
  if (!input) return null;

  if (typeof input === "string") {
    return { cursor: input };
  }

  if (typeof input !== "object") {
    return null;
  }

  const filtered = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
  );

  return Object.keys(filtered).length ? filtered : null;
}

function buildQuery(params?: Record<string, any>) {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function fetchTxPage(
  chainId: number,
  addr: string,
  ageFrom: string,
  ageTo: string,
  extraParams?: Record<string, any>
) {
  const sanitizedParams = sanitizeNextParams(extraParams || undefined);
  const attemptLabel = sanitizedParams ? ` params=${JSON.stringify(sanitizedParams)}` : "";

  const tryMcp = async () => {
    const t0 = Date.now();
    const response = await mcp.get_transactions_by_address(
      chainId,
      addr,
      ageFrom,
      ageTo,
      undefined,
      sanitizedParams || undefined
    );
    const ms = Date.now() - t0;
    const normalized = normalizeTxPage(response?.data ?? response ?? {});
    const recognized = isRecognizedTxPayload(normalized);

    if (DEBUG) {
      log("MCP Response structure:", {
        type: Array.isArray(normalized.data) ? "array" : typeof normalized.data,
        recognized,
        hasItemsProp: Array.isArray((normalized.data as any)?.items),
        itemsLength: normalized.items.length,
        nextParams: sanitizedParams
          ? sanitizedParams
          : normalized.nextParams
          ? typeof normalized.nextParams === "object"
            ? Object.keys(normalized.nextParams)
            : normalized.nextParams
          : null,
        sampleKeys:
          Array.isArray(normalized.items) && normalized.items.length
            ? Object.keys(normalized.items[0])
            : null,
        preview:
          typeof normalized.data === "string"
            ? String(normalized.data).slice(0, 120)
            : undefined
      });
    }

    if (!recognized) {
      throw new Error(
        `Unrecognized MCP payload (type=${typeof normalized.data}) preview=${String(normalized.data)
          .slice(0, 120)
          .replace(/\s+/g, " ")}`
      );
    }

    return {
      ...normalized,
      via: "mcp" as const,
      durationMs: ms
    };
  };

  const tryDirect = async (reason: string) => {
    const baseUrl = `${explorerBase(chainId)}/api/v2/addresses/${addr}/transactions`;
    const query = buildQuery(sanitizedParams || undefined);
    const url = query ? `${baseUrl}?${query}` : baseUrl;
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Direct HTTP ${res.status} ${res.statusText} ${txt.slice(0, 120)}`);
    }
    const json = await res.json();
    const normalized = normalizeTxPage(json);
    const recognized = isRecognizedTxPayload(normalized);

    if (DEBUG) {
      log("Direct Response structure:", {
        type: Array.isArray(normalized.data) ? "array" : typeof normalized.data,
        recognized,
        hasItemsProp: Array.isArray((normalized.data as any)?.items),
        itemsLength: normalized.items.length,
        nextParams: normalized.nextParams
          ? typeof normalized.nextParams === "object"
            ? Object.keys(normalized.nextParams)
            : normalized.nextParams
          : null
      });
    }

    if (!recognized) {
      throw new Error(`Direct payload still unrecognized after MCP failure (${reason})`);
    }

    return {
      ...normalized,
      via: "direct" as const,
      durationMs: ms
    };
  };

  try {
    return await tryMcp();
  } catch (mcpErr: any) {
    log(`MCP fetch issue${attemptLabel ? attemptLabel : ""}: ${mcpErr?.message || mcpErr}`);
    return await tryDirect(mcpErr?.message || String(mcpErr || "unknown"));
  }
}

// Simple transaction fetch with MCP
async function fetchTxsViaMCP(
  chainId: number,
  addr: string,
  limit: number = 50,
  windowSeconds: number = FALLBACK_WINDOW_SECONDS
): Promise<any[]> {
  if (limit <= 0) {
    return [];
  }

  const lookbackSeconds = Math.max(windowSeconds, FALLBACK_WINDOW_SECONDS);
  const ageTo = new Date().toISOString();
  const ageFrom = new Date(Date.now() - lookbackSeconds * 1000).toISOString();

  const collected: any[] = [];
  let nextParams: Record<string, any> | null = null;
  let page = 1;

  while (collected.length < limit) {
    try {
      const extraParams = nextParams ? { ...nextParams } : undefined;
      const extraLog =
        extraParams && Object.keys(extraParams).length ? ` params=${JSON.stringify(extraParams)}` : "";
      log(`MCP Fetch${page > 1 ? ` (page ${page})` : ""}: addr=${addr}${extraLog}`);

      const result = await fetchTxPage(
        chainId,
        addr,
        ageFrom,
        ageTo,
        extraParams
      );

      const items = result.items;
      collected.push(...items);
      log(
        `${result.via.toUpperCase()} Parsed ${items.length} transactions (total ${collected.length}) in ${result.durationMs}ms`
      );

      if (collected.length >= limit) {
        break;
      }

      const nextFromPage = sanitizeNextParams(result.nextParams);
      if (!nextFromPage) {
        break;
      }

      nextParams = nextFromPage;
      page += 1;
    } catch (e) {
      log(`MCP fetch error for ${addr.slice(0, 10)}:`, {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.slice(0, 200) : undefined
      });
      break;
    }
  }

  return collected.slice(0, limit);
}

function getTimestampMs(t: any): number | null {
  const candidates = [
    t?.timestamp,
    t?.block_timestamp,
    t?.inserted_at,
    t?.created_at,
    t?.block_signed_at,
    t?.time
  ];

  for (const value of candidates) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "number") {
      // Heuristic: assume value already milliseconds if large, otherwise treat as seconds
      if (value > 1e12) {
        return value;
      }
      return value * 1000;
    }

    if (value instanceof Date) {
      const ms = value.getTime();
      if (!Number.isNaN(ms)) {
        return ms;
      }
      continue;
    }

    if (typeof value === "string") {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) {
        return ms;
      }
    }
  }

  return null;
}

function filterByTime(txs: any[], maxAgeSeconds: number): any[] {
  const cutoff = Date.now() - maxAgeSeconds * 1000;
  return txs.filter((t) => {
    const ts = getTimestampMs(t);
    return ts !== null && ts >= cutoff;
  });
}

function getHash(t: any): string {
  return (
    t?.hash ||
    t?.transaction_hash ||
    t?.tx_hash ||
    ""
  );
}

function getMethod(t: any): string {
  return (
    t?.method ||
    t?.decoded_input?.method_call ||
    t?.decoded_input?.method ||
    t?.data?.method ||
    ""
  );
}

function getTo(t: any): string {
  const value =
    t?.to?.hash ??
    t?.to ??
    t?.to_address ??
    t?.receiver ??
    "";
  return String(value).toLowerCase();
}

function getFrom(t: any): string {
  const value =
    t?.from?.hash ??
    t?.from ??
    t?.from_address ??
    t?.sender ??
    "";
  return String(value).toLowerCase();
}

function getValueWei(t: any): bigint {
  const raw = t?.value ?? t?.value_wei ?? t?.tx_value ?? t?.amount ?? "0";
  try {
    if (typeof raw === "bigint") {
      return raw;
    }
    if (typeof raw === "number") {
      return BigInt(Math.floor(raw));
    }
    return BigInt(String(raw));
  } catch {
    return 0n;
  }
}

function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18;
}

type TxSummary = {
  method: string;
  value_eth: number;
  from: string;
  to: string;
  timestamp: string;
};

type StressPart = {
  label: string;
  score: number;
  count: number;
  valueEth?: number;
  aiInsight?: string;
  topTxs?: TxSummary[];
};

export async function getMarketStress(
  chainId: number = 1,
  requestedWindowSeconds: number = DEFAULT_WINDOW_SECONDS,
  useAI: boolean = true
): Promise<{
  score: number;
  riskLevel: string;
  parts: StressPart[];
  summary: string;
  aiAnalysis?: string;
}> {
  const requested =
    typeof requestedWindowSeconds === "number" && Number.isFinite(requestedWindowSeconds)
      ? Math.max(1, Math.floor(requestedWindowSeconds))
      : DEFAULT_WINDOW_SECONDS;
  const windowSeconds = Math.max(requested, MIN_WINDOW_SECONDS);
  const requestedMinutes = Math.round((requested / 60) * 10) / 10;
  const windowMinutes = Math.round((windowSeconds / 60) * 10) / 10;
  const windowDescriptor =
    requested === windowSeconds
      ? `${windowSeconds}s window (~${windowMinutes}m)`
      : `requested ${requested}s (~${requestedMinutes}m) -> using ${windowSeconds}s (~${windowMinutes}m)`;
  log(`=== START: ${windowDescriptor}, AI=${useAI} ===`);

  const parts: StressPart[] = [];
  let totalRecentTxs = 0;

  const fetchTasks = [
    fetchTxsViaMCP(chainId, AAVE_POOL, 200, windowSeconds),
    ...DEX_TARGETS.map((addr) => fetchTxsViaMCP(chainId, addr, 200, windowSeconds)),
    fetchTxsViaMCP(chainId, BINANCE_HOT, 200, windowSeconds)
  ];

  const fetchResults = await Promise.all(fetchTasks);
  const aaveTxs = fetchResults[0];
  const dexTxArrays = fetchResults.slice(1, 1 + DEX_TARGETS.length);
  const binanceTxs = fetchResults[fetchResults.length - 1];

  const dexTxsMap = new Map<string, any>();
  dexTxArrays.forEach((txs, addrIdx) => {
    txs.forEach((tx, txIdx) => {
      const hash = getHash(tx);
      const key = hash ? `hash:${hash}` : `idx:${addrIdx}:${txIdx}`;
      if (!dexTxsMap.has(key)) {
        dexTxsMap.set(key, tx);
      }
    });
  });
  const dexTxs = Array.from(dexTxsMap.values());

  // 1. Liquidations Analysis
  {
    log(`\n📊 Analyzing Aave liquidations...`);
    log(`Total txs fetched: ${aaveTxs.length}`);

    const recent = filterByTime(aaveTxs, windowSeconds);
    totalRecentTxs += recent.length;
    log(`Txs in time window (${windowSeconds}s): ${recent.length}`);

    if (recent.length > 0 && DEBUG) {
      log(`Sample tx methods:`, recent.slice(0, 5).map(t => ({
        method: getMethod(t),
        to: getTo(t).slice(0, 10),
        value: t.value
      })));
    }

    const liqs = recent.filter(t => /liquid/i.test(getMethod(t)));
    log(`Liquidation txs found: ${liqs.length}`);

    const totalEth = liqs.reduce((sum, t) => sum + weiToEth(getValueWei(t)), 0);
    const score = Math.min(50, liqs.length * 3 + Math.min(20, totalEth * 0.2));

    // Get top 3 liquidations for AI context
    const topTxs = liqs.slice(0, 3).map(t => ({
      method: getMethod(t),
      value_eth: weiToEth(getValueWei(t)),
      from: (t.from?.hash || t.from || "").slice(0, 10),
      to: getTo(t).slice(0, 10),
      timestamp: t.timestamp || t.block_timestamp || t.inserted_at || ""
    }));

    let aiInsight = "";
    if (useAI && liqs.length > 0) {

      const perMin = (liqs.length / (windowSeconds / 60)).toFixed(1);

      const prompt = `
      You are an on-chain risk analyst. Produce a single JSON object (no prose) following this schema:
      
      {
        "summary": "string, <= 160 chars, 1 sentence with numbers",
        "pressure": "none|low|moderate|high",
        "metrics": {
          "count": number,
          "totalEth": number,
          "perMin": number
        },
        "note": "string, <= 120 chars, forward-looking line without speculation"
      }
      
      Inputs:
      - window_minutes=${Math.floor(windowSeconds / 60)}
      - liquidation_count=${liqs.length}
      - total_liquidated_eth=${Number(totalEth.toFixed(2))}
      - liquidations_per_min=${Number(perMin)}
      - top_liquidations_sample=${JSON.stringify(topTxs)}
      
      Rules:
      - Use ONLY the inputs. No causes or narratives (no whales/manipulation/news).
      - Pick "pressure" strictly from none|low|moderate|high based on the magnitudes of count, totalEth, and perMin.
      - Return VALID JSON only, no backticks, no extra text.
      `;
      aiInsight = await analyzeWithOllama(prompt);
    }

    parts.push({
      label: 'Liquidations',
      score: Math.round(score),
      count: liqs.length,
      valueEth: Number(totalEth.toFixed(2)),
      aiInsight,
      topTxs
    });

    log(`Liquidations: ${liqs.length} events, ${totalEth.toFixed(2)} ETH`);
  }

  // 2. DEX Activity Analysis
  {
    log(`\n📊 Analyzing DEX activity...`);
    log(`Total txs fetched: ${dexTxs.length}`);

    if (DEBUG && dexTxs.length > 0) {
      const perTarget = DEX_TARGETS.map((addr, idx) => ({
        label: DEX_LABELS[addr.toLowerCase()] || addr.slice(0, 10),
        count: dexTxArrays[idx]?.length ?? 0
      }));
      log(`Per router counts:`, perTarget);
    }

    const recent = filterByTime(dexTxs, windowSeconds);
    totalRecentTxs += recent.length;
    log(`Txs in time window: ${recent.length}`);

    if (recent.length > 0 && DEBUG) {
      log(`Sample tx methods:`, recent.slice(0, 5).map(t => ({
        method: getMethod(t),
        to: getTo(t).slice(0, 10),
        value: t.value
      })));
    }

    const swaps = recent.filter(t => /swap|exact/i.test(getMethod(t)));
    log(`Swap txs found: ${swaps.length}`);

    const totalEth = swaps.reduce((sum, t) => {
      const toAddr = getTo(t);
      if (DEX_TARGET_SET.has(toAddr)) {
        return sum + weiToEth(getValueWei(t));
      }
      return sum;
    }, 0);

    const score = Math.min(30, swaps.length * 0.8 + Math.min(10, totalEth * 0.3));

    const topTxs = swaps.slice(0, 3).map(t => ({
      method: getMethod(t),
      value_eth: weiToEth(getValueWei(t)),
      from: (t.from?.hash || t.from || "").slice(0, 10),
      to: getTo(t).slice(0, 10),
      timestamp: t.timestamp || t.block_timestamp || t.inserted_at || ""
    }));

    let aiInsight = "";
    if (useAI && swaps.length > 5) {
      const prompt = `${swaps.length} DEX swaps on Uniswap (${totalEth.toFixed(2)} ETH volume) in ${Math.floor(windowSeconds / 60)} minutes. Is this elevated trading activity? What might it signal? Be concise.`;

      aiInsight = await analyzeWithOllama(prompt);
    }

    parts.push({
      label: 'DEX Volume',
      score: Math.round(score),
      count: swaps.length,
      valueEth: Number(totalEth.toFixed(2)),
      aiInsight,
      topTxs
    });

    log(`DEX: ${swaps.length} swaps, ${totalEth.toFixed(2)} ETH`);
  }

  // 3. CEX Inflows Analysis
  {
    log(`\n📊 Analyzing CEX inflows...`);
    log(`Total txs fetched: ${binanceTxs.length}`);

    const recent = filterByTime(binanceTxs, windowSeconds);
    totalRecentTxs += recent.length;
    log(`Txs in time window: ${recent.length}`);

    if (recent.length > 0 && DEBUG) {
      log(`Sample tx details:`, recent.slice(0, 5).map(t => ({
        method: getMethod(t),
        to: getTo(t).slice(0, 10),
        value: t.value,
        timestamp: t.timestamp || t.block_timestamp || t.inserted_at || ""
      })));
    }

    const inflows = recent.filter(t =>
      getTo(t) === BINANCE_HOT.toLowerCase() && getValueWei(t) > 0n
    );
    log(`Inflow txs found: ${inflows.length}`);

    const totalEth = inflows.reduce((sum, t) => sum + weiToEth(getValueWei(t)), 0);
    const score = Math.min(20, inflows.length * 0.6 + Math.min(10, totalEth * 0.15));

    const topTxs = inflows.slice(0, 3).map(t => ({
      method: getMethod(t),
      value_eth: weiToEth(getValueWei(t)),
      from: (t.from?.hash || t.from || "").slice(0, 10),
      to: getTo(t).slice(0, 10),
      timestamp: t.timestamp || t.block_timestamp || t.inserted_at || ""
    }));

    let aiInsight = "";
    if (useAI && totalEth > 10) {
      const prompt = `${inflows.length} large transfers to Binance (${totalEth.toFixed(2)} ETH) in ${Math.floor(windowSeconds / 60)} minutes. Does this suggest panic selling or normal flow? Be concise.`;

      aiInsight = await analyzeWithOllama(prompt);
    }

    parts.push({
      label: 'CEX Inflows',
      score: Math.round(score),
      count: inflows.length,
      valueEth: Number(totalEth.toFixed(2)),
      aiInsight,
      topTxs
    });

    log(`CEX: ${inflows.length} inflows, ${totalEth.toFixed(2)} ETH`);
  }

  if (totalRecentTxs === 0) {
    const fallbackWindow = Math.max(windowSeconds, FALLBACK_WINDOW_SECONDS);
    if (fallbackWindow > windowSeconds) {
      const fallbackMinutes = Math.round((fallbackWindow / 60) * 10) / 10;
      log(
        `No transactions found within ${windowSeconds}s window. Auto-expanding to ${fallbackWindow}s (~${fallbackMinutes}m) to validate data.`
      );
      return getMarketStress(chainId, fallbackWindow, useAI);
    }
  }

  const totalScore = Math.min(100, parts.reduce((s, p) => s + p.score, 0));

  let riskLevel: string;
  let summary: string;

  if (totalScore < 20) {
    riskLevel = 'LOW';
    summary = 'Market is calm. Minimal liquidation risk.';
  } else if (totalScore < 50) {
    riskLevel = 'MODERATE';
    summary = 'Normal market activity. Standard monitoring recommended.';
  } else if (totalScore < 75) {
    riskLevel = 'HIGH';
    summary = 'Elevated stress. Increased liquidation risk.';
  } else {
    riskLevel = 'CRITICAL';
    summary = 'Severe market stress! High liquidation activity.';
  }

  // Overall AI analysis
  let aiAnalysis = "";
  if (useAI) {
    const prompt = `Market stress score: ${totalScore}/100 (${riskLevel}). Liquidations: ${parts[0].count} (${parts[0].valueEth} ETH), DEX: ${parts[1].count} swaps (${parts[1].valueEth} ETH), CEX inflows: ${parts[2].count} (${parts[2].valueEth} ETH). Provide a brief overall market assessment and liquidation risk forecast. 2-3 sentences.`;

    aiAnalysis = await analyzeWithOllama(prompt);
  }

  log(`=== FINAL: ${riskLevel} (${totalScore}/100) ===`);

  return {
    score: totalScore,
    riskLevel,
    parts,
    summary,
    aiAnalysis
  };
}

// Test function
export async function testWithAI() {
  console.log('\nAI Test Run: Ollama Analysis\n');

  const result = await getMarketStress(1, DEFAULT_WINDOW_SECONDS, true); // default window

  console.log(`\nScore: ${result.score}/100 - ${result.riskLevel}`);
  console.log(`Summary: ${result.summary}`);

  if (result.aiAnalysis) {
    console.log(`\nAI Analysis:\n${result.aiAnalysis}`);
  }

  result.parts.forEach(p => {
    console.log(`\n${p.label}: ${p.count} txs, ${p.valueEth} ETH (${p.score} pts)`);
    if (p.aiInsight) {
      console.log(`  Insight: ${p.aiInsight}`);
    }
  });

  console.log('\nDone\n');
}
