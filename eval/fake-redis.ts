/**
 * A tiny in-memory server that speaks the Upstash REST protocol (POST / for one command, POST /pipeline for many).
 * Used by the tests to exercise RedisStore / RedisCounter without a real database.
 * Only the commands the app uses are implemented; anything else returns an error, so the tests prove the app
 * does not depend on other commands.
 */
import http from 'node:http';

type Entry = { t: 's' | 'set' | 'z'; v: any; exp?: number };

export function startFakeRedis(token = 'test-token'): Promise<{ url: string; close: () => void; commands: string[] }> {
  const db = new Map<string, Entry>();
  const commands: string[] = [];
  const live = (k: string): Entry | undefined => {
    const e = db.get(k);
    if (e?.exp && e.exp <= Date.now()) { db.delete(k); return undefined; }
    return e;
  };
  const run = (cmd: (string | number)[]): any => {
    const [name, ...a] = cmd.map((x, i) => (i === 0 ? String(x).toUpperCase() : String(x)));
    commands.push(name);
    switch (name) {
      case 'GET': { const e = live(a[0]); return e && e.t === 's' ? e.v : null; }
      case 'MGET': return a.map((k) => { const e = live(k); return e && e.t === 's' ? e.v : null; });
      case 'SET': {
        const [k, v, ...o] = a; const opts = o.map((x) => x.toUpperCase());
        const exists = !!live(k);
        if (opts.includes('NX') && exists) return null;
        if (opts.includes('XX') && !exists) return null;
        let exp: number | undefined;
        const ex = opts.indexOf('EX'); if (ex >= 0) exp = Date.now() + parseInt(o[ex + 1], 10) * 1000;
        if (opts.includes('KEEPTTL')) exp = live(k)?.exp;
        db.set(k, { t: 's', v, exp }); return 'OK';
      }
      case 'DEL': { let n = 0; for (const k of a) if (live(k)) { db.delete(k); n++; } return n; }
      case 'INCR': { const e = live(a[0]); const n = (e ? parseInt(e.v, 10) : 0) + 1; db.set(a[0], { t: 's', v: String(n), exp: e?.exp }); return n; }
      case 'EXPIRE': {
        const e = live(a[0]); if (!e) return 0;
        if (a[2]?.toUpperCase() === 'NX' && e.exp) return 0;
        e.exp = Date.now() + parseInt(a[1], 10) * 1000; return 1;
      }
      case 'TTL': { const e = live(a[0]); if (!e) return -2; if (!e.exp) return -1; return Math.ceil((e.exp - Date.now()) / 1000); }
      case 'SADD': { let e = live(a[0]); if (!e) { e = { t: 'set', v: new Set<string>() }; db.set(a[0], e); } let n = 0; for (const m of a.slice(1)) if (!e.v.has(m)) { e.v.add(m); n++; } return n; }
      case 'SMEMBERS': { const e = live(a[0]); return e ? [...e.v] : []; }
      case 'SCARD': { const e = live(a[0]); return e ? e.v.size : 0; }
      case 'ZADD': { let e = live(a[0]); if (!e) { e = { t: 'z', v: new Map<string, number>() }; db.set(a[0], e); } const had = e.v.has(a[2]); e.v.set(a[2], parseFloat(a[1])); return had ? 0 : 1; }
      case 'ZREM': { const e = live(a[0]); return e && e.v.delete(a[1]) ? 1 : 0; }
      case 'ZREVRANGE': {
        const e = live(a[0]); if (!e) return [];
        const arr = [...e.v.entries()].sort((x: any, y: any) => y[1] - x[1]).map((x: any) => x[0]);
        let s = parseInt(a[1], 10), t = parseInt(a[2], 10); if (t < 0) t = arr.length + t; if (s < 0) s = arr.length + s;
        return arr.slice(s, t + 1);
      }
      default: throw new Error(`ERR unknown command '${name}'`);
    }
  };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
      let body: any; try { body = JSON.parse(raw); } catch { return send(400, { error: 'bad json' }); }
      const one = (c: any) => { try { return { result: run(c) }; } catch (e: any) { return { error: e.message }; } };
      if (req.url === '/pipeline') return send(200, (body as any[]).map(one));
      const r: any = one(body); return send(r.error ? 400 : 200, r);
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => server.close(), commands })));
}
