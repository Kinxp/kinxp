// src/coach.ts
import { llmJson } from "./llm.js";

export async function coachHealthLLM(input: {
  ltv: number;
  maxLtv: number;
  liqLtv: number;
  distanceToLiqPct: number;
  liqPrice: number;
  collateralUsd: number;
  debtUsd: number;
}) {
  const prompt = `
You are a DeFi risk coach. Turn the metrics into one punchy line.
Return STRICT JSON: {"headline":string,"explanation":string,"tone":"calm"|"urgent"|"watch"}
METRICS=${JSON.stringify(input)}
Rules: one short-sentence headline; explanation < 160 chars; no emojis.
  `;
  const out = await llmJson(prompt);
  return {
    headline: out?.headline,
    explanation: out?.explanation,
    tone: out?.tone,
  };
}

export async function coachAdviceLLM(input: {
  ltv: number;
  targetLtv: number;
  maxLtv: number;
  liqLtv: number;
  targetBorrowUsd: number;
  targetRepayUsd: number;
  recommendedAction: string;
}) {
  const prompt = `
You are a DeFi borrowing advisor. Convert the computed plan into a friendly recommendation.
Return STRICT JSON: {"explanation":string,"cta":string}
INPUT=${JSON.stringify(input)}
Rules: neutral tone, specific dollar amounts, < 160 chars.
  `;
  const out = await llmJson(prompt);
  return { explanation: out?.explanation, cta: out?.cta };
}
