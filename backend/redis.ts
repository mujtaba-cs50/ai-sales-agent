/**
 * Minimal Upstash-compatible Redis REST client (works with the free "Upstash for Redis" integration in the
 * Vercel Marketplace). Uses plain fetch, so there is no SDK to install or break.
 */
const env = (k: string): string | undefined => process.env[k];

export interface RedisConfig { url: string; token: string }

export function redisConfig(): RedisConfig | null {
  const url = env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisError';
  }
}

type Cmd = (string | number)[];

async function call(path: string, body: unknown): Promise<any> {
  const cfg = redisConfig();
  if (!cfg) throw new RedisError('Redis is not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(cfg.url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new RedisError(`Redis HTTP ${res.status}: ${data?.error || ''}`);
    return data;
  } catch (e: any) {
    if (e instanceof RedisError) throw e;
    throw new RedisError(`Redis request failed: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function redis(cmd: Cmd): Promise<any> {
  const data = await call('', cmd);
  if (data.error) throw new RedisError(String(data.error));
  return data.result;
}

export async function redisPipeline(cmds: Cmd[]): Promise<any[]> {
  if (!cmds.length) return [];
  const data = await call('/pipeline', cmds);
  if (!Array.isArray(data)) throw new RedisError('Unexpected pipeline response');
  return data.map((d: any) => {
    if (d?.error) throw new RedisError(String(d.error));
    return d?.result;
  });
}
