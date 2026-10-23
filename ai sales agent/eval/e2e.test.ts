process.env.JWT_SECRET = 'k'.repeat(48); process.env.DATA_DIR = '/tmp/solar-e2e'; process.env.ACCESS_TOKEN_TTL_SEC = '1'; process.env.NODE_ENV = 'development';
import fs from 'node:fs'; import http from 'node:http'; fs.rmSync('/tmp/solar-e2e', { recursive: true, force: true });
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { authRoute, leadsRoute } = await import(`${R}/backend/auth/handlers.js`);
const { writeResponse } = await import(`${R}/backend/http.js`);

// minimal server that mimics the Express adapter in server.ts
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', async () => {
    const shim: any = Object.assign(res, { status(c: number) { res.statusCode = c; return shim; }, json(b: any) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); } });
    let body: any = {}; try { body = raw ? JSON.parse(raw) : {}; } catch {}
    const base = { method: req.method!, headers: req.headers, body, ip: '5.5.5.5', secure: false };
    const url = new URL(req.url!, 'http://x'); const p = url.pathname;
    if (p.startsWith('/api/auth/')) return writeResponse(shim, await authRoute(p.split('/')[3], base));
    if (p === '/api/leads') return writeResponse(shim, await leadsRoute(undefined, base));
    if (p.startsWith('/api/leads/')) return writeResponse(shim, await leadsRoute(p.split('/')[3], base));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;

// browser-like fetch with a cookie jar, same-origin headers
const jar = new Map<string, string>(); const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (path: string, init: any = {}) => {
  const headers: any = { ...(init.headers || {}), host: `localhost:${port}`, origin: `http://localhost:${port}` };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await realFetch(`http://localhost:${port}${path}`, { ...init, headers });
  for (const sc of (res.headers as any).getSetCookie?.() || []) {
    const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
    if (/Max-Age=0/.test(sc)) jar.delete(k); else jar.set(k, v);
  }
  return res;
};
(globalThis as any).localStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };

const auth = await import(`${R}/src/services/authClient.js`);
const crm = await import(`${R}/src/services/crmStorage.js`);
let pass = 0, total = 0; const t = (n: string, c: boolean) => { total++; if (c) pass++; else console.log('  FAIL', n); };

t('no session at start', (await auth.restoreSession()) === null);
let r = await auth.login('nobody@example.com', 'Whatever123');
t('bad login shows server error (no fake login!)', !r.success && r.error === 'Invalid email or password.' && auth.getUser() === null);
r = await auth.register('Bright Solar', 'owner@example.com', 'short');
t('weak password error surfaced', !r.success && /8 characters/.test(r.error));
r = await auth.register('Bright Solar', 'owner@example.com', 'Quartz7Mountain');
t('signup logs in', r.success && auth.getUser()?.role === 'admin' && jar.has('refresh_token'));
await new Promise((s) => setTimeout(s, 1500)); // access token (1s TTL) is now expired
await crm.refreshLeads();
t('expired access token auto-refreshed, leads loaded', crm.getLeads().length >= 3);
crm.saveLead({ name: 'Bilal', phone: '0300-7778888', city: 'Multan', status: 'Hot' });
await new Promise((s) => setTimeout(s, 300)); await crm.refreshLeads();
t('assistant lead appears in dashboard list', crm.getLeads().some((l: any) => l.phone === '0300-7778888'));
const id = crm.getLeads().find((l: any) => l.phone === '0300-7778888').id;
crm.updateLeadStatus(id, 'Closed'); await new Promise((s) => setTimeout(s, 300)); await crm.refreshLeads();
t('status update persisted on server', crm.getLeads().find((l: any) => l.id === id).status === 'Closed');
crm.deleteLead(id); await new Promise((s) => setTimeout(s, 300)); await crm.refreshLeads();
t('delete persisted on server', !crm.getLeads().some((l: any) => l.id === id));

// reload simulation: memory wiped, cookie remains
const jarCopy = new Map(jar);
await auth.logout(); t('logout clears user + leads', auth.getUser() === null && crm.getLeads().length === 0 && !jar.has('refresh_token'));
let anonymous = await realFetch(`http://localhost:${port}/api/leads`, { headers: { host: `localhost:${port}` } });
t('API refuses anonymous lead listing', anonymous.status === 401);
for (const [k, v] of jarCopy) jar.set(k, v); // pretend the browser still sent the old cookie after logout
t('old refresh cookie is dead after logout', (await auth.restoreSession()) === null);
r = await auth.login('owner@example.com', 'Quartz7Mountain'); t('login again works', r.success && auth.getUser()?.email === 'owner@example.com');
console.log(`E2E ${pass}/${total}`); server.close(); process.exit(0);
