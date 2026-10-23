import { CONFIG } from './config.js';
import { getCounter } from './counter.js';

/**
 * Fixed-window rate limiter. Counts live in Redis when configured (so limits hold across serverless
 * instances) and in memory otherwise. If the counter store is unreachable the request is allowed (fail-open).
 */
export function createRateLimiter(name: string, max: number, windowSec: number) {
  return async function check(key: string): Promise<{ ok: boolean; retryAfterSec: number }> {
    try {
      const { count, ttlSec } = await getCounter().hit(`rl:${name}:${key}`, windowSec);
      return count > max ? { ok: false, retryAfterSec: ttlSec } : { ok: true, retryAfterSec: 0 };
    } catch (e) {
      console.warn('[limiter] counter unavailable, allowing request:', (e as Error)?.message);
      return { ok: true, retryAfterSec: 0 };
    }
  };
}

export function clientIp(req: any): string {
  const xf = req?.headers?.['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim();
  return first || req?.socket?.remoteAddress || req?.ip || 'unknown';
}

/** CORS is only emitted for explicitly allowed origins; same-origin requests need none. */
export function applyCors(req: any, res: any, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  const origin = req?.headers?.origin;
  if (origin && CONFIG.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

/** Writes a framework-agnostic HttpRes to an Express or Vercel response. */
export function writeResponse(res: any, r: { status: number; body: unknown; cookies?: string[]; headers?: Record<string, string> }) {
  if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  if (r.cookies?.length) res.setHeader('Set-Cookie', r.cookies);
  res.setHeader('Cache-Control', r.headers?.['Cache-Control'] || 'no-store');
  return res.status(r.status).json(r.body);
}
