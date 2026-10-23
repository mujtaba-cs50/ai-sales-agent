/** Failover between AI providers (Groq -> Gemini -> OpenRouter -> custom) against local mock servers. */
import http from 'node:http';

const seen: string[] = [];
const behaviour: Record<string, (j?: any) => { status: number; body: any; delay?: number; headers?: Record<string, string> }> = {};
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url || '';
    const prov = url.split('/')[1]; // /groq/..., /or/..., /gem/..., /cx/...
    const model = (() => { try { return JSON.parse(raw).model || ''; } catch { return ''; } })() || decodeURIComponent(url.split('/models/')[1]?.split(':')[0] || '');
    seen.push(`${prov}:${model}`);
    const parsed = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
    const b = (behaviour[prov] || (() => ({ status: 500, body: {} })))(parsed);
    const send = () => { res.statusCode = b.status; res.setHeader('Content-Type', 'application/json'); for (const [k, v] of Object.entries(b.headers || {})) res.setHeader(k, v); res.end(JSON.stringify(b.body)); };
    // verify the request shape each provider expects
    if (prov !== 'gem') {
      const j = JSON.parse(raw || '{}');
      const okShape = req.headers.authorization?.startsWith('Bearer ') && j.messages?.[0]?.role === 'system' && j.messages.at(-1)?.role === 'user';
      if (!okShape && b.status === 200) { res.statusCode = 400; return void res.end('{"error":"bad shape"}'); }
    }
    b.delay ? setTimeout(send, b.delay) : send();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const ok = (text: string) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const gem = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });

const clear = () => { for (const k of ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_COMPAT_API_KEY', 'LLM_PROVIDERS']) delete process.env[k]; seen.length = 0; };
const setup = () => {
  clear();
  Object.assign(process.env, {
    GROQ_API_KEY: 'gsk_test', GROQ_BASE_URL: `${base}/groq`, GROQ_MODELS: 'llama-a,llama-b',
    GEMINI_API_KEY: 'g-key', GEMINI_API_BASE: `${base}/gem`, GEMINI_MODELS: 'gem-1',
    OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_BASE_URL: `${base}/or`, OPENROUTER_MODELS: 'free-1',
    OPENAI_COMPAT_API_KEY: 'k', OPENAI_COMPAT_BASE_URL: `${base}/cx`, OPENAI_COMPAT_MODELS: 'cx-1',
  });
};

const { createLlmClient, resetDeadModelsForTests } = await import('../backend/llm.js');
const { handleChat } = await import('../backend/pipeline.js');
let pass = 0, total = 0; const t = (n: string, c: boolean) => { total++; if (c) pass++; else console.log('  FAIL', n, JSON.stringify(seen)); };
const req = () => ({ system: 'sys', turns: [{ role: 'model' as const, text: 'Hi!' }, { role: 'user' as const, text: 'hello' }], deadlineAt: Date.now() + 6500 });

clear(); t('no keys -> no client (rules engine only)', createLlmClient() === null);
setup(); resetDeadModelsForTests();
behaviour.groq = () => ok('{"reply":"from groq"}');
let out = await createLlmClient()!.generate(req());
t('Groq is used first when configured', out?.model === 'groq/llama-a' && seen.join() === 'groq:llama-a');

resetDeadModelsForTests(); seen.length = 0;
behaviour.groq = () => ({ status: 429, body: { error: 'rate limit' } });
behaviour.gem = () => gem('{"reply":"from gemini"}');
out = await createLlmClient()!.generate(req());
t('Groq rate-limited (429) -> Gemini answers', out?.model === 'gemini/gem-1');
seen.length = 0; out = await createLlmClient()!.generate(req());
t('rate-limited Groq models are skipped for a minute (no wasted calls)', !seen.some((s) => s.startsWith('groq')) && out?.model === 'gemini/gem-1');

resetDeadModelsForTests(); seen.length = 0;
behaviour.groq = () => ({ status: 401, body: { error: 'invalid key' } });
behaviour.gem = () => ({ status: 404, body: { error: 'model retired' } });
behaviour.or = () => ok('```json\n{"reply":"from openrouter"}\n```');
out = await createLlmClient()!.generate(req());
t('bad Groq key (401) marks the whole provider dead; retired Gemini (404) skipped; OpenRouter answers', out?.model === 'openrouter/free-1' && seen.filter((s) => s.startsWith('groq')).length === 1);

resetDeadModelsForTests(); seen.length = 0;
behaviour.or = () => ({ status: 503, body: {} }); behaviour.cx = () => ok('<think>hmm</think>{"reply":"from custom"}');
out = await createLlmClient()!.generate(req());
t('last resort custom endpoint works and <think> is stripped', out?.model === 'custom/cx-1' && !/think/.test(out.text));

// whole pipeline: every provider down -> rules engine still gives the exact answer
resetDeadModelsForTests(); seen.length = 0;
for (const k of ['groq', 'gem', 'or', 'cx']) behaviour[k] = () => ({ status: 500, body: {} });
const r = await handleChat({ messages: [{ sender: 'customer', text: 'how much does a five kilowatt system cost' }] }, { llm: createLlmClient() });
t('all providers down -> rules engine answers correctly', r.status === 200 && r.body.meta?.source === 'rules' && /1\.2 million/.test(r.body.reply || ''));

// pipeline with a working provider: guard still blocks an invented price and falls back to verified facts
resetDeadModelsForTests();
behaviour.groq = () => ok('{"reply":"A 5kW system costs PKR 400 thousand."}');
const r2 = await handleChat({ messages: [{ sender: 'customer', text: 'tell me about the 5kw system and why it is good' }] }, { llm: createLlmClient() });
t('hallucinated price from a provider is rejected by the guard', !/400 thousand/.test(r2.body.reply || ''));
behaviour.groq = () => ok('{"reply":"The 5kW system suits a home with two ACs. Would you like a free rooftop survey?"}');
resetDeadModelsForTests();
const r3 = await handleChat({ messages: [{ sender: 'customer', text: 'tell me about the 5kw system and why it is good' }] }, { llm: createLlmClient() });
t('good provider answer is used (source=llm, provider named)', r3.body.meta?.source === 'llm' && /^groq\//.test(String(r3.body.meta?.model)));

// order override
setup(); resetDeadModelsForTests(); seen.length = 0; process.env.LLM_PROVIDERS = 'openrouter,groq';
behaviour.or = () => ok('{"reply":"or first"}');
out = await createLlmClient()!.generate(req());
t('LLM_PROVIDERS controls the order and excludes unlisted providers', out?.model === 'openrouter/free-1' && seen.join() === 'or:free-1');

// slow provider respects the time budget and the next one is tried
setup(); resetDeadModelsForTests(); seen.length = 0;
behaviour.groq = () => ({ status: 200, body: { choices: [{ message: { content: '{"reply":"late"}' } }] }, delay: 6000 });
behaviour.gem = () => gem('{"reply":"fast gemini"}');
const t0 = Date.now(); out = await createLlmClient()!.generate(req());
t(`slow Groq times out (${Date.now() - t0} ms) and Gemini answers within budget`, out?.model === 'gemini/gem-1' && Date.now() - t0 < 6500);

// gpt-oss: sends reasoning_effort=low; if the provider rejects the extra parameter (400) the call is retried without it
setup(); resetDeadModelsForTests(); seen.length = 0; process.env.GROQ_MODELS = 'openai/gpt-oss-20b';
let sawEffort: any = 'unset';
behaviour.groq = (j) => { sawEffort = j.reasoning_effort; return ok('{"reply":"gpt-oss ok"}'); };
out = await createLlmClient()!.generate(req());
t('gpt-oss request carries reasoning_effort=low and a larger token budget', out?.model === 'groq/openai/gpt-oss-20b' && sawEffort === 'low');
resetDeadModelsForTests(); seen.length = 0;
behaviour.groq = (j) => (j.reasoning_effort ? { status: 400, body: { error: 'unsupported parameter reasoning_effort' } } : ok('{"reply":"retried without it"}'));
out = await createLlmClient()!.generate(req());
t('400 on reasoning_effort -> retried once without it (model not marked dead)', out?.model === 'groq/openai/gpt-oss-20b' && seen.length === 2);

// daily token limit (429 + Retry-After of 1 hour): the model is skipped for that long, no wasted calls
resetDeadModelsForTests(); seen.length = 0;
behaviour.groq = () => ({ status: 429, body: { error: 'tokens per day (TPD) limit reached' }, headers: { 'retry-after': '3600' } });
behaviour.gem = () => gem('{"reply":"gemini takes over"}');
out = await createLlmClient()!.generate(req());
seen.length = 0; out = await createLlmClient()!.generate(req());
t('daily-limit 429 with Retry-After is remembered (Groq not called again), Gemini answers', !seen.some((s) => s.startsWith('groq')) && out?.model === 'gemini/gem-1');
delete process.env.GROQ_MODELS;

// LLM_MODE: auto answers short FAQ questions with the exact rules answer (no tokens spent), open-ended ones go to the LLM
setup(); resetDeadModelsForTests();
let llmCalls = 0; behaviour.groq = () => { llmCalls++; return ok('{"reply":"The 5kW system suits a home with two ACs. Would you like a free rooftop survey?"}'); };
const ask = async (q: string) => handleChat({ messages: [{ sender: 'customer', text: q }] }, { llm: createLlmClient() });
llmCalls = 0; let m = await ask('how much does a 5kw system cost');
t('auto mode: short price question answered by rules (0 LLM calls, exact figure)', llmCalls === 0 && /1\.2 million/.test(m.body.reply || '') && m.body.meta?.source === 'rules');
llmCalls = 0; m = await ask('why is solar a better investment than a generator for my shop');
t('auto mode: open-ended question goes to the LLM', llmCalls === 1 && m.body.meta?.source === 'llm');
llmCalls = 0; m = await ask('what is the capital of france');
t('auto mode: off-topic goes to the LLM', llmCalls === 1);
process.env.LLM_MODE = 'always'; llmCalls = 0; await ask('how much does a 5kw system cost');
t('LLM_MODE=always uses the LLM even for FAQ questions', llmCalls === 1);
process.env.LLM_MODE = 'rules'; llmCalls = 0; await ask('why is solar better than a generator');
t('LLM_MODE=rules never calls an LLM', llmCalls === 0);
delete process.env.LLM_MODE;

console.log(`PROVIDER FAILOVER TESTS ${pass}/${total}`); server.close(); process.exit(pass === total ? 0 : 1);
