import "dotenv/config";
import express from "express";
import cors from "cors";
import { explainTxLLM_MCP, riskScanLLM_MCP, verifyMilestoneLLM_MCP } from "./agent_llm_over_mcp.js";
import { escrowRelease, escrowCreate } from "./hedera.js";
import { hcsPublish } from "./hcs.js";

const app = express();
const corsOrigin = process.env.WEB_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));
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
