import { leadsRoute } from '../backend/auth/handlers.js';
import { clientIp, writeResponse } from '../backend/http.js';

export default async function handler(req: any, res: any) {
  writeResponse(res, await leadsRoute(undefined, { method: req.method, headers: req.headers, body: req.body, ip: clientIp(req), secure: true }));
}
