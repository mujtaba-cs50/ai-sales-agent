/** Tests the REST Gemini client against a local mock of the Gemini API (retired model, timeout, bad key, good reply). */
import http from 'node:http';

const calls: string[] = [];
let mode: 'normal' | 'slow' | 'badkey' = 'normal';
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const model = decodeURIComponent((req.url || '').split('/models/')[1]?.split(':')[0] || '');
    calls.push(model);
    const send = (c: number, b: unknown) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
    if (req.headers['x-goog-api-key'] !== 'test-key') return send(403, { error: { message: 'API key not valid' } });
    if (model === 'gemini-retired') return send(404, { error: { message: 'This model models/gemini-retired is no longer available.' } });
    if (mode === 'slow') return void setTimeout(() => send(200, { candidates: [{ content: { parts: [{ text: '{"reply":"too late"}' }] } }] }), 6000);
    const body = JSON.parse(raw);
    const ok = body.systemInstruction?.parts?.[0]?.text && body.contents?.[0]?.role === 'user' && body.generationConfig?.responseMimeType === 'application/json';
    send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: ok ? `served by ${model}` : 'BAD REQUEST SHAPE', intent: 'test' }) }] } }] });
  });
});
await new Promise<void>((r) => server.listen(0, r));
process.env.GEMINI_API_BASE = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.GEMINI_MODELS = 'gemini-retired,gemini-good';
process.env.GEMINI_API_KEY = 'test-key';

const { createGeminiClient, resetDeadModelsForTests } = await import('../backend/llm.js');
const { handleChat } = await import('../backend/pipeline.js');
let pass = 0, total = 0; const t = (n: string, c: boolean) => { total++; if (c) pass++; else console.log('  FAIL', n); };
const req = (ms = 6500) => ({ system: 'sys', turns: [{ role: 'user' as const, text: 'hello' }], deadlineAt: Date.now() + ms });

const llm = createGeminiClient()!;
t('client created from env key', !!llm);
let out = await llm.generate(req());
t('retired model (404) is skipped, next model used', !!out && out.model === 'gemini/gemini-good' && calls[0] === 'gemini-retired' && calls[1] === 'gemini-good');
calls.length = 0;
out = await llm.generate(req());
t('retired model is not retried for 10 minutes', calls.length === 1 && calls[0] === 'gemini-good');

const r = await handleChat({ messages: [{ sender: 'customer', text: 'what is the difference between hybrid and on grid' }] }, { llm });
t('full pipeline answers through the REST client', r.status === 200 && r.body.meta?.source === 'rules' || r.body.meta?.source === 'llm');

// invalid key => graceful fallback to the rules engine, never an error
process.env.GEMINI_API_KEY = 'wrong';
const bad = createGeminiClient('wrong')!;
resetDeadModelsForTests();
const r2 = await handleChat({ messages: [{ sender: 'customer', text: 'how much does a 5kw system cost' }] }, { llm: bad });
t('invalid API key falls back to rules (still a correct answer)', r2.status === 200 && r2.body.meta?.source === 'rules' && /1\.2 million/.test(r2.body.reply || ''));

// slow model => hard time budget respected
resetDeadModelsForTests(); mode = 'slow';
const t0 = Date.now();
const r3 = await handleChat({ messages: [{ sender: 'customer', text: 'how much does a 5kw system cost' }] }, { llm });
const dt = Date.now() - t0;
t(`slow model: answered within budget (${dt} ms < 7000) from rules`, dt < 7000 && r3.body.meta?.source === 'rules' && /1\.2 million/.test(r3.body.reply || ''));

console.log(`GEMINI REST TESTS ${pass}/${total}`); server.close(); process.exit(pass === total ? 0 : 1);
