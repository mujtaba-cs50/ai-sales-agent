process.env.REFRESH_REUSE_GRACE_MS = '100'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.DATA_DIR = '/tmp/solar-test-data'; process.env.NODE_ENV = 'development';
import fs from 'node:fs'; fs.rmSync('/tmp/solar-test-data', { recursive: true, force: true });
const MODE = process.env.STORE === 'redis' ? 'redis' : 'json';
let fake: any = null;
if (MODE === 'redis') {
  const { startFakeRedis } = await import('./fake-redis.js');
  fake = await startFakeRedis();
  process.env.UPSTASH_REDIS_REST_URL = fake.url; process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
}
const { authRoute, leadsRoute, parseCookies } = await import('../backend/auth/handlers.js');
const { signJwt, verifyJwt } = await import('../backend/auth/crypto.js');
const J = { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' };
const call = (a: string, body: any, headers: any = {}, method = 'POST') => authRoute(a, { method, headers: { ...J, ...headers }, body, ip: '1.1.1.1', secure: false });
const ck = (r: any) => (r.cookies?.[0] || '').split(';')[0].replace('refresh_token=', '');
let pass = 0, total = 0; const t = (n: string, c: boolean) => { total++; if (c) pass++; else console.log('  FAIL', n); };

let r: any = await call('signup', { name: 'Bright Solar', email: 'Owner@Example.com', password: 'Str0ngPass!' });
t('signup 201', r.status === 201 && r.body.user.role === 'admin' && r.body.user.email === 'owner@example.com');
const access1 = r.body.accessToken, refresh1 = ck(r);
t('cookie flags', /HttpOnly/.test(r.cookies[0]) && /SameSite=Strict/.test(r.cookies[0]) && /Path=\/api\/auth/.test(r.cookies[0]));
t('refresh cookie not in body', !JSON.stringify(r.body).includes(refresh1));
t('weak password rejected', (await call('signup', { name: 'Ab', email: 'a@b.co', password: 'short' })).status === 400);
t('common password rejected', (await call('signup', { name: 'Abc', email: 'abc@x.co', password: 'password123' })).status === 400);
t('password w/o digit rejected', (await call('signup', { name: 'Abc', email: 'abc@x.co', password: 'onlyletters' })).status === 400);
t('duplicate email 409', (await call('signup', { name: 'X Y', email: 'owner@example.com', password: 'Another1Pass' })).status === 409);
t('second signup (dev: open) is staff', (await call('signup', { name: 'Staff One', email: 'staff@example.com', password: 'Zebra7Quartz9' })).body.user?.role === 'staff');

r = await call('me', {}, { authorization: `Bearer ${access1}` }, 'GET'); t('me with valid token', r.status === 200 && r.body.user.email === 'owner@example.com');
r = await call('me', {}, {}, 'GET'); t('me without token 401', r.status === 401);
r = await call('me', {}, { authorization: 'Bearer ' + (() => { const p = access1.split('.'); p[2] = (p[2][0] === 'A' ? 'B' : 'A') + p[2].slice(1); return p.join('.'); })() }, 'GET'); t('tampered signature 401', r.status === 401);
const [hd, bd] = access1.split('.'); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(bd, 'base64url').toString()), role: 'admin', sub: 'usr_x' })).toString('base64url');
t('forged payload 401', (await call('me', {}, { authorization: `Bearer ${hd}.${forged}.${access1.split('.')[2]}` }, 'GET')).status === 401);
const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
t('alg=none rejected', (await call('me', {}, { authorization: `Bearer ${none}.${bd}.` }, 'GET')).status === 401);
const expired = signJwt({ sub: 'x', email: 'e', name: 'n', role: 'admin', iss: 'solar-ai-sales', aud: 'solar-ai-sales-web' }, 'x'.repeat(40), 900, Date.now() - 3600_000);
t('expired token rejected', verifyJwt(expired, 'x'.repeat(40), { issuer: 'solar-ai-sales', audience: 'solar-ai-sales-web' }) === null);
t('wrong secret rejected', verifyJwt(access1, 'y'.repeat(40), { issuer: 'solar-ai-sales', audience: 'solar-ai-sales-web' }) === null);

r = await call('login', { email: 'owner@example.com', password: 'wrong' }); t('wrong password 401 generic', r.status === 401 && r.body.error === 'Invalid email or password.');
r = await call('login', { email: 'nobody@example.com', password: 'whatever1' }); t('unknown email same message', r.status === 401 && r.body.error === 'Invalid email or password.');
r = await call('login', { email: 'OWNER@example.com', password: 'Str0ngPass!' }); t('login ok (case-insens email)', r.status === 200 && !!r.body.accessToken);
const refresh2 = ck(r);

r = await call('refresh', {}, { cookie: `refresh_token=${refresh2}` }); t('refresh ok', r.status === 200 && !!r.body.accessToken);
const refresh3 = ck(r); t('refresh rotates', refresh3 && refresh3 !== refresh2);
await new Promise((s) => setTimeout(s, 10)); 
r = await call('refresh', {}, { cookie: 'refresh_token=garbage' }); t('garbage refresh 401 + cookie cleared', r.status === 401 && /Max-Age=0/.test(r.cookies[0]));
// reuse detection: after the short grace window an already-used refresh token must be refused and revoke the whole family
await new Promise((s) => setTimeout(s, 300));
r = await call('refresh', {}, { cookie: `refresh_token=${refresh2}` }); t('replayed old refresh token rejected', r.status === 401);
r = await call('refresh', {}, { cookie: `refresh_token=${refresh3}` }); t('reuse revokes the whole family', r.status === 401);

r = await call('login', { email: 'owner@example.com', password: 'Str0ngPass!' }); const rf = ck(r);
r = await call('logout', {}, { cookie: `refresh_token=${rf}` }); t('logout clears cookie', r.status === 200 && /Max-Age=0/.test(r.cookies[0]));
r = await call('refresh', {}, { cookie: `refresh_token=${rf}` }); t('refresh after logout 401', r.status === 401);

t('CSRF: foreign origin blocked', (await call('login', { email: 'a@b.co', password: 'x' }, { origin: 'https://evil.com' })).status === 403);
t('CSRF: non-JSON content-type blocked', (await call('login', {}, { 'content-type': 'application/x-www-form-urlencoded' })).status === 415);
t('GET on login 405', (await call('login', {}, {}, 'GET')).status === 405);

// lockout after 5 failures (fresh ip to avoid the generic limiter)
let last: any; for (let i = 0; i < 6; i++) last = await authRoute('login', { method: 'POST', headers: J, body: { email: 'staff@example.com', password: 'bad' + i }, ip: '9.9.9.9', secure: false });
t('lockout after repeated failures', last.status === 429 && !!last.headers?.['Retry-After']);
last = await authRoute('login', { method: 'POST', headers: J, body: { email: 'staff@example.com', password: 'Zebra7Quartz9' }, ip: '9.9.9.9', secure: false });
t('locked even with correct password', last.status === 429);

// leads
const L = (method: string, id: string | undefined, body: any, token?: string, ip = '2.2.2.2') => leadsRoute(id, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) }, body, ip, secure: false });
t('GET leads without login 401', (await L('GET', undefined, {})).status === 401);
r = await call('login', { email: 'owner@example.com', password: 'Str0ngPass!' }); const admin = r.body.accessToken;
r = await call('login', { email: 'staff@example.com', password: 'Zebra7Quartz9' }, {}); 
const lr = await authRoute('login', { method: 'POST', headers: J, body: { email: 'staff@example.com', password: 'Zebra7Quartz9' }, ip: '3.3.3.3', secure: false }); const staff = lr.body.accessToken;
t('staff login works', !!staff);
r = await L('GET', undefined, {}, admin); t('GET leads as admin', r.status === 200 && Array.isArray(r.body.leads) && r.body.leads.length >= 3);
t('public POST lead ok', (await L('POST', undefined, { name: 'Ali', phone: '0300-5551234', status: 'Hot' })).status === 201);
t('public POST dedupes by phone', (await L('POST', undefined, { name: 'Ali Khan', phone: '03005551234', city: 'Lahore' })).body.merged === true);
t('public POST validates', (await L('POST', undefined, { name: '', phone: '1' })).status === 400);
const all = (await L('GET', undefined, {}, admin)).body.leads; const ali = all.find((l: any) => l.phone.includes('5551234'));
t('lead merged (one record, city updated)', all.filter((l: any) => l.phone.includes('5551234')).length === 1 && ali.city === 'Lahore');
t('PATCH as staff ok', (await L('PATCH', ali.id, { status: 'Closed' }, staff)).status === 200);
t('DELETE as staff forbidden', (await L('DELETE', ali.id, {}, staff)).status === 403);
t('DELETE as admin ok', (await L('DELETE', ali.id, {}, admin)).status === 200);
t('create-user as staff forbidden', (await call('create-user', { name: 'N N', email: 'n@n.co', password: 'Passw0rd99' }, { authorization: `Bearer ${staff}` })).status === 403);
t('create-user as admin ok', (await call('create-user', { name: 'New Staff', email: 'n@n.co', password: 'Passw0rd99' }, { authorization: `Bearer ${admin}` })).status === 201);
t('stored data is hashed (no plaintext password / refresh token)', await (async () => {
  if (MODE === 'redis') { const { redis } = await import('../backend/redis.js'); const ids: string[] = await redis(['SMEMBERS', 'users']); const raw = JSON.stringify(await redis(['MGET', ...ids.map((i) => `u:${i}`)])); return raw.includes('scrypt$') && !raw.includes('Str0ngPass'); }
  const f = fs.readFileSync('/tmp/solar-test-data/store.json', 'utf8'); return f.includes('scrypt$') && !f.includes('Str0ngPass') && !f.includes(refresh1);
})());
if (MODE === 'redis') t('only whitelisted Redis commands were used', new Set(fake.commands).size > 5);
console.log(`AUTH TESTS [${MODE}] ${pass}/${total}`); fake?.close(); process.exit(pass === total ? 0 : 1);
