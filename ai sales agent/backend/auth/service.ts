import { AUTH } from '../config.js';
import { getCounter, type Counter } from '../counter.js';
import { DUMMY_HASH_PROMISE, hashPassword, randomToken, sha256, signJwt, verifyJwt, verifyPassword, uid } from './crypto.js';
import type { Role, Store, User } from './store.js';

export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSec?: number) {
    super(message);
  }
}

export interface PublicUser { id: string; name: string; email: string; role: Role }
export interface Session {
  user: PublicUser;
  accessToken: string;
  expiresIn: number; // seconds
  refreshToken: string;
  refreshMaxAgeSec: number;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'iloveyou', 'solar123', 'admin123', 'admin1234', 'letmein123', 'welcome123', 'solarsales', 'pakistan123']);
export const toPublic = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

export function validateSignup(name: unknown, email: unknown, password: unknown): { name: string; email: string; password: string } {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const p = typeof password === 'string' ? password : '';
  if (n.length < 2 || n.length > 80) throw new AuthError(400, 'invalid_name', 'Please enter your business or consultant name (2 to 80 characters).');
  if (!EMAIL_RE.test(e)) throw new AuthError(400, 'invalid_email', 'Please enter a valid email address.');
  if (p.length < 8) throw new AuthError(400, 'weak_password', 'Password must be at least 8 characters long.');
  if (p.length > 128) throw new AuthError(400, 'weak_password', 'Password must be at most 128 characters long.');
  const local = e.split('@')[0];
  if (COMMON.has(p.toLowerCase()) || p.toLowerCase() === e || (local.length >= 4 && p.toLowerCase().includes(local))) {
    throw new AuthError(400, 'weak_password', 'That password is too easy to guess. Please choose a stronger one.');
  }
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw new AuthError(400, 'weak_password', 'Password must contain at least one letter and one number.');
  return { name: n, email: e, password: p };
}

export class AuthService {
  constructor(
    private store: Store,
    private secret: string,
    private counter: Counter = getCounter(),
    private now: () => number = Date.now
  ) {}

  private async issue(user: User, familyId = uid('fam')): Promise<Session> {
    const accessToken = signJwt(
      { sub: user.id, email: user.email, name: user.name, role: user.role, iss: AUTH.issuer, aud: AUTH.audience },
      this.secret,
      AUTH.accessTtlSec,
      this.now()
    );
    const refreshToken = randomToken(32);
    await this.store.saveRefresh({ hash: sha256(refreshToken), userId: user.id, familyId, expiresAt: this.now() + AUTH.refreshTtlSec * 1000 });
    return { user: toPublic(user), accessToken, expiresIn: AUTH.accessTtlSec, refreshToken, refreshMaxAgeSec: AUTH.refreshTtlSec };
  }

  async seedAdmin(): Promise<void> {
    const s = AUTH.seedAdmin();
    if (!s.email || !s.password || (await this.store.countUsers()) > 0) return;
    const v = validateSignup(s.name, s.email, s.password);
    const user: User = { id: uid('usr'), name: v.name, email: v.email, passwordHash: await hashPassword(v.password), role: 'admin', createdAt: new Date().toISOString() };
    if (!(await this.store.claimFirstAdmin())) return; // another instance is seeding right now
    if (await this.store.createUser(user)) console.log(`[auth] seeded admin account ${v.email}`);
  }

  async signup(input: { name: unknown; email: unknown; password: unknown }): Promise<Session> {
    const empty = (await this.store.countUsers()) === 0;
    if (!empty && !AUTH.allowPublicSignup()) {
      throw new AuthError(403, 'signup_closed', 'Registration is closed. Please ask the administrator to create an account for you.');
    }
    const v = validateSignup(input.name, input.email, input.password);
    const user: User = {
      id: uid('usr'),
      name: v.name,
      email: v.email,
      passwordHash: await hashPassword(v.password),
      role: 'staff',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    if (!(await this.store.createUser(user))) throw new AuthError(409, 'email_taken', 'An account with this email already exists. Please log in.');
    if (await this.store.claimFirstAdmin()) {
      user.role = 'admin'; // the very first account (claimed atomically) is the administrator
      await this.store.updateUser(user.id, { role: 'admin' });
    }
    return this.issue(user);
  }

  /** Admin creates a staff/admin account (works even when public signup is closed). */
  async createUser(input: { name: unknown; email: unknown; password: unknown; role?: unknown }): Promise<PublicUser> {
    const v = validateSignup(input.name, input.email, input.password);
    const user: User = {
      id: uid('usr'), name: v.name, email: v.email, passwordHash: await hashPassword(v.password),
      role: input.role === 'admin' ? 'admin' : 'staff', createdAt: new Date().toISOString(),
    };
    if (!(await this.store.createUser(user))) throw new AuthError(409, 'email_taken', 'An account with this email already exists.');
    return toPublic(user);
  }

  async login(input: { email: unknown; password: unknown }, ip: string): Promise<Session> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!email || !password) throw new AuthError(400, 'missing_fields', 'Please enter both email and password.');
    if (password.length > 128 || email.length > 254) throw new AuthError(401, 'invalid_credentials', 'Invalid email or password.');

    const key = `lf:${ip}|${email}`;
    const state = await this.counter.peek(key);
    if (state.count >= AUTH.maxLoginFailures) {
      throw new AuthError(429, 'locked', 'Too many failed attempts. Please try again later.', state.ttlSec || AUTH.lockoutSec);
    }

    const user = await this.store.findUserByEmail(email);
    // always run one scrypt verification so response time does not reveal whether the email exists
    const ok = await verifyPassword(password, user ? user.passwordHash : await DUMMY_HASH_PROMISE);
    if (!user || !ok || user.disabled) {
      await this.counter.hit(key, AUTH.lockoutSec);
      throw new AuthError(401, 'invalid_credentials', 'Invalid email or password.');
    }
    await this.counter.reset(key);
    await this.store.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    return this.issue(user);
  }

  /** Rotating refresh tokens with reuse detection (a replayed old token revokes the whole login family). */
  async refresh(raw: string | undefined): Promise<Session> {
    if (!raw) throw new AuthError(401, 'no_session', 'Not logged in.');
    const rec = await this.store.findRefresh(sha256(raw));
    const t = this.now();
    if (!rec || rec.revoked || rec.expiresAt <= t) throw new AuthError(401, 'invalid_session', 'Session expired. Please log in again.');
    if (rec.usedAt && t - rec.usedAt > AUTH.refreshReuseGraceMs) {
      await this.store.revokeFamily(rec.familyId);
      throw new AuthError(401, 'token_reuse', 'Session expired. Please log in again.');
    }
    const user = await this.store.findUserById(rec.userId);
    if (!user || user.disabled) throw new AuthError(401, 'invalid_session', 'Session expired. Please log in again.');
    if (!rec.usedAt) await this.store.markRefreshUsed(rec.hash);
    return this.issue(user, rec.familyId);
  }

  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const rec = await this.store.findRefresh(sha256(raw));
    if (rec) await this.store.revokeFamily(rec.familyId);
  }

  /** Verifies the access token AND that the account still exists / is enabled (role changes apply immediately). */
  async authenticate(token: string | undefined): Promise<PublicUser | null> {
    if (!token) return null;
    const c = verifyJwt(token, this.secret, { issuer: AUTH.issuer, audience: AUTH.audience }, this.now());
    if (!c) return null;
    const u = await this.store.findUserById(c.sub);
    if (!u || u.disabled) return null;
    return toPublic(u);
  }
}
