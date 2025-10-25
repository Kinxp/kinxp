import "dotenv/config";
import express from "express";
import cors from "cors";
import { explainTxLLM_MCP, riskScanLLM_MCP, verifyMilestoneLLM_MCP } from "./agent_llm_over_mcp.js";
import { escrowRelease, escrowCreate } from "./hedera.js";
import { hcsPublish } from "./hcs.js";
import { getEthUsdFromPyth } from "./price.js";
import { resolveCollateralEth, computeHealth, computeAdvice } from "./position.js";
import { getMarketStress } from "./stress.js";
import { resolveLtvForChain } from "./config.js";

const app = express();
const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://localhost:5173",
  "https://localhost:5174",
  "https://kinxp.vercel.app/"
];

const rawCorsOrigins = process.env.WEB_ORIGIN || "";
const envOrigins = rawCorsOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]))
  .map((origin) => origin.replace(/\/$/, "").toLowerCase());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, "").toLowerCase();
      const isWildcard = allowedOrigins.includes("*");
      const isExplicit = allowedOrigins.includes(normalizedOrigin);
      const isLocaLt = normalizedOrigin.endsWith(".loca.lt");

      if (isWildcard || isExplicit || isLocaLt) {
        return callback(null, true);
      }

      return callback(new Error(`CORS: ${origin} not allowed`));
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, restBase: process.env.MCP_REST_BASE || null, llm: process.env.LLM_PROVIDER || "none" });
});

app.post("/ai/explain-tx", async (req, res) => {
  const { chainId, txHash } = req.body;
  try { res.json(await explainTxLLM_MCP({ chainId, txHash })); }
  catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post("/ai/risk-scan", async (req, res) => {
  const { chainId, address } = req.body;
  try { res.json(await riskScanLLM_MCP({ chainId, address })); }
  catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

app.post("/ai/verify-milestone", async (req, res) => {
  const { xCondition } = req.body;
  try { res.json(await verifyMilestoneLLM_MCP({ xCondition })); }
  catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
});

// === AI: Position Health ===
app.post("/ai/position-health", async (req, res) => {
  try {
    const { orderId, eth, hedera, params, price } = req.body || {};
    const chainId = Number(eth?.chainId);
    const debtUsd = Number(hedera?.debtAmountUsd ?? 0);
    const liqLtv = Number(params?.liqLtv ?? 0.85);
    const maxLtv = Number(params?.maxLtv ?? 0.80);
    const targetLtv = Number(params?.targetLtv ?? 0.60);

    const { eth: collateralEth, links } = await resolveCollateralEth({
      chainId,
      collateralWei: eth?.collateralWei,
      depositTxHash: eth?.depositTxHash,
    });

    if (!collateralEth || collateralEth <= 0) {
      return res.status(400).json({ ok: false, error: "collateralEth_unavailable" });
    }

    // Price: prefer explicit, else Pyth
    let ethUsd = Number(price?.ethUsd);
    let priceSource = "manual";
    if (!ethUsd) {
      const { price: p, source } = await getEthUsdFromPyth();
      ethUsd = Number(p);
      priceSource = source;
    }
    if (!ethUsd || !isFinite(ethUsd)) {
      return res.status(400).json({ ok: false, error: "price_unavailable" });
    }

    const { collateralUsd, ltv, liqPrice, distanceToLiquidationPct, riskLevel } =
      computeHealth({ collateralEth, ethUsd, debtUsd, targetLtv, maxLtv, liqLtv });

    const explanation =
      `You are ${distanceToLiquidationPct.toFixed(1)}% above liquidation. ` +
      `LTV ${(ltv * 100).toFixed(1)}% vs max ${(maxLtv * 100).toFixed(0)}% and liq ${(liqLtv * 100).toFixed(0)}%.`;

    // Optional LLM coach
    let ai: any = undefined;
    if ((process.env.LLM_PROVIDER || "none").toLowerCase() !== "none") {
      const { coachHealthLLM } = await import("./coach.js");
      ai = await coachHealthLLM({
        ltv,
        maxLtv,
        liqLtv,
        distanceToLiqPct: Number(distanceToLiquidationPct.toFixed(2)),
        liqPrice: Number(liqPrice.toFixed(2)),
        collateralUsd,
        debtUsd,
      });
    }

    res.json({
      ok: true,
      orderId,
      collateral: { eth: collateralEth, usd: collateralUsd },
      debtUsd,
      ltv,
      limits: { targetLtv, maxLtv, liqLtv },
      distanceToLiquidationPct: Number(distanceToLiquidationPct.toFixed(2)),
      liquidationPriceEthUsd: Number(liqPrice.toFixed(2)),
      riskLevel,
      explanation,
      links,
      ai,
      raw: { priceSource },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// === AI: Borrow/Repay Advice ===
app.post("/ai/borrow-advice", async (req, res) => {
  try {
    const { orderId, eth, hedera, params, price, whatIf } = req.body || {};
    const chainId = Number(eth?.chainId);
    const debtUsd = Number(hedera?.debtAmountUsd ?? 0);
    const liqLtv = Number(params?.liqLtv ?? 0.85);
    const maxLtv = Number(params?.maxLtv ?? 0.80);
    const targetLtv = Number(params?.targetLtv ?? 0.60);

    const { eth: collateralEth, links } = await resolveCollateralEth({
      chainId,
      collateralWei: eth?.collateralWei,
      depositTxHash: eth?.depositTxHash,
    });
    if (!collateralEth || collateralEth <= 0) {
      return res.status(400).json({ ok: false, error: "collateralEth_unavailable" });
    }

    let ethUsd = Number(price?.ethUsd);
    if (!ethUsd) {
      const { price: p } = await getEthUsdFromPyth();
      ethUsd = Number(p);
    }
    if (!ethUsd || !isFinite(ethUsd)) {
      return res.status(400).json({ ok: false, error: "price_unavailable" });
    }

    const base = computeAdvice({ collateralEth, ethUsd, debtUsd, targetLtv, maxLtv, liqLtv });

    // Optional what-if: simulate extra borrow
    if (whatIf?.extraBorrowUsd && base.recommendedAction !== "repay") {
      const simDebt = debtUsd + Number(whatIf.extraBorrowUsd);
      const sim = computeAdvice({ collateralEth, ethUsd, debtUsd: simDebt, targetLtv, maxLtv, liqLtv });
      base.guardrails.simulated = {
        withExtraBorrowUsd: Number(whatIf.extraBorrowUsd),
        postLtv: sim.ltv,
      };
    }

    // Optional LLM coach
    let ai: any = undefined;
    if ((process.env.LLM_PROVIDER || "none").toLowerCase() !== "none") {
      const { coachAdviceLLM } = await import("./coach.js");
      ai = await coachAdviceLLM({
        ltv: base.ltv,
        targetLtv,
        maxLtv,
        liqLtv,
        targetBorrowUsd: base.targetBorrowUsd,
        targetRepayUsd: base.targetRepayUsd,
        recommendedAction: base.recommendedAction,
      });
    }

    const explanation =
      base.recommendedAction === "borrow"
        ? `You can safely borrow ~$${base.targetBorrowUsd.toFixed(2)} to reach ${(targetLtv * 100).toFixed(0)}% LTV; ` +
          `max additional before cap ~$${base.guardrails.maxAdditionalBorrowUsd.toFixed(2)}.`
        : base.recommendedAction === "repay"
          ? `Repay ~$${base.targetRepayUsd.toFixed(2)} to get back to ${(targetLtv * 100).toFixed(0)}% LTV.`
          : `You're already near target LTV; no action needed.`;

    res.json({
      ok: true,
      orderId,
      ltv: Number(base.ltv.toFixed(6)),
      targetBorrowUsd: Number(base.targetBorrowUsd.toFixed(2)),
      targetRepayUsd: Number(base.targetRepayUsd.toFixed(2)),
      recommendedAction: base.recommendedAction,
      explanation,
      guardrails: base.guardrails,
      links,
      ai,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/ai/liquidation-risk", async (req, res) => {
  try {
    const { orderId, eth, hedera, params, price, stress } = req.body || {};
    const chainId = Number(eth?.chainId);
    const defaults = resolveLtvForChain(chainId);
    const liqLtv = Number(params?.liqLtv ?? defaults.liqLtv);
    const maxLtv = Number(params?.maxLtv ?? defaults.maxLtv);
    const targetLtv = Number(params?.targetLtv ?? defaults.targetLtv);

    const { eth: collateralEth, links } = await resolveCollateralEth({
      chainId,
      collateralWei: eth?.collateralWei,
      depositTxHash: eth?.depositTxHash,
    });
    if (!collateralEth || collateralEth <= 0) {
      return res.status(400).json({ ok: false, error: "collateralEth_unavailable" });
    }

    let ethUsd = Number(price?.ethUsd);
    if (!ethUsd) {
      const { price: p } = await getEthUsdFromPyth();
      ethUsd = Number(p);
    }
    if (!ethUsd || !isFinite(ethUsd)) {
      return res.status(400).json({ ok: false, error: "price_unavailable" });
    }

    const debtUsd = Number(hedera?.debtAmountUsd ?? 0);
    const H = computeHealth({ collateralEth, ethUsd, debtUsd, targetLtv, maxLtv, liqLtv });

    const windowMins = Number(stress?.windowMins ?? process.env.STRESS_WINDOW_MINS ?? 30);
    const S = await getMarketStress(chainId, windowMins);

    const close = H.distanceToLiquidationPct < 15;
    const mediumClose = H.distanceToLiquidationPct < 30 && S.score >= 60;

    let advisory: "hold" | "tighten" | "repay_or_hedge" = "hold";
    if (close || mediumClose || H.ltv >= maxLtv) advisory = "repay_or_hedge";
    else if (H.ltv >= targetLtv || S.score >= 50) advisory = "tighten";

    const explanation =
      advisory === "repay_or_hedge"
        ? `High risk: ${H.distanceToLiquidationPct.toFixed(1)}% buffer with market stress ${S.score}/100. Consider repaying or hedging.`
        : advisory === "tighten"
          ? `Caution: buffer ${H.distanceToLiquidationPct.toFixed(1)}%, stress ${S.score}/100. Consider moving toward target LTV.`
          : `Calm: buffer ${H.distanceToLiquidationPct.toFixed(1)}%, stress ${S.score}/100.`;

    res.json({
      ok: true,
      orderId,
      chainId,
      collateral: { eth: collateralEth, usd: H.collateralUsd },
      debtUsd,
      priceEthUsd: ethUsd,
      ltv: H.ltv,
      distanceToLiquidationPct: Number(H.distanceToLiquidationPct.toFixed(2)),
      liquidationPriceEthUsd: Number(H.liqPrice.toFixed(2)),
      limits: { targetLtv, maxLtv, liqLtv },
      marketStress: S,
      advisory,
      explanation,
      links,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Hedera stubs unchanged
app.post("/escrow/create", async (req, res) => res.json(await escrowCreate(req.body)));
app.post("/escrow/release", async (req, res) => {
  const { xCondition } = req.body;
  res.json(await escrowRelease({ xCondition }));
});
app.post("/hcs/publish", async (req, res) => {
  const { topicId, message } = req.body;
  res.json(await hcsPublish(topicId, message));
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`API on :${PORT}`));
