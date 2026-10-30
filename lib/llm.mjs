// Optional "plain LLM, no Qloo" baseline. Only runs when OPENAI_API_KEY is set; otherwise reports that it was not run.
// It receives only business and city names. Never personal data.
export async function askLLM(prompt, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || 'null');
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function llmShortlist({ shop, homeCity, targetCity }) {
  const out = await askLLM(`A small business called "${shop}" does well in ${homeCity}. Name the 3 neighbourhoods in ${targetCity} where it should open next. Reply as JSON: {"neighbourhoods":["..","..",".."],"why":"one sentence"}`);
  if (!out || !Array.isArray(out.neighbourhoods)) return { status: 'not_run', note: 'Set OPENAI_API_KEY to show what a plain LLM would say without Qloo.' };
  return { status: 'ok', neighbourhoods: out.neighbourhoods.slice(0, 3).map(String), why: String(out.why || '').slice(0, 240) };
}
