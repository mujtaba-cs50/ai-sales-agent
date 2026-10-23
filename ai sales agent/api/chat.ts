import { handleChat } from '../backend/pipeline.js';
import { createLlmClient } from '../backend/llm.js';
import { applyCors, clientIp, createRateLimiter } from '../backend/http.js';
import { CONFIG } from '../backend/config.js';

// Created once per serverless instance (re-used across warm invocations).
const llm = createLlmClient();
const limiter = createRateLimiter('chat', CONFIG.rateLimitPerMin, 60);

export default async function handler(req: any, res: any) {
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const limit = await limiter(clientIp(req));
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  try {
    const result = await handleChat(req.body || {}, { llm });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[chat] unexpected error:', error);
    return res.status(200).json({ reply: 'Sorry, I had a small problem. Could you please repeat that?', capturedLead: null });
  }
}
