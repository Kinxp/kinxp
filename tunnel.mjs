#!/usr/bin/env node
// Node 18+
import localtunnel from "localtunnel";

// ==== HARD-CODED SETTINGS (strict subdomain) ====
const PORT = 8787;
const SUBDOMAIN = "kinxp";
const HOST = "https://loca.lt";
const EXPECTED = `https://${SUBDOMAIN}.loca.lt`;
const HEALTH_PATH = "/health";

const CHECK_EVERY_MS = 30000;
const FAIL_THRESHOLD = 3;
const REQUEST_TIMEOUT_MS = 8000;
const VERBOSE_HEALTH = true;
const BODY_PREVIEW_BYTES = 160;
// ================================================

let tunnel = null;
let url = "";
let fails = 0;
let shuttingDown = false;
let backoff = 1000;
let restartTimer = null;

const now = () => new Date().toISOString().replace("T", " ").replace("Z", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clearScheduledRestart(reason = "cleared") {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
    console.log(`[${now()}] [tunnel] scheduled restart ${reason}`);
  }
}

function scheduleRestart(reason = "unspecified") {
  if (restartTimer || shuttingDown) return;
  const wait = Math.min(30000, Math.floor(backoff * (1.5 + Math.random() * 0.5)));
  console.warn(`[${now()}] [tunnel] restarting in ${wait}ms...  (reason: ${reason})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startStrict().catch((err) => {
      console.error(`[${now()}] [tunnel] restart failed:`, err?.message || err);
      scheduleRestart("startStrict() failed");
    });
  }, wait);
  backoff = wait;
}

async function startStrict() {
  // Cancel any pending restart; we're actively (re)starting now.
  clearScheduledRestart("canceled (starting now)");

  // Loop until we actually get the exact hostname we want.
  while (!shuttingDown) {
    // Close previous attempt if any
    if (tunnel) {
      try { await tunnel.close(); } catch {}
      tunnel = null;
    }

    try {
      const opts = { port: PORT, subdomain: SUBDOMAIN, host: HOST };
      const t = await localtunnel(opts);
      const candidate = t.url.replace(/\/$/, "");

      if (candidate === EXPECTED) {
        tunnel = t;
        url = candidate;
        fails = 0;
        backoff = 1000; // reset backoff after success
        console.log(`[${now()}] [tunnel] UP (strict): ${url}  → localhost:${PORT}`);

        tunnel.on("close", () => { if (!shuttingDown) scheduleRestart("tunnel close"); });
        tunnel.on("error", (e) => {
          console.warn(`[${now()}] [tunnel] error:`, e?.message || e);
          if (!shuttingDown) scheduleRestart("tunnel error");
        });

        // Immediate health check
        await health(true).catch(() => {});
        return; // only return when EXPECTED is up
      } else {
        console.warn(`[${now()}] [tunnel] got "${candidate}", not "${EXPECTED}" → closing and retrying...`);
        try { await t.close(); } catch {}
        await sleep(Math.min(5000, 500 + Math.random() * 1000)); // small jitter before retry
        continue;
      }
    } catch (e) {
      console.warn(`[${now()}] [tunnel] start attempt failed:`, e?.message || e);
      await sleep(Math.min(10000, backoff));
      backoff = Math.min(30000, Math.floor(backoff * 1.7));
    }
  }
}

async function health(isStartup = false) {
  if (!url) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  const target = url + HEALTH_PATH;

  const t0 = Date.now();
  try {
    const res = await fetch(target, { signal: ctl.signal, cache: "no-store", method: "GET" });
    clearTimeout(t);
    const elapsed = Date.now() - t0;

    let preview = "";
    try {
      const buf = new Uint8Array(await res.arrayBuffer());
      preview = new TextDecoder().decode(buf.slice(0, BODY_PREVIEW_BYTES)).replace(/\s+/g, " ").trim();
    } catch {}

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (VERBOSE_HEALTH || isStartup) {
      console.log(`[${now()}] [tunnel] health OK ${res.status} ${elapsed}ms ${target}`);
      if (preview) console.log(`[${now()}] [tunnel] body: ${preview}`);
    }
    fails = 0;
    clearScheduledRestart("canceled (healthy)");
  } catch (e) {
    clearTimeout(t);
    const elapsed = Date.now() - t0;
    fails++;
    console.warn(`[${now()}] [tunnel] health FAIL ${fails}/${FAIL_THRESHOLD}: ${e?.message || e}  (${elapsed}ms)  ${target}`);
    if (fails >= FAIL_THRESHOLD) {
      console.warn(`[${now()}] [tunnel] too many failures → restart`);
      fails = 0;
      scheduleRestart("health failures");
    }
  }
}

async function main() {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await startStrict(); // <— only returns when kinxp.loca.lt is actually obtained
  while (!shuttingDown) {
    await sleep(CHECK_EVERY_MS);
    await health();
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearScheduledRestart("canceled (shutdown)");
  console.log(`\n[${now()}] [tunnel] shutting down…`);
  try { if (tunnel) await tunnel.close(); } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error(`[${now()}] [tunnel] fatal:`, e?.message || e);
  process.exit(1);
});
