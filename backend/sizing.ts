/** Deterministic solar calculations. The LLM never does arithmetic: it only receives these results. */
import { PACKAGES, priceText, type Pkg } from './kb.js';

export const BILL_TIERS: { max: number; kw: number }[] = [
  { max: 25_000, kw: 3 },
  { max: 50_000, kw: 5 },
  { max: 80_000, kw: 7 },
  { max: 150_000, kw: 10 },
  { max: Infinity, kw: 20 },
];

export const pkgByKw = (kw: number): Pkg | undefined => PACKAGES.find((p) => p.kw === kw);

export function nearestPkgAtLeast(kw: number): Pkg {
  return PACKAGES.find((p) => p.kw >= kw) || PACKAGES[PACKAGES.length - 1];
}

export function fromBill(bill: number): Pkg {
  const tier = BILL_TIERS.find((t) => bill <= t.max)!;
  return pkgByKw(tier.kw)!;
}

/** Smallest package whose average monthly output covers ~90% of the monthly units. */
export function fromUnits(unitsPerMonth: number): Pkg {
  return PACKAGES.find((p) => p.unitsPerMonth >= unitsPerMonth * 0.9) || PACKAGES[PACKAGES.length - 1];
}

export function fromAcs(acs: number): Pkg {
  return PACKAGES.find((p) => p.acs >= acs) || PACKAGES[PACKAGES.length - 1];
}

export function coveragePct(p: Pkg, unitsPerMonth: number): number {
  return Math.min(100, Math.round((p.unitsPerMonth / unitsPerMonth) * 100));
}

export function roofArea(kw: number): [number, number] {
  return [kw * 80, kw * 90];
}

export interface Needs {
  billPkr?: number;
  units?: number;
  kw?: number;
  acs?: number;
}

export interface Recommendation {
  pkg: Pkg;
  basis: string; // human readable reason
  signals: string[];
  custom: boolean; // true when customer needs more than the biggest package
}

/** Combine every signal the customer gave; the largest requirement wins so the system is never undersized. */
export function recommend(n: Needs): Recommendation | null {
  const cands: { pkg: Pkg; why: string }[] = [];
  if (n.kw) cands.push({ pkg: nearestPkgAtLeast(n.kw), why: `your interest in a ${n.kw}kW system` });
  if (n.units) cands.push({ pkg: fromUnits(n.units), why: `your usage of about ${n.units} units a month` });
  if (n.billPkr && !n.units) cands.push({ pkg: fromBill(n.billPkr), why: `your monthly bill of about PKR ${n.billPkr.toLocaleString('en-US')}` });
  if (n.acs) cands.push({ pkg: fromAcs(n.acs), why: `your plan to run ${n.acs} inverter AC${n.acs > 1 ? 's' : ''}` });
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.pkg.kw > a.pkg.kw ? b : a));
  const custom = !!(n.units && n.units > PACKAGES[PACKAGES.length - 1].unitsPerMonth) || !!(n.billPkr && n.billPkr > 250_000) || !!(n.acs && n.acs > 10) || !!(n.kw && n.kw > 20);
  return { pkg: best.pkg, basis: cands.map((c) => c.why).join(' and '), signals: cands.map((c) => c.why), custom };
}

export function describeRecommendation(r: Recommendation, units?: number): string {
  const p = r.pkg;
  const [a, b] = roofArea(p.kw);
  const parts = [
    `Recommended: ${p.kw}kW system (${p.name}) based on ${r.basis}.`,
    `Turnkey price ${priceText(p)}; produces about ${p.unitsPerDayLow} to ${p.unitsPerDayHigh} units per day (about ${p.unitsPerMonth} per month).`,
    `Runs ${p.acsText} during sunlight hours. Needs about ${a} to ${b} square feet of shadow-free roof.`,
  ];
  if (units) parts.push(`It would cover about ${coveragePct(p, units)} percent of ${units} units a month.`);
  if (r.custom) parts.push('Needs above the largest standard package, so an engineer should design a custom system.');
  return parts.join(' ');
}
