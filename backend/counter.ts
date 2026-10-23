/** Counters with expiry, used for rate limiting and login lockouts. Shared across serverless instances when Redis is configured. */
import { redis, redisConfig, redisPipeline } from './redis.js';

export interface CounterState { count: number; ttlSec: number }
export interface Counter {
  hit(key: string, windowSec: number): Promise<CounterState>;
  peek(key: string): Promise<CounterState>;
  reset(key: string): Promise<void>;
}

class MemoryCounter implements Counter {
  private m = new Map<string, { count: number; expires: number }>();
  private live(key: string) {
    const e = this.m.get(key);
    if (e && e.expires <= Date.now()) { this.m.delete(key); return undefined; }
    return e;
  }
  async hit(key: string, windowSec: number) {
    let e = this.live(key);
    if (!e) { e = { count: 0, expires: Date.now() + windowSec * 1000 }; this.m.set(key, e); }
    e.count += 1;
    if (this.m.size > 20_000) for (const [k, v] of this.m) if (v.expires <= Date.now()) this.m.delete(k);
    return { count: e.count, ttlSec: Math.max(1, Math.ceil((e.expires - Date.now()) / 1000)) };
  }
  async peek(key: string) {
    const e = this.live(key);
    return e ? { count: e.count, ttlSec: Math.max(1, Math.ceil((e.expires - Date.now()) / 1000)) } : { count: 0, ttlSec: 0 };
  }
  async reset(key: string) { this.m.delete(key); }
}

class RedisCounter implements Counter {
  async hit(key: string, windowSec: number) {
    const [count, , ttl] = await redisPipeline([['INCR', key], ['EXPIRE', key, windowSec, 'NX'], ['TTL', key]]);
    return { count: Number(count), ttlSec: Math.max(1, Number(ttl) || windowSec) };
  }
  async peek(key: string) {
    const [v, ttl] = await redisPipeline([['GET', key], ['TTL', key]]);
    return { count: Number(v) || 0, ttlSec: Math.max(0, Number(ttl) || 0) };
  }
  async reset(key: string) { await redis(['DEL', key]); }
}

let counter: Counter | null = null;
export function getCounter(): Counter {
  if (!counter) counter = redisConfig() ? new RedisCounter() : new MemoryCounter();
  return counter;
}
export function resetCounterForTests() { counter = null; }
