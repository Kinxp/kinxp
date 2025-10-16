export async function ollamaJson(prompt: string, system?: string) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b";
  const body = {
    model,
    stream: false,
    messages: [
      system ? { role: "system", content: system } : undefined,
      { role: "user", content: prompt }
    ].filter(Boolean)
  };

  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload: any = await response.json();
  const text = payload?.message?.content || "";
  return strictJson(text);
}

function strictJson(t: string) {
  try {
    const s = (t || "").trim();
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    return JSON.parse(i >= 0 && j >= 0 ? s.slice(i, j + 1) : "{}");
  } catch {
    return {};
  }
}
