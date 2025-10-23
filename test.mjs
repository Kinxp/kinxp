#!/usr/bin/env node
import localtunnel from "localtunnel";

const PORT = Number(process.env.TUNNEL_PORT || 8787);
const SUB  = process.env.TUNNEL_SUBDOMAIN || "";  // optional
const HOST = process.env.TUNNEL_HOST || "";       // optional (e.g. https://loca.lt)

const CHECK_EVERY_MS = Number(process.env.CHECK_EVERY_MS || 30000);
const FAIL_THRESHOLD = Number(process.env.FAIL_THRESHOLD || 3);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 8000);

let tunnel, url, fails = 0, shuttingDown = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function start() {
  if (tunnel) try { await tunnel.close(); } catch {}
  const opts = { port: PORT };
  if (SUB)  opts.subdomain = SUB;
  if (HOST) opts.host      = HOST;

  tunnel = await localtunnel(opts);
  url = tunnel.url;
  fails = 0;
  console.log(`[tunnel] UP: ${url}  → localhost:${PORT}`);

  tunnel.on("close", () => { if (!shuttingDown) restart(); });
  tunnel.on("error", (e) => { console.warn("[tunnel] error:", e?.message || e); if (!shuttingDown) restart(); });
}

let backoff = 1000;
function restart() {
  const wait = Math.min(30000, Math.floor(backoff * (1.5 + Math.random()*0.5)));
  console.warn(`[tunnel] restarting in ${wait}ms...`);
  setTimeout(() => start().catch(err => { console.error("[tunnel] restart failed:", err?.message || err); restart(); }), wait);
  backoff = wait;
}

async function health() {
  if (!url) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (fails) console.log("[tunnel] health OK");
    fails = 0;
  } catch (e) {
    clearTimeout(t);
    fails++;
    console.warn(`[tunnel] health FAIL ${fails}/${FAIL_THRESHOLD}:`, e?.message || e);
    if (fails >= FAIL_THRESHOLD) { console.warn("[tunnel] too many failures → restart"); restart(); fails = 0; }
  }
}

async function main() {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await start();
  while (!shuttingDown) { await sleep(CHECK_EVERY_MS); await health(); }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[tunnel] shutting down…");
  try { if (tunnel) await tunnel.close(); } catch {}
  process.exit(0);
}

main().catch(e => { console.error("[tunnel] fatal:", e?.message || e); process.exit(1); });
