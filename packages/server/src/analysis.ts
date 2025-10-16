import { ollamaChat } from "./ollama.js";
import { fetchTx, fetchAddressTxs, fetchTokensByAddress } from "./blockscout.js";

export async function explainTxOllama({ chainId, txHash }: { chainId: number; txHash: string; }) {
  const tx = await fetchTx(txHash);
  const prompt = `You are a blockchain analyst.
Input: Blockscout v2 JSON for chain ${chainId}.
Task: Explain what happened in 5 bullets and return STRICT JSON:
{"method":string,"transfers":[string],"fee":string,"risks":[string],"links":[string]}
JSON_INPUT:
${JSON.stringify(tx)}`;
  const text = await ollamaChat({ user: prompt });
  return safeParse(text);
}

export async function riskScanOllama({ chainId, address }: { chainId: number; address: string; }) {
  const [txs, toks] = await Promise.all([
    fetchAddressTxs(address, 1),
    fetchTokensByAddress(address)
  ]);
  const prompt = `Summarize 7d risk for ${address} on chain ${chainId}.
Inputs: Blockscout v2 JSON for recent transactions and token balances.
Flag: unlimited approvals, large novel outflows, risky tags.
Return STRICT JSON:
{"bullets":[string],"links":[string]}
TXS:${JSON.stringify(txs)}
TOKENS:${JSON.stringify(toks)}`;
  const text = await ollamaChat({ user: prompt });
  return safeParse(text);
}

function safeParse(input: string) {
  try {
    const trimmed = input.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const slice = start >= 0 && end >= 0 ? trimmed.slice(start, end + 1) : "{}";
    return JSON.parse(slice);
  } catch {
    return { raw: input };
  }
}
