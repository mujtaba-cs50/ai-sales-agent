// One serverless "invocation" in a brand-new process (cold start every time), like Vercel instances that share nothing.
const input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); }));
const base = new URL('../../.vercel-sim/', import.meta.url).href;
const files = { chat: 'api/chat.js', auth: 'api/auth/[action].js', leads: 'api/leads.js', leadsId: 'api/leads/[id].js' };
const mod = await import(base + encodeURI(files[input.fn]));
const headers = {}; let status = 200, body;
const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(c) { status = c; return res; }, json(b) { body = b; return res; }, end() { return res; } };
const req = { method: input.method, headers: { host: 'myapp.vercel.app', 'x-forwarded-for': input.ip || '8.8.8.8', 'content-type': 'application/json', ...(input.headers || {}) }, body: input.body, query: input.query || {}, socket: { remoteAddress: '1.2.3.4' } };
await mod.default(req, res);
process.stdout.write('\n@@RESULT@@' + JSON.stringify({ status, headers, body }));
