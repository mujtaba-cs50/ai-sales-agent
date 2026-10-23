import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleChat } from './backend/pipeline.js';
import { createLlmClient, configuredProviders } from './backend/llm.js';
import { applyCors, createRateLimiter, writeResponse } from './backend/http.js';
import { CONFIG } from './backend/config.js';
import { authRoute, initAuth, leadsRoute, type HttpReq } from './backend/auth/handlers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Behind one reverse proxy (Render, Railway, Nginx ...) the real client IP comes from X-Forwarded-For.
// Set TRUST_PROXY=false to disable, or to a number / subnet if your setup differs.
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp === undefined ? (isProd ? 1 : false) : tp === 'false' ? false : /^\d+$/.test(tp) ? parseInt(tp, 10) : tp);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '64kb' }));

// One shared Gemini client (null when no API key => the deterministic engine answers everything).
const llm = createLlmClient();
if (!llm) console.warn('[chat] No AI provider key set (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY ...): using the built-in rules engine only.');
else console.log('[chat] AI providers:', configuredProviders().map((p) => `${p.name}(${p.models.join(', ')})`).join(' -> '));
const chatLimiter = createRateLimiter('chat', CONFIG.rateLimitPerMin, 60);

const toHttpReq = (req: Request): HttpReq => ({
  method: req.method,
  headers: req.headers,
  body: req.body,
  ip: req.ip || req.socket.remoteAddress || 'unknown',
  secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
});

// ---- Authentication (JWT access token + rotating httpOnly refresh cookie) ----
app.all('/api/auth/:action', async (req: Request, res: Response) => {
  writeResponse(res, await authRoute(String(req.params.action), toHttpReq(req)));
});

// ---- Leads: POST is the public capture path of the assistant; everything else needs login ----
app.all('/api/leads', async (req: Request, res: Response) => {
  writeResponse(res, await leadsRoute(undefined, toHttpReq(req)));
});
app.all('/api/leads/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!/^[\w-]{1,64}$/.test(id)) return res.status(400).json({ error: 'Invalid lead id' });
  writeResponse(res, await leadsRoute(id, toHttpReq(req)));
});

// ---- AI Sales Chat & Lead Capture Endpoint (voice + text share this one brain) ----
app.post('/api/chat', async (req: Request, res: Response) => {
  const limit = await chatLimiter(req.ip || 'unknown');
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  try {
    const result = await handleChat(req.body, { llm });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[chat] unexpected error:', error);
    return res.json({ reply: 'Sorry, I had a small problem. Could you please repeat that?', capturedLead: null });
  }
});

// Unknown /api routes and malformed JSON return JSON, never an HTML stack trace.
app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  console.error('[server] error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await initAuth(); // fails fast in production if JWT_SECRET is missing

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`AI Sales Agent server running on port ${port}`);
  });
}

startServer().catch((e) => {
  console.error('[startup] ' + (e?.message || e));
  process.exit(1);
});
