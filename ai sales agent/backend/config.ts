/** Central runtime configuration (all overridable with environment variables). */
const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[k] : undefined;

export const CONFIG = {
  /** Hard ceiling for one /api/chat call. The browser client aborts after 8 s, so stay below that. */
  totalBudgetMs: parseInt(env('CHAT_BUDGET_MS') || '6500', 10),
  perAttemptMs: parseInt(env('LLM_ATTEMPT_MS') || '3500', 10),
  /** auto = LLM only where it adds value (saves free-tier tokens) | always | rules (never call an LLM) */
  get llmMode(): 'auto' | 'always' | 'rules' {
    const v = (env('LLM_MODE') || 'auto').toLowerCase();
    return v === 'always' || v === 'rules' ? v : 'auto';
  },
  /** Gemini model list, read lazily so tests / late env changes are honoured. */
  get models(): string[] {
    return (env('GEMINI_MODELS') || env('GEMINI_MODEL') || 'gemini-3.1-flash-lite,gemini-flash-latest,gemini-3.5-flash')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  apiKey: () => {
    const k = env('GEMINI_API_KEY') || env('VITE_GEMINI_API_KEY') || env('NEXT_PUBLIC_GEMINI_API_KEY');
    return k && k !== 'MY_GEMINI_API_KEY' ? k : undefined;
  },
  geminiBase: () => env('GEMINI_API_BASE') || 'https://generativelanguage.googleapis.com/v1beta',
  maxHistory: 14, // turns sent to the model
  maxTextChars: 1000,
  rateLimitPerMin: parseInt(env('CHAT_RATE_LIMIT_PER_MIN') || '40', 10),
  allowedOrigins: (env('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean),
};

const isProd = () => env('NODE_ENV') === 'production' || !!env('VERCEL');
const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v));

export const AUTH = {
  isProd,
  issuer: 'solar-ai-sales',
  audience: 'solar-ai-sales-web',
  accessTtlSec: parseInt(env('ACCESS_TOKEN_TTL_SEC') || '900', 10), // 15 minutes
  refreshTtlSec: parseInt(env('REFRESH_TOKEN_TTL_SEC') || String(7 * 24 * 3600), 10), // 7 days
  jwtSecret: () => env('JWT_SECRET'),
  /** The first account is always allowed (it becomes the admin). Afterwards signup is open only in development unless enabled. */
  allowPublicSignup: () => bool(env('ALLOW_PUBLIC_SIGNUP'), !isProd()),
  dataDir: () => env('DATA_DIR') || 'data',
  seedAdmin: () => ({ email: env('ADMIN_EMAIL'), password: env('ADMIN_PASSWORD'), name: env('ADMIN_NAME') || 'Admin' }),
  seedDemoLeads: () => bool(env('SEED_DEMO_LEADS'), !isProd()),
  refreshReuseGraceMs: parseInt(env('REFRESH_REUSE_GRACE_MS') || '10000', 10),
  maxLoginFailures: 5,
  lockoutSec: 15 * 60,
};
