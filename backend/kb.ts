/**
 * Knowledge base: the single source of truth for every fact the assistant may state.
 * Packages are derived from src/data/products.ts so prices exist in ONE place only.
 * Edit KB_CHUNKS below when policies / offers change.
 */
import { SOLAR_PRODUCTS } from '../src/data/products.js';

/** Raw product strings (price ranges etc.) so the output guard knows every legitimate figure. */
export const SOLAR_PRODUCT_TEXT: string[] = SOLAR_PRODUCTS.map((p) => `${p.name}: ${p.priceRange.replace(/^PKR\s*/i, 'PKR ')}`);

export interface Pkg {
  id: string;
  kw: number;
  name: string;
  category: string;
  priceLow: number;
  priceHigh: number;
  unitsPerDayLow: number;
  unitsPerDayHigh: number;
  unitsPerMonth: number;
  acs: number; // max inverter ACs (daytime) the package is advertised to run
  acsText: string;
  phase: 'single' | 'three';
  bestFor: string;
  panels: string;
  inverter: string;
  warranty: string;
}

export interface KbChunk {
  id: string;
  title: string;
  text: string;
  tags: string[];
}

function amount(raw: string): number {
  const m = raw.trim().toLowerCase().replace(/,/g, '').match(/^([\d.]+)\s*(m|k)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2] === 'm' ? n * 1_000_000 : m[2] === 'k' ? n * 1_000 : n;
}

function parseRange(range: string, fallback: number): [number, number] {
  const m = range.match(/PKR\s*([\d.,]+\s*[mk]?)\s*-\s*([\d.,]+\s*[mk]?)/i);
  if (!m) return [fallback, fallback];
  const lo = amount(m[1].replace(/\s/g, ''));
  const hi = amount(m[2].replace(/\s/g, ''));
  return [Number.isFinite(lo) ? lo : fallback, Number.isFinite(hi) ? hi : fallback];
}

const AC_TABLE: Record<number, { n: number; text: string }> = {
  3: { n: 1, text: '1 inverter AC (about 1 to 1.5 ton)' },
  5: { n: 2, text: '2 inverter ACs (1.5 ton each)' },
  7: { n: 3, text: '3 inverter ACs' },
  10: { n: 5, text: '4 to 5 inverter ACs' },
  20: { n: 10, text: 'a large commercial AC load, sized by our engineer' },
};

export const PACKAGES: Pkg[] = SOLAR_PRODUCTS.filter((p) => p.category === 'Residential' || p.category === 'Commercial')
  .map((p) => {
    const kw = parseInt(p.id, 10);
    const [lo, hi] = parseRange(p.priceRange, p.priceNumeric);
    const du = (p.specs.dailyUnits || '').match(/(\d+)\s*-\s*(\d+)/);
    const mu = (p.specs.dailyUnits || '').match(/Avg\s*([\d,]+)/i);
    const ac = AC_TABLE[kw] || { n: 0, text: 'sized by our engineer' };
    return {
      id: p.id,
      kw,
      name: p.name,
      category: p.category,
      priceLow: lo,
      priceHigh: hi,
      unitsPerDayLow: du ? +du[1] : 0,
      unitsPerDayHigh: du ? +du[2] : 0,
      unitsPerMonth: mu ? parseInt(mu[1].replace(/,/g, ''), 10) : 0,
      acs: ac.n,
      acsText: ac.text,
      phase: kw >= 10 ? ('three' as const) : ('single' as const),
      bestFor: p.bestFor,
      panels: p.specs.panels || '',
      inverter: p.specs.inverter || '',
      warranty: p.specs.warranty || '',
    };
  })
  .filter((p) => Number.isFinite(p.kw) && p.kw > 0)
  .sort((a, b) => a.kw - b.kw);

export const BACKUP = SOLAR_PRODUCTS.find((p) => p.id === 'battery-inverter');
export const PRODUCT_BY_ID = new Map(SOLAR_PRODUCTS.map((p) => [p.id, p]));

export function pkr(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v : +v.toFixed(2)} million`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)} thousand`;
  return `${n}`;
}

export function priceText(p: Pkg): string {
  return `PKR ${pkr(p.priceLow)} to ${pkr(p.priceHigh)}`;
}

/** Policy facts that changed recently. Review whenever NEPRA / DISCO rules change. */
export const POLICY_LAST_REVIEWED = '2026-10-17';
export const BUYBACK_RATE_PKR = 11;

export const KB_CHUNKS: KbChunk[] = [
  {
    id: 'net-billing',
    title: 'Net metering and net billing in Pakistan',
    text:
      'In February 2026 NEPRA replaced the old net metering rules with a net billing system (NEPRA Prosumer Regulations 2026). For new applicants, solar units sent to the grid are credited at roughly PKR 11 per unit, while units drawn from the grid are billed at the normal tariff, and contracts run for 5 years. Applications filed before 8 February 2026 were allowed to continue under the older net metering terms. Because these rules have been changing, never promise a zero electricity bill or a specific export credit; say that our engineer confirms the current terms for the customer\'s distribution company (DISCO).',
    tags: ['net', 'metering', 'billing', 'net-metering', 'buyback', 'export', 'nepra', 'policy', 'green', 'meter', 'disco', 'lesco', 'iesco', 'fesco', 'mepco', 'kelectric', 'wapda', 'sell', 'grid', 'credit', 'zero', 'bill'],
  },
  {
    id: 'paperwork',
    title: 'Grid connection paperwork',
    text:
      'Our team handles the application to the DISCO, inspection, bidirectional meter installation and the required licensing paperwork for grid-connected systems.',
    tags: ['paperwork', 'application', 'documents', 'license', 'licence', 'nepra', 'meter', 'disco', 'noc', 'approval'],
  },
  {
    id: 'self-consumption',
    title: 'Getting the most savings',
    text:
      'Generally, using your solar power directly during the day saves more than exporting it, because exported units are credited at a lower rate than the units you avoid buying. Running daytime loads such as ACs, water pumps and appliances on solar, and adding a battery for evening loads, improves savings.',
    tags: ['savings', 'save', 'bill', 'reduce', 'self', 'consumption', 'daytime', 'worth', 'roi', 'payback', 'return', 'investment'],
  },
  {
    id: 'payback',
    title: 'Payback period',
    text:
      'Payback depends on the customer\'s tariff slab, how much power is used in the daytime, the system price and current export rules. We do not quote a fixed payback period in chat; our engineer prepares a personalised estimate after seeing the electricity bill.',
    tags: ['payback', 'roi', 'return', 'years', 'break', 'even', 'recover', 'worth', 'investment', 'profit'],
  },
  {
    id: 'hybrid-types',
    title: 'On-grid, hybrid and off-grid systems',
    text:
      'On-grid systems work with the grid and no battery; they switch off during a grid outage for safety. Hybrid systems add batteries so lights, fans, fridge and Wi-Fi stay on during power cuts, and can also work with the grid. Off-grid systems run fully on solar and batteries and need a larger battery bank. For most homes with load shedding, a hybrid inverter is the recommended choice.',
    tags: ['hybrid', 'on-grid', 'ongrid', 'off-grid', 'offgrid', 'difference', 'type', 'types', 'which', 'inverter', 'grid', 'tied'],
  },
  {
    id: 'battery',
    title: 'Battery backup and load shedding',
    text:
      'Hybrid systems keep essential loads running during load shedding. Lithium option: Felicity 51.2V 100Ah (5.12 kWh) LiFePO4 battery at PKR 315 thousand, 6000+ cycles, 5-year replacement warranty; one battery can run 1 inverter AC for 4 to 5 hours, or a basic home load through the night. Budget option: Phoenix TX-1800 deep-cycle tubular battery at PKR 68 thousand each, 1-year local warranty. A ready backup package (hybrid inverter plus 5.12 kWh lithium battery, 10 ms switchover) is PKR 380 thousand to 590 thousand.',
    tags: ['battery', 'batteries', 'backup', 'load', 'shedding', 'loadshedding', 'outage', 'power', 'cut', 'ups', 'lithium', 'lifepo4', 'tubular', 'night', 'felicity', 'phoenix', 'storage', 'blackout', 'light'],
  },
  {
    id: 'panels',
    title: 'Solar panels offered',
    text:
      'Longi Hi-MO 6 Explorer 585 W N-type: PKR 18,200 per panel, 22.6% module efficiency, 15-year product and 25-year linear power warranty. Jinko Tiger Neo 585 W N-type TOPCon dual-glass bifacial: PKR 18,800 per panel, 22.7% cell efficiency, 12-year product and 30-year linear power warranty. Bifacial panels also collect light from the rear and can add roughly 15 to 25 percent extra output depending on the roof surface.',
    tags: ['panel', 'panels', 'plate', 'plates', 'longi', 'jinko', 'brand', 'brands', 'bifacial', 'topcon', 'tier', 'n-type', 'efficiency', 'watt', 'canadian', 'quality', 'module', 'efficient', 'efficiency'],
  },
  {
    id: 'inverters',
    title: 'Inverters offered',
    text:
      'Inverex Nitrox 6 kW single-phase hybrid inverter: PKR 295,000. Inverex Nitrox 10 kW three-phase hybrid inverter: PKR 485,000. They have dual MPPT, IP65 casing, mobile Wi-Fi monitoring and a 5-year official warranty in Pakistan. We also work with Growatt SPH and Huawei inverters for suitable packages.',
    tags: ['inverter', 'inverters', 'inverex', 'nitrox', 'growatt', 'huawei', 'sungrow', 'mppt', 'monitoring', 'wifi', 'app', 'brand', 'brands'],
  },
  {
    id: 'roof-space',
    title: 'Roof space needed',
    text:
      'Each 1 kW of solar needs about 80 to 90 square feet of shadow-free roof space. A 5 kW system needs around 400 to 450 square feet and a 10 kW system around 800 to 900 square feet.',
    tags: ['roof', 'rooftop', 'space', 'area', 'square', 'feet', 'sqft', 'marla', 'kanal', 'chhat', 'size', 'fit', 'much'],
  },
  {
    id: 'panel-count',
    title: 'Number of panels per system',
    text:
      'Approximate panel counts (585 W class panels): 3 kW uses 6 panels, 5 kW uses 9 to 10, 7 kW uses 12 to 14, 10 kW uses 18, and 20 kW uses 34 to 36. The exact count depends on the panel model and roof layout.',
    tags: ['panel', 'panels', 'many', 'number', 'count', 'need', 'how', 'quantity'],
  },
  {
    id: 'pump',
    title: 'Water pumps and motors',
    text:
      'A 5 kW system can run a 1 HP water pump along with 2 inverter ACs, and a 7 kW system can run a 1.5 HP water bore. Larger pumps and tubewells need a custom design checked by our engineer.',
    tags: ['pump', 'motor', 'water', 'bore', 'tubewell', 'hp', 'horsepower', 'irrigation', 'agriculture', 'farm'],
  },
  {
    id: 'lifespan',
    title: 'How long the system lasts',
    text:
      'Panels carry 25 to 30 year linear power warranties, so they are built to serve for decades. Inverters carry a 5-year warranty, and lithium batteries 5 years or 6000 cycles.',
    tags: ['last', 'lifespan', 'life', 'lifetime', 'durable', 'durability', 'years', 'long', 'age', 'degradation'],
  },
  {
    id: 'ac-load',
    title: 'How many ACs each system can run',
    text:
      'During sunlight hours: 3 kW runs 1 inverter AC (about 1 to 1.5 ton) plus fridge, fans and lights; 5 kW runs 2 inverter ACs (1.5 ton each) plus a water pump and fridge; 7 kW runs 3 inverter ACs plus a water bore and freezer; 10 kW three-phase runs 4 to 5 inverter ACs. At night, ACs need enough battery capacity or the grid.',
    tags: ['ac', 'acs', 'air', 'conditioner', 'conditioners', 'ton', 'run', 'power', 'appliances', 'load', 'fridge', 'freezer', 'pump', 'motor', 'inverter-ac'],
  },
  {
    id: 'sizing',
    title: 'How the system size is chosen',
    text:
      'The most accurate way is by monthly units (kWh) from the bill. As a rough guide by monthly bill: up to PKR 25,000 suits 3 kW; up to 50,000 suits 5 kW; up to 80,000 suits 7 kW; up to 150,000 suits 10 kW; above that a 20 kW or custom 15 to 20 kW design. Roof space, single or three-phase connection and daytime usage also matter, which our engineer checks at the survey.',
    tags: ['size', 'sizing', 'which', 'recommend', 'capacity', 'kw', 'kilowatt', 'need', 'bill', 'units', 'how', 'big', 'right'],
  },
  {
    id: 'output',
    title: 'How much power panels produce',
    text:
      'Each kW of panels produces roughly 4 to 5 units (kWh) per day in good sun, so 3 kW gives about 12 to 15 units, 5 kW about 22 to 26, 7 kW about 32 to 38, 10 kW about 45 to 55 and 20 kW about 90 to 110 units per day. Output drops on cloudy days, with heavy dust or shade, and in extreme heat.',
    tags: ['units', 'production', 'generate', 'generation', 'output', 'produce', 'daily', 'per', 'day', 'month', 'cloud', 'cloudy', 'rain', 'dust', 'heat', 'hot', 'weather', 'efficiency'],
  },
  {
    id: 'warranty',
    title: 'Warranties',
    text:
      'Panels carry long linear power warranties (25 to 30 years depending on the model) plus a 12 to 15 year product warranty. Inverex inverters carry a 5-year official warranty. Lithium battery warranty is 5 years; tubular battery warranty is 1 year. Package warranties are listed in each quotation.',
    tags: ['warranty', 'guarantee', 'warrantee', 'years', 'cover', 'covered', 'break', 'broken', 'repair', 'replacement', 'after', 'sales', 'support'],
  },
  {
    id: 'survey',
    title: 'Free rooftop survey',
    text:
      'We offer a free, no-obligation rooftop survey in major Pakistani cities. The customer shares name, phone number and city, and an engineer contacts them to arrange the visit and prepare an itemised quotation.',
    tags: ['survey', 'visit', 'inspection', 'inspect', 'engineer', 'book', 'appointment', 'free', 'quotation', 'quote', 'callback', 'call', 'contact', 'site'],
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    text:
      'Solar panels have no moving parts and need little maintenance. Cleaning them with water every few weeks (more often in dusty areas) keeps output up, and the inverter app shows performance so problems are noticed early.',
    tags: ['maintenance', 'clean', 'cleaning', 'dust', 'wash', 'service', 'care', 'upkeep'],
  },
  {
    id: 'financing',
    title: 'Payment options',
    text:
      'Payment and installment options are not part of this assistant\'s information. Say that the sales team shares the current payment options along with the quotation, and do not invent plans, rates or discounts.',
    tags: ['installment', 'installments', 'emi', 'finance', 'financing', 'loan', 'pay', 'payment', 'payments', 'monthly', 'afford', 'bank', 'cash', 'discount', 'offer'],
  },
  {
    id: 'installation',
    title: 'Installation timeline',
    text:
      'The installation timeline depends on system size, roof condition and utility approvals. The engineer confirms the schedule after the survey; do not promise exact days.',
    tags: ['installation', 'install', 'time', 'long', 'days', 'weeks', 'schedule', 'timeline', 'delivery', 'when', 'start', 'how', 'fast', 'soon'],
  },
  {
    id: 'shade',
    title: 'Shade and roof conditions',
    text:
      'Shadows from buildings, tanks or trees reduce output, so panels are placed in the sunniest area. The survey checks shadow, roof strength and mounting structure.',
    tags: ['shade', 'shadow', 'tree', 'tank', 'building', 'angle', 'direction', 'south', 'tilt', 'roof', 'concrete', 'tin', 'sheet', 'structure'],
  },
  {
    id: 'commercial',
    title: 'Commercial and industrial systems',
    text:
      'The 10 kW three-phase package suits offices, clinics, schools, marts and plazas. The 20 kW industrial package suits warehouses, flour mills, hospitals and manufacturing units. Larger or custom systems are designed by our engineers after reviewing the electricity bill and roof.',
    tags: ['commercial', 'industrial', 'factory', 'office', 'shop', 'plaza', 'mill', 'warehouse', 'hospital', 'clinic', 'school', 'business', 'three', 'phase', '3-phase', 'mart', 'farm', 'hotel'],
  },
  {
    id: 'how-solar-works',
    title: 'How solar works',
    text:
      'Solar panels turn sunlight into DC electricity; the inverter converts it to AC for your home. Power is used directly by your appliances first, extra can charge a battery or go to the grid, and at night the battery or the grid supplies power.',
    tags: ['how', 'work', 'works', 'working', 'explain', 'basics', 'what', 'solar', 'dc', 'ac', 'convert', 'night', 'sunlight', 'energy', 'electricity'],
  },
  {
    id: 'bill-reading',
    title: 'Where to find monthly units',
    text:
      'The electricity bill shows units consumed in kWh for the month. Sharing the units from the last summer bill gives the most accurate system size.',
    tags: ['bill', 'units', 'kwh', 'consumption', 'consume', 'find', 'where', 'read', 'slab', 'tariff', 'summer'],
  },
];

PACKAGES.length; // evaluated at import: derived from products.ts

export function packageSummary(): string {
  return PACKAGES.map(
    (p) =>
      `${p.kw} kW (${p.name}): ${priceText(p)} turnkey, about ${p.unitsPerDayLow} to ${p.unitsPerDayHigh} units/day, runs ${p.acsText}; best for ${p.bestFor}`
  ).join('\n');
}

/* ---------- retrieval (small BM25-style scorer; the KB is tiny so this is instant) ---------- */

const STOP = new Set(
  'a an the is are was were be been am do does did can could would should will i you we they he she it my your our their me us this that these those of in on at to for from with and or but if so as by about into than then there here what which who whom how when where why not no yes please tell want need like get got have has had just also very really much many some any'.split(' ')
);

const SYN: Record<string, string[]> = {
  cost: ['price', 'rate', 'quotation'],
  price: ['cost', 'rate'],
  expensive: ['price', 'cost', 'afford'],
  cheap: ['price', 'budget'],
  kitne: ['price'],
  loadshedding: ['load', 'shedding', 'outage'],
  ups: ['backup', 'battery'],
  nepra: ['net', 'metering'],
  wapda: ['disco'],
  kelectric: ['disco'],
  guarantee: ['warranty'],
  plates: ['panel'],
  plate: ['panel'],
  saving: ['savings', 'save'],
  save: ['savings'],
  installments: ['installment', 'payment'],
  emi: ['installment', 'payment'],
};

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/k-electric/g, 'kelectric')
    .replace(/load[\s-]shedding/g, 'loadshedding')
    .replace(/net[\s-]meter(?:ing)?/g, 'net metering')
    .split(/[^a-z0-9+-]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Indexed {
  chunk: KbChunk;
  tf: Map<string, number>;
  len: number;
}

const INDEX: Indexed[] = KB_CHUNKS.map((chunk) => {
  const tf = new Map<string, number>();
  const add = (t: string, w: number) => tf.set(t, (tf.get(t) || 0) + w);
  tokenize(chunk.title).forEach((t) => add(t, 2));
  tokenize(chunk.text).forEach((t) => add(t, 1));
  chunk.tags.flatMap((t) => tokenize(t)).forEach((t) => add(t, 3));
  let len = 0;
  tf.forEach((v) => (len += v));
  return { chunk, tf, len };
});

const DF = new Map<string, number>();
INDEX.forEach((d) => d.tf.forEach((_, t) => DF.set(t, (DF.get(t) || 0) + 1)));
const AVG_LEN = INDEX.reduce((a, d) => a + d.len, 0) / INDEX.length;

export function retrieve(query: string, k = 4, minScore = 1.2): { chunk: KbChunk; score: number }[] {
  const base = tokenize(query);
  const q = new Set<string>();
  base.forEach((t) => {
    q.add(t);
    (SYN[t] || []).forEach((s) => q.add(s));
  });
  const N = INDEX.length;
  const scored = INDEX.map((d) => {
    let score = 0;
    q.forEach((t) => {
      const f = d.tf.get(t);
      if (!f) return;
      const df = DF.get(t) || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / AVG_LEN))));
    });
    return { chunk: d.chunk, score };
  })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** Short, customer-facing answers (1 to 3 sentences) used when no LLM is available and as a style guide for the LLM. */
export const SAY: Record<string, string> = {
  'net-billing':
    'Since February 2026 Pakistan has moved new solar connections from net metering to net billing: units you send to the grid are credited at roughly PKR 11 per unit, while units you take from the grid are billed at the normal tariff. So the best savings come from using your solar power directly during the day. Rules have been changing, so our engineer will confirm the current terms with your DISCO.',
  paperwork:
    'We handle the DISCO application, inspection, meter installation and the required licensing paperwork for you.',
  'self-consumption':
    'You save the most by using solar power directly during the day, for example on ACs, water pumps and appliances, and by adding a battery to cover evening loads.',
  payback:
    'Payback depends on your tariff, how much power you use in the daytime, the system price and the current export rules, so I would not guess a number. Our engineer can prepare a personalised estimate from your electricity bill.',
  'hybrid-types':
    'An on-grid system works with the grid and has no battery, and it switches off during a grid outage. A hybrid system adds batteries so lights, fans, fridge and Wi-Fi keep running during power cuts. Off-grid runs fully on solar and batteries and needs a bigger battery bank. For homes with load shedding, hybrid is usually the best choice.',
  battery:
    'Yes, a hybrid system keeps your essentials running during load shedding. We offer a Felicity 5.12 kWh lithium battery at PKR 315 thousand, which can run one inverter AC for 4 to 5 hours or basic home loads through the night, and a budget Phoenix tubular battery at PKR 68 thousand each. A complete backup package costs PKR 380 thousand to 590 thousand.',
  panels:
    'We install Tier-1 585 watt N-type panels: Longi Hi-MO 6 at PKR 18,200 per panel (22.6 percent efficiency, 25-year linear power warranty), and Jinko Tiger Neo bifacial TOPCon at PKR 18,800 per panel (22.7 percent efficiency, 30-year linear power warranty). Bifacial panels also collect light from the back and can give roughly 15 to 25 percent extra output.',
  inverters:
    'We use Inverex Nitrox hybrid inverters, the 6 kW single-phase at PKR 295,000 and the 10 kW three-phase at PKR 485,000, with a 5-year official warranty, dual MPPT, IP65 protection and Wi-Fi app monitoring. We also work with Growatt and Huawei inverters.',
  'roof-space':
    'Every 1 kW of solar needs about 80 to 90 square feet of shadow-free roof, so a 5 kW system needs roughly 400 to 450 square feet and a 10 kW system around 800 to 900 square feet.',
  'panel-count':
    'As a guide, 3kW uses about 6 panels, 5kW uses 9 to 10, 7kW uses 12 to 14, 10kW uses 18 and 20kW uses 34 to 36 panels of around 585 watts. The exact number depends on the panel model and your roof layout.',
  pump:
    'A 5kW system can run a 1 HP water pump together with 2 inverter ACs, and a 7kW system can run a 1.5 HP water bore. Bigger pumps and tubewells need a custom design from our engineer.',
  lifespan:
    'Our panels come with 25 to 30 year performance warranties, so they are built to last for decades. Inverters carry a 5-year warranty and lithium batteries 5 years or 6000 cycles.',
  'ac-load':
    'During sunlight hours a 3 kW system runs 1 inverter AC, 5 kW runs 2, 7 kW runs 3 and a 10 kW three-phase system runs 4 to 5 inverter ACs, along with your normal appliances. At night ACs need battery capacity or the grid.',
  sizing:
    'The best way to size a system is from the monthly units on your electricity bill. As a rough guide, a bill up to PKR 25,000 suits 3 kW, up to 50,000 suits 5 kW, up to 80,000 suits 7 kW and up to 150,000 suits 10 kW.',
  output:
    'Each kW of panels makes roughly 4 to 5 units a day in good sun, so 5 kW gives about 22 to 26 units a day. Output drops on cloudy days, with heavy dust or shade, and in extreme heat.',
  warranty:
    'Panels carry a 25 to 30 year linear power warranty and a 12 to 15 year product warranty, Inverex inverters have a 5-year warranty, lithium batteries 5 years and tubular batteries 1 year. The exact terms are listed in your quotation.',
  survey:
    'We offer a free, no-obligation rooftop survey. Share your name, phone number and city, and an engineer will contact you to arrange the visit and prepare an itemised quotation.',
  maintenance:
    'Solar needs very little maintenance because panels have no moving parts. Rinsing them with water every few weeks, and more often in dusty areas, keeps the output up, and the inverter app shows how the system is performing.',
  financing:
    'Our sales team shares the current payment options together with your quotation. I do not have installment terms to quote here, and I do not want to guess.',
  installation:
    'The installation time depends on the system size, your roof and utility approvals. Our engineer confirms the schedule after the rooftop survey.',
  shade:
    'Shade from buildings, tanks or trees reduces output, so we place panels in the sunniest area. The free survey checks shadows, roof strength and the mounting structure.',
  commercial:
    'The 10 kW three-phase system suits offices, clinics, schools, marts and plazas, and the 20 kW industrial system suits warehouses, flour mills, hospitals and factories. Larger or custom systems are designed by our engineers.',
  'how-solar-works':
    'Solar panels turn sunlight into electricity and the inverter makes it usable in your home. Your appliances use it first, extra can charge a battery or go to the grid, and at night the battery or the grid supplies power.',
  'bill-reading':
    'Your electricity bill shows the units consumed in kWh for the month. The units from your last summer bill give the most accurate system size.',
};
