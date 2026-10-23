# AI Sales Agent (Solar) – voice + chat

React/Vite UI + Express backend (`server.ts`) / Vercel function (`api/chat.ts`) powered by Gemini.

## Backend architecture (`backend/`)

```
customer speech/text
   -> speech.ts     repairs speech-to-text errors ("five kilowatt" -> 5kW, "in verex" -> Inverex, spoken phone numbers, lakh/thousand amounts)
   -> extract.ts    slots: name, phone, city, bill, units, kW, ACs, property type  (word-boundary rules, stateless lead de-duplication)
   -> sizing.ts     deterministic system sizing (the LLM never does arithmetic)
   -> kb.ts         single source of truth: packages come from src/data/products.ts + vetted facts (net billing 2026, batteries, warranties ...)
   -> fallback.ts   rules engine: exact answers + safety net when the LLM is slow/unavailable
   -> llm.ts        Gemini call with a hard time budget and model fallback
   -> prompt.ts     grounded prompt (facts + tool results + known customer details), JSON output
   -> guard.ts      rejects invented prices, wrong output figures, "zero bill"/"guarantee" promises -> retry once -> fall back
   -> pipeline.ts   orchestrates everything; response = { reply, capturedLead, meta }
```

`POST /api/chat` keeps the same contract as before (`reply`, `capturedLead`), plus a small `meta` object
(`source: "llm" | "rules"`, `intent`, `heardAs` = what the backend understood after repairing the transcript, `latencyMs`).

## AI providers (free options, automatic failover)
Set any of `GROQ_API_KEY` (free, fastest), `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (free `:free` models) or an OpenAI-compatible
endpoint (`OPENAI_COMPAT_*`). Providers are tried in the order of `LLM_PROVIDERS` (default `groq,gemini,openrouter,custom`); a provider
that fails (retired model, bad key, rate limit, timeout) is skipped for a while and the next one answers. With **no key at all**
the built-in rules engine still answers every product / pricing / sizing question, so the voice assistant never goes silent.
The reply's `meta.model` shows which provider answered (`groq/...`), `meta.source` is `llm` or `rules`.
Voice input/output uses the browser's speech recognition and speech synthesis, so it does not depend on any AI provider.
`LLM_MODE=auto` (default) answers short FAQ questions (prices, sizing, batteries, net billing ...) with the exact built-in engine and only
sends open-ended, compound, unknown and off-topic questions to the AI; this keeps free-tier token limits from running out. `always` sends everything, `rules` nothing.
Groq free tier (Oct 2026): gpt-oss-120b, gpt-oss-20b and a preview Qwen model, each about 200K tokens/day, 1,000 requests/day, 30 requests/min and 8K tokens/min
(Llama 3.3 70B / 3.1 8B left the free plan on 16 Aug 2026). Free-tier limits change without notice; check console.groq.com/settings/limits.

## Keeping answers correct
* Prices/specs: edit `src/data/products.ts` (the backend reads it).
* Policies/FAQs: edit `KB_CHUNKS` and `SAY` in `backend/kb.ts` (net billing text was last reviewed 2026-10-17: re-check when NEPRA rules change).
* Bill-to-size thresholds: `BILL_TIERS` in `backend/sizing.ts`.

## Measure accuracy
```
npm run eval          # offline, rules engine only (188 cases)
npm run eval:llm      # full pipeline with Gemini (needs GEMINI_API_KEY)
```
Add every wrong answer you see in production to `eval/cases.ts`. The command exits with code 1 below 97% (`EVAL_THRESHOLD`).

## Run
```
cp .env.example .env   # add GEMINI_API_KEY
npm install
npm run dev
```

## Authentication & access control

| What | How |
|---|---|
| Passwords | scrypt (random salt), never stored or logged in plain text; min 8 chars, letter + number, common passwords rejected |
| Login | `POST /api/auth/login` → 15-minute **JWT access token** (HS256, kept only in browser memory) + 7-day **refresh token** in an `httpOnly; SameSite=Strict; Secure` cookie |
| Refresh | `POST /api/auth/refresh` rotates the refresh token every time; replaying an old token revokes that whole login (theft detection) |
| Logout | `POST /api/auth/logout` revokes the refresh token server-side |
| Brute force | 5 failed logins per IP+email → 15 min lockout; 30 auth requests / 15 min / IP; same error message for unknown e-mail and wrong password |
| CSRF | JSON-only endpoints + Origin check + SameSite=Strict cookie |
| Roles | `admin` (first account) and `staff`. Staff can read leads and change status; only admins delete leads or create users |
| Leads | `POST /api/leads` is public (the assistant captures website visitors, de-duplicated by phone); reading/updating/deleting needs login |

Endpoints: `signup`, `login`, `refresh`, `logout`, `me`, `create-user` (admin) under `/api/auth/`.

### Production checklist
1. Set `JWT_SECRET` (the server refuses to start without it in production).
2. Run behind HTTPS. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` or just register first; that first account is the admin.
3. Public signup is closed in production after the first account (set `ALLOW_PUBLIC_SIGNUP=true` to allow it).
4. Storage: on a normal Node host users and leads live in `data/store.json`; on Vercel they live in Upstash Redis (see below).

```
npm test             # everything below
npm run eval         # 188 answer-accuracy cases (rules engine)
npm run test:auth    # 43 auth security tests on file store + 44 on Redis store, 12 client/server e2e, 6 Gemini REST tests
npm run test:vercel  # compiles api/ + backend/ as strict Node ESM and runs every function in a fresh process against a fake Redis
```

## Deploy on Vercel

1. Push the project to GitHub and **Import** it in Vercel (framework preset: Vite; build `npm run build`, output `dist`; both are in `vercel.json`).
2. **Storage tab → Marketplace → Upstash for Redis → Connect** to the project (free plan is enough). This sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`).
3. **Settings → Environment Variables** (Production + Preview):
   * `GROQ_API_KEY` (free, https://console.groq.com/keys) and/or `GEMINI_API_KEY` / `OPENROUTER_API_KEY`; any one is enough, none is also fine
   * `JWT_SECRET` – random 32+ characters (`openssl rand -base64 48`)
   * optional: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (creates the admin on first request), `GEMINI_MODELS`, `ALLOW_PUBLIC_SIGNUP`
4. **Deploy.** Open the site, click Sign up: the first account becomes the administrator. Afterwards signup is closed
   (set `ALLOW_PUBLIC_SIGNUP=true` to reopen); admins add staff with `POST /api/auth/create-user`.

What happens when something is missing: no AI key → the built-in rules engine answers (still accurate for prices, sizing, FAQs);
no database or `JWT_SECRET` → login/leads return a clear `503` message, the chatbot keeps working.
If `/api/chat` answers show `"source": "rules"` although a key is set, open the Vercel function logs: `[llm] groq/... failed: HTTP 404` means the model was retired (update `GROQ_MODELS` / `GEMINI_MODELS`), 401/403 means a wrong key.

Local dev is unchanged: `npm run dev` (Express + Vite, data in `data/store.json`).
