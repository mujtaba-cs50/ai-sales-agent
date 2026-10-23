/**
 * Framework-agnostic HTTP handlers for /api/auth/* and /api/leads*.
 * Express (server.ts) and the Vercel functions (api/...) are thin adapters around these.
 */
import { AUTH } from '../config.js';
import { createRateLimiter } from '../http.js';
import { RedisError } from '../redis.js';
import { AuthError, AuthService, type PublicUser } from './service.js';
import { getStore, StorageNotConfigured, type LeadRecord, type Store } from './store.js';
import { uid } from './crypto.js';

/** Raised when the server is mis-configured (e.g. missing JWT_SECRET). Details go to the log, not to the browser. */
export class ConfigError extends Error {}

export interface HttpReq {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  ip: string;
  secure: boolean;
}
export interface HttpRes {
  status: number;
  body: unknown;
  cookies?: string[];
  headers?: Record<string, string>;
}

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/auth';

const h = (req: HttpReq, name: string): string => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || '';
};

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
  }
  return out;
}

const cookie = (req: HttpReq, value: string, maxAge: number) =>
  `${REFRESH_COOKIE}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${AUTH.isProd() || req.secure ? '; Secure' : ''}`;

export interface Ctx { store: Store; auth: AuthService }
let ctx: Ctx | null = null;
let ready: Promise<Ctx> | null = null;

/** Builds the singletons once. In production a strong JWT_SECRET is mandatory (fails fast). */
export function initAuth(): Promise<Ctx> {
  if (ready) return ready;
  ready = (async () => {
    let secret: string = AUTH.jwtSecret() || '';
    if (!secret || secret.length < 32) {
      if (AUTH.isProd()) throw new ConfigError('JWT_SECRET must be set to a random string of at least 32 characters in production (e.g. `openssl rand -base64 48`).');
      const { randomBytes } = await import('node:crypto');
      secret = randomBytes(48).toString('base64');
      console.warn('[auth] JWT_SECRET not set: using a temporary secret (everyone is logged out when the server restarts). Set JWT_SECRET in .env.');
    }
    const store = getStore();
    const auth = new AuthService(store, secret);
    await auth.seedAdmin();
    await seedDemoLeads(store);
    ctx = { store, auth };
    return ctx;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

const authLimiter = createRateLimiter('auth', 30, 15 * 60); // 30 auth calls / 15 min / IP
const leadPostLimiter = createRateLimiter('lead', 20, 60);

function sameOrigin(req: HttpReq): boolean {
  const origin = h(req, 'origin');
  if (!origin) return true; // non-browser clients / same-origin GET
  try {
    const host = h(req, 'x-forwarded-host') || h(req, 'host');
    const o = new URL(origin);
    return o.host === host || (process.env.ALLOWED_ORIGINS || '').split(',').map((s: string) => s.trim()).includes(origin);
  } catch { return false; }
}

const fail = (e: unknown): HttpRes => {
  if (e instanceof StorageNotConfigured || e instanceof ConfigError) {
    console.error('[config]', (e as Error).message);
    return { status: 503, body: { error: 'The server is not fully configured yet. Please contact the administrator.', code: 'not_configured' } };
  }
  if (e instanceof RedisError) {
    console.error('[storage]', e.message);
    return { status: 503, body: { error: 'Storage is temporarily unavailable. Please try again in a moment.', code: 'storage_unavailable' } };
  }
  if (e instanceof AuthError) {
    return { status: e.status, body: { error: e.message, code: e.code }, headers: e.retryAfterSec ? { 'Retry-After': String(e.retryAfterSec) } : undefined };
  }
  console.error('[auth] unexpected error:', e);
  return { status: 500, body: { error: 'Something went wrong. Please try again.', code: 'server_error' } };
};

const bearer = (req: HttpReq) => {
  const a = h(req, 'authorization');
  return /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, '').trim() : undefined;
};

async function requireUser(req: HttpReq, role?: 'admin'): Promise<PublicUser> {
  const { auth } = await initAuth();
  const u = await auth.authenticate(bearer(req));
  if (!u) throw new AuthError(401, 'unauthorized', 'Please log in.');
  if (role && u.role !== role) throw new AuthError(403, 'forbidden', 'You do not have permission to do that.');
  return u;
}

/* ------------------------------ /api/auth/* ------------------------------ */

export async function authRoute(action: string, req: HttpReq): Promise<HttpRes> {
  try {
    const { auth } = await initAuth();
    const method = req.method.toUpperCase();
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (action === 'me') {
      if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
      return { status: 200, body: { user: await requireUser(req) } };
    }
    if (action === 'create-user') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      await requireUser(req, 'admin');
      return { status: 201, body: { user: await auth.createUser(body) } };
    }

    if (!['signup', 'login', 'refresh', 'logout'].includes(action)) return { status: 404, body: { error: 'Not found' } };
    if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
    // CSRF defence in depth: JSON content type (cannot be sent by a plain cross-site form), matching Origin, SameSite=Strict cookie
    if (!/application\/json/i.test(h(req, 'content-type'))) return { status: 415, body: { error: 'Content-Type must be application/json' } };
    if (!sameOrigin(req)) return { status: 403, body: { error: 'Cross-origin request blocked.' } };

    const lim = await authLimiter(req.ip);
    if (!lim.ok) return { status: 429, body: { error: 'Too many requests. Please try again later.', code: 'rate_limited' }, headers: { 'Retry-After': String(lim.retryAfterSec) } };

    const raw = parseCookies(h(req, 'cookie'))[REFRESH_COOKIE];

    if (action === 'logout') {
      await auth.logout(raw);
      return { status: 200, body: { success: true }, cookies: [cookie(req, '', 0)] };
    }

    let session;
    if (action === 'signup') session = await auth.signup(body);
    else if (action === 'login') session = await auth.login(body, req.ip);
    else {
      try {
        session = await auth.refresh(raw);
      } catch (e) {
        const r = fail(e);
        r.cookies = [cookie(req, '', 0)]; // drop a dead cookie
        return r;
      }
    }
    return {
      status: action === 'signup' ? 201 : 200,
      body: { success: true, user: session.user, accessToken: session.accessToken, expiresIn: session.expiresIn },
      cookies: [cookie(req, session.refreshToken, session.refreshMaxAgeSec)],
      headers: { 'Cache-Control': 'no-store' },
    };
  } catch (e) {
    return fail(e);
  }
}

/* -------------------------------- /api/leads -------------------------------- */

const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : fallback;
const digits = (s: string) => s.replace(/\D/g, '');
const STATUSES = ['Hot', 'Warm', 'New', 'Closed'] as const;

async function seedDemoLeads(store: Store) {
  if (!AUTH.seedDemoLeads() || (await store.listLeads()).length) return;
  const demo: Omit<LeadRecord, 'id'>[] = [
    { name: 'Zubair Ahmed', phone: '0300-1234567', email: 'zubair@gmail.com', product: '10kW Hybrid System', status: 'Hot', note: 'Wants to install next week, discussing payment options.', city: 'Lahore', address: 'Phase 5, DHA', timestamp: 'Today, 10:15 AM', value: 'PKR 2.6M', estimatedKw: 10 },
    { name: 'Kamran Khan', phone: '0321-7654321', email: 'kamran@yahoo.com', product: '5kW On-Grid System', status: 'Warm', note: 'Inquired about net billing paperwork and Tier-1 bifacial panels.', city: 'Karachi', address: 'Block 4, Gulshan-e-Iqbal', timestamp: 'Yesterday', value: 'PKR 1.35M', estimatedKw: 5 },
    { name: 'Ayesha Siddiqua', phone: '0333-9876543', email: 'ayesha@outlook.com', product: '7kW Premium Home Solar', status: 'New', note: 'Requested rooftop structural inspection call back for 3 ACs.', city: 'Islamabad', address: 'Sector F-10/2', timestamp: '2 days ago', value: 'PKR 1.85M', estimatedKw: 7 },
  ];
  for (const l of demo) await store.upsertLead({ id: uid('lead'), createdAt: new Date().toISOString(), ...l });
}

export async function leadsRoute(id: string | undefined, req: HttpReq): Promise<HttpRes> {
  try {
    const { store } = await initAuth();
    const method = req.method.toUpperCase();

    // Public capture path: used by the voice/chat assistant for anonymous website visitors.
    if (method === 'POST' && !id) {
      const lim = await leadPostLimiter(req.ip);
      if (!lim.ok) return { status: 429, body: { error: 'Too many requests.' }, headers: { 'Retry-After': String(lim.retryAfterSec) } };
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = str(b.name, 80);
      const phone = str(b.phone, 30);
      if (!name || digits(phone).length < 7) return { status: 400, body: { error: 'A name and a valid phone number are required.' } };
      const patch = {
        name, phone,
        email: str(b.email, 120) || 'inquiry@solar-lead.com',
        product: str(b.product, 120) || 'Solar Consultation',
        status: ((STATUSES as readonly string[]).includes(b.status) ? b.status : 'New') as LeadRecord['status'],
        note: str(b.note, 500) || 'Customer registered inquiry through voice assistant.',
        city: str(b.city, 60) || 'Pakistan',
        address: str(b.address, 160),
        value: str(b.value, 40) || 'PKR 1.35M',
        estimatedKw: Number.isFinite(+b.estimatedKw) && +b.estimatedKw > 0 && +b.estimatedKw < 1000 ? +b.estimatedKw : 5,
      };
      const existing = await store.findLeadByPhoneDigits(digits(phone));
      if (existing) {
        const merged: LeadRecord = {
          ...existing, ...patch,
          name: patch.name === 'Valued Customer' ? existing.name : patch.name,
          status: existing.status === 'Closed' ? 'Closed' : patch.status === 'Hot' ? 'Hot' : existing.status,
          note: `${existing.note} | ${patch.note}`.slice(-800),
          timestamp: 'Just now',
        };
        await store.upsertLead(merged);
        return { status: 200, body: { success: true, merged: true } }; // contact details of existing leads are not echoed to the public
      }
      await store.upsertLead({ id: uid('lead'), timestamp: 'Just now', createdAt: new Date().toISOString(), ...patch });
      return { status: 201, body: { success: true } };
    }

    // Everything below needs a logged-in staff member.
    const user = await requireUser(req);

    if (method === 'GET' && !id) return { status: 200, body: { leads: await store.listLeads() }, headers: { 'Cache-Control': 'no-store' } };

    if (id && method === 'PATCH') {
      const lead = await store.findLead(id);
      if (!lead) return { status: 404, body: { error: 'Lead not found' } };
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if ((STATUSES as readonly string[]).includes(b.status)) lead.status = b.status;
      if (typeof b.note === 'string') lead.note = str(b.note, 800);
      await store.upsertLead(lead);
      return { status: 200, body: { success: true, lead } };
    }

    if (id && method === 'DELETE') {
      if (user.role !== 'admin') throw new AuthError(403, 'forbidden', 'Only an administrator can delete leads.');
      const removed = await store.removeLead(id);
      return { status: removed ? 200 : 404, body: removed ? { success: true } : { error: 'Lead not found' } };
    }

    return { status: 405, body: { error: 'Method not allowed' } };
  } catch (e) {
    return fail(e);
  }
}
