/** Zero-dependency crypto helpers: scrypt password hashing and strict HS256 JWTs (Node built-ins only). */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac, createHash } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, keylen, { ...opts, maxmem: 128 * opts.N * opts.r * 2 }, (err: Error | null, key: Buffer) => (err ? reject(err) : resolve(key as Buffer)))
  );

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, saltB64, keyB64] = (stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash of a random password, used to burn the same CPU time when the e-mail does not exist. */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(12).toString('hex'));

export const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const uid = (prefix: string): string => `${prefix}_${randomBytes(9).toString('base64url')}`;

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  role: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp' | 'jti'>, secret: string, ttlSec: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload: JwtClaims = { ...claims, iat, exp: iat + ttlSec, jti: randomToken(9) };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string, opts: { issuer: string; audience: string }, now = Date.now()): JwtClaims | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null; // blocks alg:none and algorithm confusion
    const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtClaims;
    const t = Math.floor(now / 1000);
    if (typeof c.exp !== 'number' || c.exp + 5 < t) return null;
    if (typeof c.iat !== 'number' || c.iat - 5 > t) return null;
    if (c.iss !== opts.issuer || c.aud !== opts.audience) return null;
    if (typeof c.sub !== 'string' || !c.sub) return null;
    return c;
  } catch {
    return null;
  }
}
