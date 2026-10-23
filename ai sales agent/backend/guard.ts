/**
 * Output guard: catches the mistakes that matter most in a sales assistant
 * (invented prices, wrong output claims, impossible promises) before a reply reaches the customer.
 */
import { PACKAGES, KB_CHUNKS, SAY, SOLAR_PRODUCT_TEXT } from './kb.js';

const SCALE: Record<string, number> = { million: 1e6, m: 1e6, thousand: 1e3, k: 1e3, lakh: 1e5, lac: 1e5, lakhs: 1e5, lacs: 1e5 };

function toNum(n: string, scale?: string): number {
  const v = parseFloat(n.replace(/,/g, ''));
  return scale ? v * (SCALE[scale.toLowerCase()] || 1) : v;
}

/** Every PKR amount mentioned in a text ("PKR 1.2 million", "45,000 rupees", "Rs 750k"). */
export function extractPkrAmounts(text: string): number[] {
  const out: number[] = [];
  const num = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
  const sc = String.raw`(million|thousand|lakhs?|lacs?|m|k)`;
  const patterns: RegExp[] = [
    new RegExp(String.raw`(?:pkr|rs\.?|rupees?)\s*${num}\s*${sc}?\b`, 'gi'),
    new RegExp(String.raw`${num}\s*${sc}\s*(?:pkr|rupees?)`, 'gi'),
    new RegExp(String.raw`${num}\s*(?:pkr|rupees?)`, 'gi'),
  ];
  const seen = new Set<number>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const v = toNum(m[1], m[2]);
      if (Number.isFinite(v) && !seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  // "PKR 750 thousand to 880 thousand" / "PKR 750k - 880k": the second figure has no currency word
  for (const m of text.matchAll(new RegExp(String.raw`(?:pkr|rs\.?)\s*[\d.,]+\s*${sc}?\s*(?:to|-|–|and)\s*${num}\s*${sc}`, 'gi'))) {
    const v = toNum(m[2], m[3]);
    if (Number.isFinite(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

const groundingAmounts: number[] = (() => {
  const set = new Set<number>();
  const texts = [...KB_CHUNKS.map((c) => c.text), ...Object.values(SAY), ...SOLAR_PRODUCT_TEXT];
  texts.forEach((t) => extractPkrAmounts(t).forEach((v) => set.add(v)));
  PACKAGES.forEach((p) => { set.add(p.priceLow); set.add(p.priceHigh); });
  // per-watt style prices in product text, e.g. "~PKR 31.1/W"
  [31.1, 32.1].forEach((v) => set.add(v));
  return [...set];
})();

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005);

export interface GuardContext {
  /** extra texts the reply may legitimately quote (tool results, retrieved chunks) */
  grounding: string[];
  /** numbers the customer themself said (bill amount etc.) */
  userNumbers: number[];
}

export interface GuardResult { ok: boolean; issues: string[] }

const FORBIDDEN: [RegExp, string][] = [
  [/\b(zero|nil|no)\s+(?:electricity\s+)?bills?\b/i, 'promises a zero bill'],
  [/\bbills?\s+(?:to|down\s+to|close\s+to|near(?:ly)?)\s+(?:zero|nothing)\b/i, 'promises a near-zero bill'],
  [/\bbills?\b[^.?!]{0,40}\b(?:zero|nothing|nil)\b/i, 'promises a zero bill'],
  [/\bfree\s+electricity\b/i, 'promises free electricity'],
  [/\b100\s?%\s+(?:savings?|bill|guarantee|safe|efficien)/i, 'claims 100 percent'],
  [/\bguarantee(?:d|s)?\b(?![^.]*warrant)/i, 'uses the word guarantee without a warranty'],
  [/\bno\s+risk\b|\brisk[\s-]free\b/i, 'claims no risk'],
  [/@@LEAD_JSON|```|\{\s*"reply"/i, 'leaked formatting'],
];

export function checkReply(reply: string, ctx: GuardContext): GuardResult {
  const issues: string[] = [];
  const text = reply.trim();
  if (text.length < 2) return { ok: false, issues: ['empty reply'] };

  // 1) money claims must come from the knowledge base, the tools, or the customer
  const allowed = [...groundingAmounts, ...ctx.userNumbers];
  ctx.grounding.forEach((g) => extractPkrAmounts(g).forEach((v) => allowed.push(v)));
  for (const amt of extractPkrAmounts(text)) {
    if (!allowed.some((a) => close(amt, a))) issues.push(`unsupported amount PKR ${amt.toLocaleString('en-US')}`);
  }

  // 2) "N kW system ... PKR X" must agree with that package's real price range
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!/\b(system|package|turnkey|complete)\b/i.test(sentence) || /\b(inverter|battery|panel|backup)\b/i.test(sentence)) continue;
    const kws = [...sentence.matchAll(/(\d+(?:\.\d+)?)\s?kW\b(?!h)/gi)].map((m) => parseFloat(m[1]));
    const amounts = extractPkrAmounts(sentence).filter((a) => a >= 300_000);
    if (kws.length === 1 && amounts.length) {
      const pkg = PACKAGES.find((p) => p.kw === kws[0]);
      if (pkg && amounts.some((a) => a < pkg.priceLow * 0.99 || a > pkg.priceHigh * 1.01)) issues.push(`price does not match the ${pkg.kw}kW package`);
    }
  }

  // 2b) equipment prices must match that equipment (a Longi panel is never PKR 25,000)
  const SETS: [RegExp, number[]][] = [
    [/\b(longi|jinko)\b|\bpanels?\b/i, [18200, 18800]],
    [/\binverex\b|\binverters?\b/i, [295000, 485000]],
    [/\bfelicity\b|\blithium\b|\blifepo4\b/i, [315000]],
    [/\bphoenix\b|\btubular\b/i, [68000]],
  ];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (/\b(system|package|turnkey|backup)\b/i.test(sentence)) continue;
    const okSet = SETS.filter(([re]) => re.test(sentence)).flatMap(([, v]) => v);
    if (!okSet.length) continue;
    for (const a of extractPkrAmounts(sentence).filter((x) => x >= 1000)) {
      if (!okSet.some((v) => close(a, v))) issues.push(`equipment price PKR ${a.toLocaleString('en-US')} does not match`);
    }
  }

  // 3) daily-output claims "22 to 26 units a day" must match a real package
  for (const m of text.matchAll(/(\d+)\s*(?:to|-|–)\s*(\d+)\s*units?\s*(?:per|a|each|\/)\s*day/gi)) {
    const lo = +m[1], hi = +m[2];
    if (!PACKAGES.some((p) => p.unitsPerDayLow === lo && p.unitsPerDayHigh === hi) && !(lo >= 4 && hi <= 5)) issues.push(`unknown daily output ${lo} to ${hi}`);
  }

  // 4) impossible promises
  for (const [re, label] of FORBIDDEN) if (re.test(text)) issues.push(label);

  return { ok: issues.length === 0, issues };
}

const INJECTION = /(ignore|disregard|forget)\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)|system\s+prompt|reveal\s+your\s+(?:instructions?|prompt|rules)|you\s+are\s+now\s+(?:a|an|in)\b|developer\s+mode|jailbreak|api[\s_-]?key/i;
export const looksLikeInjection = (t: string) => INJECTION.test(t);
