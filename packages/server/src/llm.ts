function safeParse(t: string) {
  try {
    const s = (t || "").trim(); const i = s.indexOf("{"); const j = s.lastIndexOf("}");
    return JSON.parse(i >= 0 && j >= 0 ? s.slice(i, j + 1) : "{}");
  } catch {
    return {};
  }
}

export async function llmJson(prompt: string): Promise<any> {
  const mode = (process.env.LLM_PROVIDER || "none").toLowerCase();
  if (mode === "ollama") return ollama(prompt);
  if (mode === "anthropic") return anthropic(prompt);
  return {};
}

async function ollama(prompt: string) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b";
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt }] })
  });
  const j: any = await res.json();
  return safeParse(j?.message?.content || "");
}

async function anthropic(prompt: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-3-7-sonnet-latest";
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] })
  });
  const j: any = await res.json();
  return safeParse(j?.content?.[0]?.text || "");
}
