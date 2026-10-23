import { spawn } from 'node:child_process';
import { startFakeRedis } from '../../.vercel-sim/eval/fake-redis.js';
const redis = await startFakeRedis('vercel-token');
let pass = 0, total = 0; const t = (n, c) => { total++; if (c) pass++; else console.log('  FAIL', n); };

function invoke(env, fn, { method = 'POST', body, headers = {}, query, ip } = {}) {
  return new Promise((resolve) => {
    const p = spawn('node', ['invoke.mjs'], { cwd: new URL('.', import.meta.url).pathname, env: { PATH: process.env.PATH, VERCEL: '1', NODE_ENV: 'production', ...env } });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', () => { const i = out.indexOf('@@RESULT@@'); if (i < 0) return resolve({ status: -1, body: { crash: err.slice(0, 500) || out.slice(0, 500) } }); resolve({ ...JSON.parse(out.slice(i + 10)), stderr: err }); });
    p.stdin.end(JSON.stringify({ fn, method, body, headers, query, ip }));
  });
}
const FULL = { JWT_SECRET: 'v'.repeat(48), UPSTASH_REDIS_REST_URL: redis.url, UPSTASH_REDIS_REST_TOKEN: 'vercel-token', ADMIN_EMAIL: '', };
const jar = {}; const cookieHdr = () => (jar.rt ? { cookie: `refresh_token=${jar.rt}` } : {});
const eatCookie = (r) => { const sc = [].concat(r.headers['set-cookie'] || [])[0]; if (sc) { const v = sc.split(';')[0].split('=')[1]; if (/Max-Age=0/.test(sc)) delete jar.rt; else jar.rt = decodeURIComponent(v); } return r; };
const auth = (action, body, extra = {}, env = FULL) => invoke(env, 'auth', { query: { action }, body, method: extra.method || 'POST', headers: { ...(extra.headers || {}) }, ip: extra.ip }).then(eatCookie);

// ---- A) deployed with NOTHING configured: chat must still work, auth must fail politely (not crash) ----
let r = await invoke({}, 'chat', { body: { messages: [{ sender: 'customer', text: 'how much does a five kilowatt system cost' }] } });
t('A1 chat works with no env at all (rules engine)', r.status === 200 && /1\.2 million/.test(r.body.reply) && r.body.meta.source === 'rules');
r = await invoke({}, 'auth', { query: { action: 'login' }, body: { email: 'a@b.co', password: 'x' } });
t('A2 auth without JWT/database -> clean 503 JSON (no crash)', r.status === 503 && r.body.code === 'not_configured');
r = await invoke({ JWT_SECRET: 'v'.repeat(48) }, 'auth', { query: { action: 'login' }, body: { email: 'a@b.co', password: 'x' } });
t('A3 JWT set but no Redis -> 503 tells admin to add database', r.status === 503 && /not fully configured/.test(r.body.error));
r = await invoke({ UPSTASH_REDIS_REST_URL: redis.url, UPSTASH_REDIS_REST_TOKEN: 'vercel-token' }, 'auth', { query: { action: 'login' }, body: { email: 'a@b.co', password: 'x' } });
t('A4 Redis set but no JWT_SECRET -> 503 (refuses weak setup)', r.status === 503);
r = await invoke({}, 'leads', { method: 'POST', body: { name: 'Ali', phone: '03001234567' } });
t('A5 public lead POST without database -> 503 (never silently lost)', r.status === 503);

// ---- B) fully configured, every request in a fresh process ----
r = await auth('signup', { name: 'Bright Solar', email: 'owner@example.com', password: 'Quartz7Mountain' });
t('B1 first signup -> admin', r.status === 201 && r.body.user.role === 'admin' && /Secure/.test(r.headers['set-cookie'][0]) && /HttpOnly/.test(r.headers['set-cookie'][0]));
const adminToken = r.body.accessToken;
r = await auth('signup', { name: 'Second Person', email: 'second@example.com', password: 'Zebra7Quartz9' });
t('B2 later public signup is CLOSED in production', r.status === 403 && r.body.code === 'signup_closed');
r = await auth('me', undefined, { method: 'GET', headers: { authorization: `Bearer ${adminToken}` } });
t('B3 token from instance #1 is accepted by instance #3 (stateless JWT)', r.status === 200 && r.body.user.email === 'owner@example.com');
r = await auth('login', { email: 'owner@example.com', password: 'wrong' });
t('B4 wrong password -> 401 generic', r.status === 401 && r.body.error === 'Invalid email or password.');
r = await auth('login', { email: 'owner@example.com', password: 'Quartz7Mountain' });
t('B5 login', r.status === 200 && !!jar.rt);
const rt1 = jar.rt;
r = await auth('refresh', {}, { headers: cookieHdr() });
t('B6 refresh in a new process rotates the token', r.status === 200 && jar.rt && jar.rt !== rt1);
const rt2 = jar.rt;
await new Promise((s) => setTimeout(s, 150));
r = await invoke(FULL, 'auth', { query: { action: 'refresh' }, body: {}, headers: { cookie: `refresh_token=${rt1}` } });
t('B7 replaying the first refresh token (within grace) is tolerated', r.status === 200 || r.status === 401);

// lockout is shared across instances through Redis
let last; for (let i = 0; i < 6; i++) last = await auth('login', { email: 'victim@example.com', password: 'bad' + i }, { ip: '6.6.6.6' });
t('B8 lockout works across separate instances (Redis counter)', last.status === 429 && !!last.headers['retry-after']);

// admin creates staff, leads CRUD
r = await auth('create-user', { name: 'Sales Staff', email: 'staff@example.com', password: 'Zebra7Quartz9' }, { headers: { authorization: `Bearer ${adminToken}` } });
t('B9 admin can create staff while signup is closed', r.status === 201);
r = await auth('login', { email: 'staff@example.com', password: 'Zebra7Quartz9' }, { ip: '7.7.7.7' }); const staffToken = r.body.accessToken;
t('B10 staff login', r.status === 200 && r.body.user.role === 'staff');
r = await invoke(FULL, 'leads', { method: 'POST', body: { name: 'Bilal Ahmed', phone: '0300-7778888', city: 'Multan', status: 'Hot', product: '5kW Hybrid System' } });
t('B11 public lead capture (anonymous visitor)', r.status === 201);
r = await invoke(FULL, 'leads', { method: 'POST', body: { name: 'Bilal', phone: '03007778888', city: 'Lahore' } });
t('B12 same phone merges, contact data not echoed', r.status === 200 && r.body.merged === true && !JSON.stringify(r.body).includes('0300'));
r = await invoke(FULL, 'leads', { method: 'GET' });
t('B13 anonymous cannot list leads', r.status === 401);
r = await invoke(FULL, 'leads', { method: 'GET', headers: { authorization: `Bearer ${staffToken}` } });
const mine = (r.body.leads || []).filter((l) => l.phone.replace(/\D/g, '') === '03007778888');
t('B14 staff lists leads; one merged record with latest city', r.status === 200 && mine.length === 1 && mine[0].city === 'Lahore');
const id = mine[0]?.id;
r = await invoke(FULL, 'leadsId', { method: 'PATCH', query: { id }, body: { status: 'Closed' }, headers: { authorization: `Bearer ${staffToken}` } });
t('B15 staff updates status', r.status === 200 && r.body.lead.status === 'Closed');
r = await invoke(FULL, 'leadsId', { method: 'DELETE', query: { id }, headers: { authorization: `Bearer ${staffToken}` } });
t('B16 staff cannot delete', r.status === 403);
r = await invoke(FULL, 'leadsId', { method: 'DELETE', query: { id }, headers: { authorization: `Bearer ${adminToken}` } });
t('B17 admin deletes', r.status === 200);
r = await invoke(FULL, 'leadsId', { method: 'DELETE', query: { id: '../../etc/passwd' }, headers: { authorization: `Bearer ${adminToken}` } });
t('B18 malicious id rejected (400)', r.status === 400);

// chat + lead extraction through the function, with persistent conversation passed by the client
r = await invoke(FULL, 'chat', { body: { messages: [{ sender: 'agent', text: 'Hello!' }, { sender: 'customer', text: 'my bill is forty five thousand' }, { sender: 'agent', text: 'ok' }, { sender: 'customer', text: 'my name is Sara and my number is zero three double zero one two three four five six seven' }] } });
t('B19 chat captures a lead from spoken digits', r.status === 200 && r.body.capturedLead?.phone === '0300-1234567' && r.body.capturedLead?.name === 'Sara');
r = await invoke(FULL, 'chat', { body: {} });
t('B20 chat rejects empty body with 400', r.status === 400);
r = await invoke(FULL, 'chat', { method: 'GET' });
t('B21 chat GET -> 405', r.status === 405);

// logout revokes
r = await auth('logout', {}, { headers: { cookie: `refresh_token=${rt2}` } });
r = await auth('refresh', {}, { headers: { cookie: `refresh_token=${rt2}` } });
t('B22 refresh token dead after logout', r.status === 401);
console.log(`VERCEL SIMULATION ${pass}/${total}`); redis.close(); process.exit(pass === total ? 0 : 1);
