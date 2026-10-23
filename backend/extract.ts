/**
 * Understanding layer: pulls structured slots (name, phone, city, bill, units, kW, ACs, ...) out of
 * normalized text and builds CRM leads. All logic is word-boundary based (the old engine used
 * substring checks such as q.includes('ac') / q.includes('rs') which misfired on "place" or "hours").
 */
import { PACKAGES, priceText } from './kb.js';
import { recommend } from './sizing.js';

export interface Slots {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  billPkr?: number;
  units?: number;
  kw?: number;
  acs?: number;
  property?: 'home' | 'business';
  phase?: 'single' | 'three';
  wantsSurvey?: boolean;
  wantsQuote?: boolean;
  wantsBattery?: boolean;
}

export const CITIES = [
  'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta',
  'Hyderabad', 'Bahawalpur', 'Sargodha', 'Sukkur', 'Abbottabad', 'Gujrat', 'Wah Cantt', 'Sahiwal', 'Okara', 'Rahim Yar Khan',
  'Mardan', 'Mingora', 'Larkana', 'Jhelum', 'Kasur', 'Sheikhupura', 'Dera Ghazi Khan', 'Mirpur', 'Muzaffarabad', 'Gilgit',
  'Skardu', 'Nawabshah', 'Mianwali', 'Dera Ismail Khan', 'Chakwal', 'Attock', 'Taxila', 'Khanewal', 'Vehari', 'Jhang', 'Gwadar',
];
const CITY_RE = new RegExp(`\\b(${CITIES.map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');

const NOT_NAME = new Set(
  `a an the from in at on for to of and or but my me i we you he she it is am are was be been being not no yes ok okay sure
   looking interested calling calling trying planning thinking wondering wanting want need needs just really very also here there
   ready fine good great well fine happy sorry curious new owner living based located contacting coming going getting having
   solar panel panels system inverter battery bill home house shop office factory customer client business sir madam please hello hi hey
   thanks thank today tomorrow now later still already actually basically currently open available free busy late early confused
   what how which do does did can could will would should tell why when where who any give show price cost prices about let lets also battery batteries net metering hai hain hoon ho ka ki ke se main mein aap
   panels pannels units unit kw
   worried concerned upset angry glad pleased keen serious about with using into over under hoping asking ask`.split(/\s+/)
);

const BUSINESS_RE = /(?<!your\s)\b(shop|factory|mill|office|plaza|clinic|school|hospital|warehouse|mart|supermarket|mall|farm|industrial|commercial|business|hotel|restaurant|workshop|college|university|petrol\s+pump|cold\s+storage|godown|showroom|bakery|bank|mosque|masjid|tubewell|tube\s+well)\b/i;
const HOME_RE = /(?<!your\s)\b(home|house|villa|flat|apartment|residential|bungalow|marla|kanal|ghar|family|bedroom|bedrooms|portion)\b/i;

export function extractPhone(text: string): string | undefined {
  const re = /(?:\+|00)?\d[\d\s().-]{8,17}\d/g;
  for (const m of text.match(re) || []) {
    let d = m.replace(/\D/g, '');
    if (d.startsWith('0092')) d = '0' + d.slice(4);
    else if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2);
    else if (d.length === 10 && d.startsWith('3')) d = '0' + d;
    if (/^03\d{9}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  }
  return undefined;
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : undefined;
}

export function extractCity(text: string): string | undefined {
  let last: string | undefined;
  for (const m of text.matchAll(CITY_RE)) last = m[1];
  if (!last) return undefined;
  const canon = CITIES.find((c) => c.toLowerCase() === last!.replace(/\s+/g, ' ').toLowerCase());
  return canon || last;
}

function cleanName(raw: string): string | undefined {
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    const lw = w.toLowerCase().replace(/[^a-z'-]/g, '');
    if (!lw || NOT_NAME.has(lw) || /^(phone|number|city|living|contact|mobile|cell|email|speaking|here|from|and)$/.test(lw)) break;
    if (CITIES.some((c) => c.toLowerCase() === lw)) break;
    words.push(w.replace(/[^A-Za-z'-]/g, ''));
    if (words.length === 3) break;
  }
  if (!words.length) return undefined;
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name.length >= 2 && name.length <= 40 ? name : undefined;
}

const STRONG_NAME = /\b(?:my\s+name\s+is|my\s+name's|name\s+is|name\s*[:=]|mera\s+naam(?:\s+hai)?|mera\s+name(?:\s+hai)?|call\s+me|you\s+can\s+call\s+me)\s+([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*){0,3})/i;
const WEAK_NAME = /\b(?:this\s+is|i\s+am|i'm|im|it's|its)\s+([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*){0,3})/i;
const NAME_SUFFIX = /\b([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)\s+(?:speaking|here)\b/;

export function extractName(text: string, opts: { askedForName?: boolean; hasPhone?: boolean } = {}): string | undefined {
  const strong = text.match(STRONG_NAME);
  if (strong) return cleanName(strong[1]);
  const weak = text.match(WEAK_NAME);
  if (weak) {
    const cap = /^[A-Z]/.test(weak[1]);
    if (cap || opts.askedForName || opts.hasPhone) {
      const n = cleanName(weak[1]);
      if (n) return n;
    }
  }
  const suf = text.match(NAME_SUFFIX);
  if (suf && /^[A-Z]/.test(suf[1])) {
    const n = cleanName(suf[1]);
    if (n) return n;
  }
  if (opts.askedForName) {
    // bare reply such as "Ali Khan" right after the agent asked for the name
    const bare = text.trim().replace(/[.!]$/, '');
    const words = bare.split(/\s+/);
    if (
      words.length <= 3 && !/[?\d]/.test(bare) &&
      words.every((w) => /^[A-Za-z][A-Za-z'-]{1,19}$/.test(w) && !NOT_NAME.has(w.toLowerCase()) && !CITIES.some((c) => c.toLowerCase() === w.toLowerCase()))
    ) return cleanName(bare);
  }
  return undefined;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;

export function extractBillOrUnits(text: string): { billPkr?: number; units?: number } {
  const out: { billPkr?: number; units?: number } = {};
  const t = text.replace(/\+?\d[\d\s().-]{8,}\d/g, ' ');
  const re = new RegExp(`(rs\\.?|pkr|rupees?)?\\s*${NUM}\\s*(k\\b)?\\s*(units?|kwh|rs\\.?|pkr|rupees?|per\\s+month|a\\s+month|monthly)?`, 'gi');
  for (const m of t.matchAll(re)) {
    const raw = parseFloat(m[2].replace(/,/g, ''));
    if (!Number.isFinite(raw)) continue;
    const val = m[3] ? raw * 1000 : raw;
    const after = t.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 14).toLowerCase();
    const before = t.slice(Math.max(0, (m.index || 0) - 40), m.index).toLowerCase();
    const suffix = (m[4] || '').toLowerCase();
    // skip things that are clearly not a bill/units figure
    if (/^\s*(kw|kwh|kva|ac|acs|ton|tons|panel|panels|fan|fans|year|years|month\b|months|marla|kanal|sq|feet|ft|watt|w\b|v\b|ah|phase|%|percent|bedroom|room|floor|storey|story|day|days|hour|hours|hrs|light|lights|battery|batteries)/.test(after) && !suffix) continue;
    if (/units?|kwh/.test(suffix) || /^\s*(units?|kwh)/.test(after)) {
      if (val >= 50 && val <= 100000) out.units = Math.round(val);
      continue;
    }
    const billCtx = /\b(bill|rs\.?|pkr|rupees?|paying|pay|spend|cost|amount|charges?|electricity)\b/.test(before + ' ' + (m[1] || '') + ' ' + suffix + ' ' + after);
    const perMonth = /per\s+month|a\s+month|monthly/.test(suffix + ' ' + after);
    if (val >= 3000 && val <= 5_000_000 && (m[1] || billCtx || perMonth || m[3])) out.billPkr = Math.round(val);
  }
  return out;
}

export function extractFromText(text: string, opts: { askedForName?: boolean } = {}): Partial<Slots> {
  const s: Partial<Slots> = {};
  const phone = extractPhone(text);
  if (phone) s.phone = phone;
  const email = extractEmail(text);
  if (email) s.email = email;
  const city = extractCity(text);
  if (city) s.city = city;
  const name = extractName(text, { askedForName: opts.askedForName, hasPhone: !!phone });
  if (name) s.name = name;

  const bu = extractBillOrUnits(text);
  if (bu.billPkr) s.billPkr = bu.billPkr;
  if (bu.units) s.units = bu.units;

  let kw: number | undefined;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?kw\b(?!h)/gi)) kw = parseFloat(m[1]);
  if (kw && kw >= 1 && kw <= 1000) s.kw = kw;

  let acs: number | undefined;
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:x\s*)?(?:inverter\s+)?(?:acs?|a\.c\.?s?|air\s*condition(?:er)?s?)\b/gi)) acs = parseInt(m[1], 10);
  if (acs && acs >= 1 && acs <= 40) s.acs = acs;

  if (BUSINESS_RE.test(text)) s.property = 'business';
  else if (HOME_RE.test(text)) s.property = 'home';

  if (/\b(three|3)[\s-]?phase\b/i.test(text)) s.phase = 'three';
  else if (/\b(single|1|one)[\s-]?phase\b/i.test(text)) s.phase = 'single';

  if (/\b(survey|site\s+visit|inspection|inspect|appointment|come\s+(?:and|to)\s+(?:see|check)|visit\s+(?:my|our|the))\b/i.test(text)) s.wantsSurvey = true;
  if (/\b(quote|quotation|estimate|proposal|price\s+list)\b/i.test(text)) s.wantsQuote = true;
  if (/\b(battery|batteries|backup|load\s+shedding|ups|power\s+cuts?|outage)\b/i.test(text)) s.wantsBattery = true;
  return s;
}

export const isAffirm = (t: string) => /^\s*(yes|yeah|yep|yup|sure|ok|okay|alright|go\s+ahead|please\s+do|sounds\s+good|of\s+course|definitely|why\s+not|absolutely|that\s+would\s+be\s+(?:great|good|nice)|please)\b/i.test(t);
export const isNegative = (t: string) => /^\s*(no|nope|nah|not\s+now|not\s+really|no\s+thanks|no\s+thank\s+you|maybe\s+later|not\s+interested|i'?m\s+good|that'?s\s+all|that\s+is\s+all|nothing\s+else)\b/i.test(t);

export interface Msg { sender: 'agent' | 'customer'; text: string }

/** Accumulate slots across the customer's messages; later values override earlier ones. */
export function slotsFromHistory(history: Msg[]): Slots {
  const slots: Slots = {};
  let prevAgent = '';
  for (const m of history) {
    if (m.sender === 'agent') { prevAgent = m.text; continue; }
    const asked = /\b(your|the)\s+name\b|\bmay\s+i\s+(?:have|know)\b.*\bname\b|what(?:'s| is)\s+your\s+name|\bname\b.*\bphone\b/i.test(prevAgent);
    Object.assign(slots, extractFromText(m.text, { askedForName: asked }));
  }
  return slots;
}

/* ---------------- lead building ---------------- */

const mshort = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}k`);

export interface LeadOut {
  id: string; name: string; phone: string; email: string; product: string; status: 'Hot' | 'Warm' | 'New' | 'Closed';
  note: string; city: string; address: string; timestamp: string; value: string; estimatedKw: number;
}

/**
 * Stateless de-duplication: a lead (or lead update) is emitted only when the CURRENT message adds
 * the phone, name, email or city for the first time. This avoids the old behaviour of creating a
 * new lead on every message once a phone number appeared anywhere in the conversation.
 */
export function maybeBuildLead(prior: Slots, now: Slots, current: Partial<Slots>, userText: string, productContext?: string | null): LeadOut | null {
  if (!now.phone) return null;
  const newInfo = (current.phone && current.phone !== prior.phone) || (current.name && current.name !== prior.name) ||
    (current.city && current.city !== prior.city) || (current.email && current.email !== prior.email);
  if (!newInfo) return null;

  const rec = recommend({ billPkr: now.billPkr, units: now.units, kw: now.kw, acs: now.acs });
  const pkg = rec?.pkg || (now.kw ? PACKAGES.find((p) => p.kw === now.kw) : undefined);
  const hot = !!(now.wantsSurvey || now.wantsQuote || pkg || productContext);
  const bits = [
    `Captured via AI assistant.`,
    now.property ? `Property: ${now.property}.` : '',
    now.billPkr ? `Monthly bill ~PKR ${now.billPkr.toLocaleString('en-US')}.` : '',
    now.units ? `Usage ~${now.units} units/month.` : '',
    now.acs ? `Wants to run ${now.acs} AC(s).` : '',
    now.wantsBattery ? 'Interested in battery backup.' : '',
    now.wantsSurvey ? 'Requested a site survey.' : '',
    now.wantsQuote ? 'Requested a quotation.' : '',
    `Last message: "${userText.slice(0, 160)}"`,
  ].filter(Boolean);
  return {
    id: `lead-${Date.now()}`,
    name: now.name || 'Valued Customer',
    phone: now.phone,
    email: now.email || 'customer@solar-lead.com',
    product: productContext || pkg?.name || 'Solar Consultation',
    status: hot ? 'Hot' : 'Warm',
    note: bits.join(' '),
    city: now.city || 'Pakistan',
    address: now.city ? `${now.city} Area` : '',
    timestamp: 'Just now',
    value: pkg ? `PKR ${mshort(pkg.priceLow)} - ${mshort(pkg.priceHigh)}` : 'PKR 1.2M - 1.45M',
    estimatedKw: pkg?.kw || 5,
  };
}
