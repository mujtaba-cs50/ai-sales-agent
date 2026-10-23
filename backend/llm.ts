/**
 * Multi-provider LLM client with automatic failover (plain fetch, no SDKs).
 *
 *   Groq (free tier)  ->  Google Gemini  ->  OpenRouter (:free models)  ->  any OpenAI-compatible endpoint
 *
 * Only providers whose API key is set are used, in the order of LLM_PROVIDERS (default: groq,gemini,openrouter,custom).
 * A provider/model that fails is skipped for a while (retired model 10 min, bad key 30 min, rate limit 1 min,
 * timeout 15 s) so it never burns the time budget of every request. If everything fails the caller falls back to the
 * built-in rules engine, so the assistant keeps answering even with no AI provider at all.
 */
import { CONFIG } from './config.js';

export interface LlmTurn { role: 'user' | 'model'; text: string }
export interface LlmRequest { system: string; turns: LlmTurn[]; deadlineAt: number; temperature?: number }
export interface LlmClient {
  generate(req: LlmRequest): Promise<{ text: string; model: string } | null>;
}

type Kind = 'openai' | 'gemini';
export interface Provider { name: string; kind: Kind; base: string; key: string; models: string[]; headers?: Record<string, string> }

/** Gemini requires alternating roles starting with "user"; merge repeats and drop a leading model turn. */
function normalizeTurns(turns: LlmTurn[]): LlmTurn[] {
  const merged: LlmTurn[] = [];
  for (const t of turns) {
    if (!t.text.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += '\n' + t.text;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}
export const toContents = (turns: LlmTurn[]) => normalizeTurns(turns).map((t) => ({ role: t.role, parts: [{ text: t.text }] }));

const list = (v?: string) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
/** Ignore empty values and the placeholder text from .env.example. */
const realKey = (v?: string) => (v && !/^(your_|my_|changeme|xxx)/i.test(v.trim()) ? v.trim() : undefined);

export function configuredProviders(): Provider[] {
  const e = process.env;
  const all: Record<string, Provider | null> = {
    groq: realKey(e.GROQ_API_KEY)
      ? { name: 'groq', kind: 'openai', base: e.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', key: realKey(e.GROQ_API_KEY)!, models: list(e.GROQ_MODELS).length ? list(e.GROQ_MODELS) : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'] }
      : null,
    gemini: CONFIG.apiKey() ? { name: 'gemini', kind: 'gemini', base: CONFIG.geminiBase(), key: CONFIG.apiKey()!, models: CONFIG.models } : null,
    openrouter: realKey(e.OPENROUTER_API_KEY)
      ? {
          name: 'openrouter', kind: 'openai', base: e.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', key: realKey(e.OPENROUTER_API_KEY)!,
          models: list(e.OPENROUTER_MODELS).length ? list(e.OPENROUTER_MODELS) : ['openai/gpt-oss-120b:free', 'meta-llama/llama-3.3-70b-instruct:free'],
          headers: { 'HTTP-Referer': e.APP_URL || 'https://localhost', 'X-Title': 'AI Solar Sales Agent' },
        }
      : null,
    custom: realKey(e.OPENAI_COMPAT_API_KEY) && e.OPENAI_COMPAT_BASE_URL && list(e.OPENAI_COMPAT_MODELS).length
      ? { name: 'custom', kind: 'openai', base: e.OPENAI_COMPAT_BASE_URL.replace(/\/+$/, ''), key: realKey(e.OPENAI_COMPAT_API_KEY)!, models: list(e.OPENAI_COMPAT_MODELS) }
      : null,
  };
  const order = list(e.LLM_PROVIDERS).length ? list(e.LLM_PROVIDERS) : ['groq', 'gemini', 'openrouter', 'custom'];
  return order.map((n) => all[n.toLowerCase()]).filter((p): p is Provider => !!p);
}

class HttpFail extends Error {
  constructor(public status: number, message: string, public retryAfterSec = 0) { super(message); }
}

const deadUntil = new Map<string, number>();
export const resetDeadModelsForTests = () => deadUntil.clear();

async function post(url: string, headers: Record<string, string>, body: unknown, ms: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
      throw new HttpFail(res.status, `HTTP ${res.status} ${detail}`, parseInt(res.headers.get('retry-after') || '0', 10) || 0);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Reasoning models may prefix their answer with <think>...</think>; drop it. */
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function callGemini(p: Provider, model: string, req: LlmRequest, ms: number): Promise<string> {
  const data = await post(
    `${p.base}/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': p.key },
    {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toContents(req.turns),
      generationConfig: { temperature: req.temperature ?? 0.3, topP: 0.9, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    },
    ms
  );
  return (data?.candidates?.[0]?.content?.parts || []).map((x: any) => (typeof x?.text === 'string' ? x.text : '')).join('');
}

async function callOpenAi(p: Provider, model: string, req: LlmRequest, ms: number): Promise<string> {
  const messages = [
    { role: 'system', content: req.system },
    ...normalizeTurns(req.turns).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
  ];
  const headers = { Authorization: `Bearer ${p.key}`, ...(p.headers || {}) };
  const base = { model, messages, temperature: req.temperature ?? 0.3, top_p: 0.9 };
  // gpt-oss models "think" before answering: ask for low effort (faster, fewer tokens) and leave room for the reasoning tokens
  const reasoning = /gpt-oss/i.test(model);
  let data: any;
  try {
    data = await post(`${p.base}/chat/completions`, headers, reasoning ? { ...base, max_tokens: 900, reasoning_effort: 'low' } : { ...base, max_tokens: 500 }, ms);
  } catch (e) {
    if (reasoning && e instanceof HttpFail && e.status === 400) data = await post(`${p.base}/chat/completions`, headers, { ...base, max_tokens: 900 }, ms); // provider rejected the extra parameter
    else throw e;
  }
  const c = data?.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

export function createLlmClient(providers: Provider[] = configuredProviders()): LlmClient | null {
  if (!providers.length) return null;
  return {
    async generate(req) {
      if (!normalizeTurns(req.turns).length) return null;
      for (const p of providers) {
        for (const model of p.models) {
          const id = `${p.name}/${model}`;
          const now = Date.now();
          if ((deadUntil.get(id) || 0) > now || (deadUntil.get(`${p.name}/*`) || 0) > now) continue;
          const remaining = req.deadlineAt - now;
          if (remaining < 900) return null; // not enough time for another attempt
          const ms = Math.min(remaining - 250, CONFIG.perAttemptMs);
          try {
            const raw = p.kind === 'gemini' ? await callGemini(p, model, req, ms) : await callOpenAi(p, model, req, ms);
            const text = stripThink(raw);
            if (text) return { text, model: id };
            console.warn(`[llm] ${id} returned no text`);
          } catch (e: any) {
            const status = e instanceof HttpFail ? e.status : 0;
            console.warn(`[llm] ${id} failed: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`);
            if (status === 401 || status === 403) deadUntil.set(`${p.name}/*`, Date.now() + 30 * 60_000); // bad / unauthorised key
            else if (status === 404 || status === 400) deadUntil.set(id, Date.now() + 10 * 60_000); // retired / unknown model
            else if (status === 429) {
              // rate limited: honour Retry-After (a per-day token limit can mean hours), 30 s to 6 h
              const wait = Math.min(Math.max((e as HttpFail).retryAfterSec * 1000, 30_000), 6 * 3600_000);
              deadUntil.set(id, Date.now() + wait);
            }
            else {
              // timeout / network / 5xx: the provider itself is struggling, so move on to the NEXT provider quickly
              deadUntil.set(`${p.name}/*`, Date.now() + 15_000);
              break;
            }
          }
        }
      }
      return null;
    },
  };
}

/** Gemini-only client (kept for tests and for people who only have a Gemini key). */
export function createGeminiClient(apiKey = CONFIG.apiKey()): LlmClient | null {
  if (!apiKey) return null;
  return createLlmClient([{ name: 'gemini', kind: 'gemini', base: CONFIG.geminiBase(), key: apiKey, models: CONFIG.models }]);
}
