import { leadsRoute } from '../../backend/auth/handlers.js';
import { clientIp, writeResponse } from '../../backend/http.js';

export default async function handler(req: any, res: any) {
  const raw = req.query?.id;
  const id = String(Array.isArray(raw) ? raw[0] : raw || '');
  if (!/^[\w-]{1,64}$/.test(id)) return res.status(400).json({ error: 'Invalid lead id' });
  writeResponse(res, await leadsRoute(id, { method: req.method, headers: req.headers, body: req.body, ip: clientIp(req), secure: true }));
}
