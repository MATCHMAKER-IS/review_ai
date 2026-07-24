const API_URL = "https://api.openai.com/v1/chat/completions";

export class AiError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export async function chatJson(system: string, user: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError("OPENAI_API_KEY が未設定です");

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.OPENAI_TIMEOUT_MS ?? 90_000),
  );

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.6",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      throw new AiError(`OpenAI ${res.status}`, await res.text().catch(() => ""));
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AiError("content が空です", data);

    try {
      return JSON.parse(content);
    } catch {
      throw new AiError("JSONとしてパースできません", content.slice(0, 400));
    }
  } finally {
    clearTimeout(timer);
  }
}
