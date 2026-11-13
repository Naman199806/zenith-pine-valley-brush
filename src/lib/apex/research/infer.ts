export interface ModelResult {
  status: "OK" | "MODEL_UNAVAILABLE";
  model: string | null;
  text: string;
  tokens: number | null;
}

export async function infer(prompt: string): Promise<ModelResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { status: "MODEL_UNAVAILABLE", model: null, text: "No model credential.", tokens: null };
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 120,
    }),
  });
  if (!res.ok) return { status: "MODEL_UNAVAILABLE", model: null, text: `HTTP ${res.status}`, tokens: null };
  const body = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number }; model?: string };
  return {
    status: "OK",
    model: body.model ?? "grok-4",
    text: body.choices?.[0]?.message?.content ?? "",
    tokens: body.usage?.total_tokens ?? null,
  };
}
