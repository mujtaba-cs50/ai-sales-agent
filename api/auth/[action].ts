import { authRoute } from '../../backend/auth/handlers.js';
import { clientIp, writeResponse } from '../../backend/http.js';

export default async function handler(req: any, res: any) {
  const raw = req.query?.action;
  const action = String(Array.isArray(raw) ? raw[0] : raw || '');
  writeResponse(res, await authRoute(action, { method: req.method, headers: req.headers, body: req.body, ip: clientIp(req), secure: true }));
}
