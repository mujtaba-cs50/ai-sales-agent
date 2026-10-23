/**
 * Accuracy harness.   npm run eval            -> rules engine only (offline, deterministic)
 *                     npm run eval -- --llm   -> full pipeline with Gemini (needs GEMINI_API_KEY)
 * Exit code is 1 when overall accuracy is below THRESHOLD (default 0.97), so it can gate deployments.
 */
import { ASR, SLOTS, QA as QA1, QA_ROUND2, GUARD } from './cases.js';
const QA = [...QA1, ...QA_ROUND2];
import { normalizeTranscript } from '../backend/speech.js';
import { extractFromText } from '../backend/extract.js';
import { checkReply } from '../backend/guard.js';
import { handleChat } from '../backend/pipeline.js';

const useLlm = process.argv.includes('--llm');
const THRESHOLD = parseFloat(process.env.EVAL_THRESHOLD || '0.97');
// loaded lazily so the offline run does not need the Gemini SDK installed
const llm = useLlm ? (await import('../backend/llm.js')).createLlmClient() : null;
if (useLlm && !llm) { console.error('no AI provider key is set (GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY), cannot run --llm'); process.exit(2); }

let totalPass = 0, total = 0;
const failures: string[] = [];
function section(name: string, results: { ok: boolean; detail: string }[]) {
  const pass = results.filter((r) => r.ok).length;
  totalPass += pass; total += results.length;
  console.log(`${name.padEnd(34)} ${pass}/${results.length}  (${((pass / results.length) * 100).toFixed(1)}%)`);
  results.filter((r) => !r.ok).forEach((r) => failures.push(`[${name}] ${r.detail}`));
}

section('Speech-to-text repair', ASR.map((c) => {
  const out = normalizeTranscript(c.say).text;
  return { ok: c.expect.test(out), detail: `"${c.say}" -> "${out}"` };
}));

section('Slot extraction', SLOTS.map((c) => {
  const got = extractFromText(normalizeTranscript(c.say).text) as Record<string, unknown>;
  const keys = new Set([...Object.keys(c.expect), ...Object.keys(got).filter((k) => ['name', 'phone', 'city', 'billPkr', 'units', 'kw', 'acs', 'email'].includes(k))]);
  const ok = [...keys].every((k) => got[k] === (c.expect as Record<string, unknown>)[k]);
  return { ok, detail: `"${c.say}" expected ${JSON.stringify(c.expect)} got ${JSON.stringify(got)}` };
}));

section('Output guard', GUARD.map((c) => {
  const v = checkReply(c.reply, { grounding: [], userNumbers: [] });
  return { ok: v.ok === c.ok, detail: `"${c.reply}" expected ok=${c.ok} got ${JSON.stringify(v)}` };
}));

const qaResults: { ok: boolean; detail: string }[] = [];
for (const c of QA) {
  const msgs: { sender: string; text: string }[] = [{ sender: 'agent', text: 'Hello! How can I help you with solar today?' }];
  let last = '';
  let body: any = {};
  for (const turn of c.turns) {
    msgs.push({ sender: 'customer', text: turn });
    const r = await handleChat({ messages: msgs }, { llm });
    body = r.body;
    last = body.reply || '';
    msgs.push({ sender: 'agent', text: last });
  }
  const missing = c.must.filter((re) => !re.test(last));
  const bad = (c.not || []).filter((re) => re.test(last));
  qaResults.push({ ok: !missing.length && !bad.length, detail: `${JSON.stringify(c.turns)} -> "${last}"  missing=${missing} forbidden=${bad}` });
}
section(`Question answering ${useLlm ? '(LLM)' : '(rules)'}`, qaResults);

// lead de-duplication: the same phone must create exactly one lead event across a conversation
{
  const msgs: { sender: string; text: string }[] = [{ sender: 'agent', text: 'Hello!' }];
  let leadEvents = 0;
  for (const t of ['my bill is 50000', 'my number is 03001234567', 'what about batteries', 'and the price of 5kw', 'my name is Ali Khan', 'I live in Lahore', 'thanks']) {
    msgs.push({ sender: 'customer', text: t });
    const r = await handleChat({ messages: msgs }, { llm: null });
    if (r.body.capturedLead) leadEvents++;
    msgs.push({ sender: 'agent', text: r.body.reply || '' });
  }
  // phone, then name, then city each add information => 3 merge-able updates, never one per message
  section('Lead de-duplication', [{ ok: leadEvents === 3, detail: `expected 3 lead events (phone, name, city) but got ${leadEvents}` }]);
}

console.log(`\nOVERALL ${totalPass}/${total}  (${((totalPass / total) * 100).toFixed(1)}%)`);
if (failures.length) { console.log('\nFAILURES'); failures.forEach((f) => console.log(' -', f)); }
if (totalPass / total < THRESHOLD) process.exit(1);
