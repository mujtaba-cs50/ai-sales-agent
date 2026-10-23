/**
 * Chat pipeline (shared by Express server.ts and the Vercel function api/chat.ts):
 *
 *   validate -> repair speech-to-text errors -> extract slots -> rules engine draft
 *     -> (fast intents answered directly) -> grounded LLM answer -> output guard -> retry / fallback
 *     -> lead capture (stateless de-duplication) -> speakable reply
 *
 * Response contract is backward compatible with the existing UI: { reply, capturedLead }.
 */
import { CONFIG } from './config.js';
import { normalizeTranscript, toSpeakable } from './speech.js';
import { extractFromText, maybeBuildLead, slotsFromHistory, type Msg, type LeadOut } from './extract.js';
import { composeFallback } from './fallback.js';
import { recommend, describeRecommendation } from './sizing.js';
import { retrieve, KB_CHUNKS } from './kb.js';
import { checkReply, looksLikeInjection } from './guard.js';
import { buildSystemPrompt, parseModelOutput } from './prompt.js';
import type { LlmClient, LlmTurn } from './llm.js';

export interface ChatResult {
  status: number;
  body: {
    reply?: string;
    capturedLead?: LeadOut | null;
    error?: string;
    meta?: Record<string, unknown>;
  };
}

interface RawMsg { sender?: unknown; role?: unknown; text?: unknown; content?: unknown }

/** Intents the rules engine answers perfectly and instantly; no need to pay LLM latency for them. */
const FAST_INTENTS = new Set([
  'contact_captured', 'contact_partial', 'greeting', 'thanks', 'human', 'affirm_contact', 'affirm_done', 'negative',
  'survey', 'identity', 'city_given',
]);
/** Intents where a verified draft exists, so the LLM only has to phrase it naturally. */
/**
 * Intents where the rules engine's answer is exact and complete. In LLM_MODE=auto a SHORT, single-topic message with one of
 * these intents is answered by the rules engine directly: instant, 100% faithful to the data, and it saves free-tier LLM tokens.
 * The LLM is used for open-ended, compound, unknown and off-topic questions, where it adds real value.
 */
const EXACT_INTENTS = /^(kb:|battery|inverter|panels$|panel_price|panel_count|price_|sizing|compare|output_pkg|ac_capacity|objection_price|quote_request|commercial|unknown_bill)/;
const OPEN_ENDED = /\b(why|explain|compare|comparison|better|worse|than|versus|vs|best|recommend|should|advice|opinion|think|difference|different|pros|cons|worth)\b/i;
export function rulesAreEnough(intent: string, text: string): boolean {
  if (!EXACT_INTENTS.test(intent) || /^kb:unknown/.test(intent)) return false;
  const words = text.trim().split(/\s+/).length;
  return words <= 14 && (text.match(/\?/g) || []).length <= 1 && !OPEN_ENDED.test(text);
}
const DRAFT_INTENTS = /^(price_|sizing|kb:|battery|inverter|panel|ac_capacity|objection_price|product_context)/;

/** Never let a slow or crashing model hold the customer: resolve to null when time is up or on any error. */
async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } catch (e) {
    console.warn('[chat] llm error:', (e as Error)?.message || e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const msgs: Msg[] = [];
  for (const m of raw.slice(-24) as RawMsg[]) {
    const textRaw = typeof m?.text === 'string' ? m.text : typeof m?.content === 'string' ? m.content : '';
    const text = textRaw.replace(/\s+/g, ' ').trim().slice(0, CONFIG.maxTextChars);
    if (!text) continue;
    const who = String(m?.sender ?? m?.role ?? '').toLowerCase();
    const sender: Msg['sender'] = who === 'customer' || who === 'user' ? 'customer' : 'agent';
    msgs.push({ sender, text });
  }
  return msgs.length ? msgs : null;
}

export async function handleChat(
  body: any,
  deps: { llm: LlmClient | null; now?: () => number } = { llm: null }
): Promise<ChatResult> {
  const now = deps.now || Date.now;
  const started = now();
  const deadlineAt = started + CONFIG.totalBudgetMs;

  const parsed = parseMessages(body?.messages);
  if (!parsed) return { status: 400, body: { error: 'Messages array is required.' } };
  if (parsed[parsed.length - 1].sender !== 'customer') return { status: 400, body: { error: 'Last message must come from the customer.' } };

  const productContext = typeof body?.productContext === 'string' && body.productContext.trim() ? body.productContext.trim().slice(0, 120) : null;

  // 1) repair speech-to-text mistakes in every customer message
  const history: Msg[] = parsed.map((m) => (m.sender === 'customer' ? { ...m, text: normalizeTranscript(m.text).text } : m));
  const last = history[history.length - 1];
  const rawLast = parsed[parsed.length - 1].text;

  if (!/[a-z0-9]{2,}/i.test(last.text)) {
    return { status: 200, body: { reply: "Sorry, I didn't catch that. Could you please say it again?", capturedLead: null, meta: { source: 'rules', intent: 'unclear' } } };
  }

  // 2) understand
  const prevHistory = history.slice(0, -1);
  const prior = slotsFromHistory(prevHistory);
  const slots = slotsFromHistory(history);
  const lastAgentBefore = [...prevHistory].reverse().find((m) => m.sender === 'agent')?.text || '';
  const asked = /\b(your|the)\s+name\b|what(?:'s| is)\s+your\s+name|\bname\b.*\bphone\b/i.test(lastAgentBefore);
  const current = extractFromText(last.text, { askedForName: asked });
  // a field only counts as "new" when it differs from what was known before this message
  for (const k of Object.keys(current) as (keyof typeof current)[]) if (current[k] === prior[k]) delete current[k];

  // 3) rules-engine draft (also the safety net)
  const draft = composeFallback({ text: last.text, history, slots, current, productContext });

  let reply = draft.reply;
  let source: 'rules' | 'llm' = 'rules';
  let model: string | undefined;
  let guardIssues: string[] | undefined;

  const mode = CONFIG.llmMode;
  const useLlm = !!deps.llm && mode !== 'rules' && !FAST_INTENTS.has(draft.intent) && !(mode === 'auto' && rulesAreEnough(draft.intent, last.text));
  if (useLlm) {
    const rec = recommend({ billPkr: slots.billPkr, units: slots.units, kw: slots.kw, acs: slots.acs });
    const tools = rec ? [describeRecommendation(rec, slots.units)] : [];
    const hits = retrieve(last.text + ' ' + (history.length > 1 ? history[history.length - 2].text : ''), 2, 1.5);
    const facts = (hits.length ? hits.map((h) => h.chunk.text) : [KB_CHUNKS.find((c) => c.id === 'survey')!.text]);
    const reference = DRAFT_INTENTS.test(draft.intent) ? draft.reply : undefined;
    const injection = looksLikeInjection(rawLast);

    const turns: LlmTurn[] = history.slice(-8).map((m) => ({ role: m.sender === 'customer' ? 'user' : 'model', text: m.text }));
    const userNumbers = [slots.billPkr, slots.units].filter((n): n is number => !!n);
    const grounding = [...facts, ...tools, ...(reference ? [reference] : [])];

    const needPackages = /price|sizing|compare|panel_count|output|objection|product_context|kb:sizing|kb:output/.test(draft.intent) || /\b(price|cost|how much|package|packages|system|size|kw)\b/i.test(last.text);
    let corrections: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (deadlineAt - now() < 1200) break;
      const system = buildSystemPrompt({ slots, facts, tools, reference, productContext, injection, corrections, includePackages: needPackages });
      const out = await withDeadline(
        deps.llm!.generate({ system, turns, deadlineAt, temperature: attempt === 0 ? 0.3 : 0.1 }),
        deadlineAt - now()
      );
      if (!out) break;
      const parsedOut = parseModelOutput(out.text);
      if (!parsedOut) { corrections = ['the reply was not valid JSON with a "reply" field']; continue; }
      const candidate = toSpeakable(parsedOut.reply);
      const verdict = checkReply(candidate, { grounding, userNumbers });
      if (verdict.ok) { reply = candidate; source = 'llm'; model = out.model; guardIssues = undefined; break; }
      guardIssues = verdict.issues;
      corrections = verdict.issues;
    }
  }

  // 4) lead capture (only when the current message adds new contact info)
  const capturedLead = maybeBuildLead(prior, slots, current, rawLast, productContext);

  return {
    status: 200,
    body: {
      reply: toSpeakable(reply),
      capturedLead,
      meta: {
        source,
        intent: draft.intent,
        model,
        guardRejected: guardIssues,
        heardAs: last.text !== rawLast ? last.text : undefined,
        latencyMs: now() - started,
      },
    },
  };
}
