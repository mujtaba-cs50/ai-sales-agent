/**
 * Deterministic answer engine, used when the LLM is unavailable, too slow, or fails the output guard.
 * It replaces the old keyword engines (server.ts, api/chat.ts and the client copy) which used substring
 * matching, hard-coded outdated policy text and random replies.
 */
import { PACKAGES, SAY, retrieve, priceText, PRODUCT_BY_ID, type Pkg } from './kb.js';
import { recommend, describeRecommendation } from './sizing.js';
import { isAffirm, isNegative, extractFromText, type Msg, type Slots } from './extract.js';

export interface FallbackInput {
  text: string;
  history: Msg[];
  slots: Slots;
  current: Partial<Slots>;
  productContext?: string | null;
}
export interface FallbackOutput { reply: string; intent: string }

const lc = (s: string) => s.toLowerCase();
const has = (t: string, re: RegExp) => re.test(t);

const Q = {
  bill: 'What is your average monthly electricity bill, or how many units do you use?',
  city: 'Which city are you in?',
  contact: 'May I have your name and phone number so our engineer can arrange a free rooftop survey?',
  name: 'May I also have your name?',
  more: 'Is there anything else you would like to know?',
};

function nextQuestion(slots: Slots, lastAgent: string, rec: boolean): string {
  const order: [boolean, string][] = [
    [!rec && !slots.billPkr && !slots.units && !slots.acs && !slots.kw, Q.bill],
    [!slots.city, Q.city],
    [!slots.phone, Q.contact],
    [!!slots.phone && !slots.name, Q.name],
  ];
  for (const [need, q] of order) {
    if (need && !lastAgent.includes(q.slice(0, 24))) return q;
  }
  return Q.more;
}

const shortPkg = (p: Pkg) =>
  `${p.kw}kW system costs ${priceText(p)}, makes about ${p.unitsPerDayLow} to ${p.unitsPerDayHigh} units a day and runs ${p.acsText}.`;

function recText(slots: Slots): string | null {
  const r = recommend({ billPkr: slots.billPkr, units: slots.units, kw: slots.kw, acs: slots.acs });
  if (!r) return null;
  const p = r.pkg;
  const lead = `Based on ${r.basis}, I would recommend the ${p.kw}kW system.`;
  const body = `It costs ${priceText(p)}, makes about ${p.unitsPerDayLow} to ${p.unitsPerDayHigh} units a day and runs ${p.acsText} in daytime.`;
  const extra = r.custom ? ' Your needs are above our standard packages, so our engineer will design a custom system.' : '';
  return `${lead} ${body}${extra}`;
}

export function composeFallback(inp: FallbackInput): FallbackOutput {
  const { text, history, slots, current, productContext } = inp;
  const t = lc(text);
  const lastAgent = [...history].reverse().find((m) => m.sender === 'agent')?.text || '';
  const lastAgentL = lc(lastAgent);
  const rec = !!recText(slots);
  const finish = (answer: string, intent: string, ask = true): FallbackOutput => {
    const q = ask && !/\?\s*$/.test(answer) ? ' ' + nextQuestion(slots, lastAgent, rec) : '';
    return { reply: (answer + q).replace(/\s+/g, ' ').trim(), intent };
  };

  // 1) the customer just gave contact details
  if (current.phone || current.name || current.email) {
    const who = slots.name ? `, ${slots.name}` : '';
    if (slots.phone) {
      const where = slots.city ? ` in ${slots.city}` : '';
      const r = recText(slots);
      const base = `Thank you${who}! I have noted your number ${slots.phone}${where}. Our solar engineer will contact you shortly to arrange your free rooftop survey and prepare a quotation.`;
      return finish(base + (r && !current.city ? '' : ''), 'contact_captured', !slots.city || !slots.name);
    }
    return { reply: `Thank you${who}! What is the best phone number to reach you on?`, intent: 'contact_partial' };
  }
  if (current.city && !current.billPkr && !current.units && !current.kw && !current.acs && lastAgent.includes(Q.city)) {
    return finish(`Thanks, we serve ${current.city}.`, 'city_given');
  }

  // 2) human / callback request
  if (has(t, /\b(human|real\s+person|representative|sales\s?(?:man|person|team)|manager|someone\s+(?:from|at)|talk\s+to\s+(?:a|an|someone)|speak\s+(?:to|with)|call\s+me|call\s+back|callback)\b/)) {
    if (slots.phone) return { reply: `Of course. I will ask one of our solar specialists to call you on ${slots.phone}.`, intent: 'human' };
    return { reply: 'Of course. I can arrange a call from one of our solar specialists. May I have your name and phone number?', intent: 'human' };
  }

  // 3) thanks / goodbye / greeting / identity
  if (has(t, /\b(bye|goodbye|see\s+you|that'?s\s+all|that\s+is\s+all|nothing\s+else|no\s+more\s+questions)\b/) || (has(t, /\b(thanks|thank\s+you|shukriya|jazak)\b/) && t.split(/\s+/).length <= 6)) {
    return { reply: 'You are welcome! If you want a free rooftop survey or a detailed quotation later, just come back and ask. Have a great day!', intent: 'thanks' };
  }
  if (t.split(/\s+/).length <= 6 && has(t, /^(hi|hello|hey|salam|assalam|aoa|good\s+(?:morning|afternoon|evening)|hy|hallo)\b/)) {
    return { reply: 'Hello and welcome! I am your AI solar advisor. I can help you choose the right system size, explain prices, batteries and net billing, and book a free rooftop survey. What would you like to know?', intent: 'greeting' };
  }
  if (has(t, /\b(who\s+are\s+you|are\s+you\s+(?:a\s+)?(?:bot|robot|ai|human|real|machine)|what\s+can\s+you\s+do|what\s+do\s+you\s+do)\b/)) {
    return { reply: 'I am an AI solar advisor. I can recommend a system size from your bill, explain pricing, batteries and net billing, and arrange a free rooftop survey with our engineers. What would you like to know?', intent: 'identity' };
  }

  // 4) yes / no answers to the agent's last question
  if (isAffirm(text) && text.split(/\s+/).length <= 8) {
    if (/survey|quotation|quote|estimate|site\s+visit|book|engineer|arrange/.test(lastAgentL) && !slots.phone) {
      return { reply: 'Wonderful! May I have your name and phone number so our team can contact you?', intent: 'affirm_contact' };
    }
    if (/survey|quotation|quote|estimate/.test(lastAgentL) && slots.phone) {
      return { reply: `Great, I have your number ${slots.phone}. Our engineer will contact you shortly to arrange everything.`, intent: 'affirm_done' };
    }
    return finish('Great!', 'affirm');
  }
  if (isNegative(text) && text.split(/\s+/).length <= 8) {
    return { reply: 'No problem at all. I am here if you have any other questions about solar, batteries or pricing.', intent: 'negative' };
  }
  if (has(t, /\b(don'?t\s+know|do\s+not\s+know|not\s+sure|no\s+idea|dont\s+know)\b/) && /bill|units|usage/.test(lastAgentL)) {
    return { reply: 'No problem. Tell me which appliances you want to run, for example how many ACs, or check the units on your last summer bill, and I can still suggest a size.', intent: 'unknown_bill' };
  }

  // 5) survey / booking
  if (has(t, /\b(survey|site\s+visit|inspection|inspect|appointment|book|visit\s+my|come\s+to\s+(?:my|our))\b/)) {
    if (slots.phone) return { reply: `Sure. I have your number ${slots.phone}, and our engineer will contact you to schedule the free survey.`, intent: 'survey' };
    return { reply: SAY.survey, intent: 'survey' };
  }

  const mentionedKw = current.kw;
  const asksPrice = has(t, /\b(price|prices|pricing|cost|costs|rate|rates|how\s+much|quotation|quote|kitne|kitna|paisa|paise|charges?)\b/);
  const objection = has(t, /\b(expensive|costly|afford|budget|too\s+much|cheaper|discount|cheap)\b/);

  // 6) topic questions answered from the knowledge base (checked BEFORE product words so
  //    "do panels need cleaning" is a maintenance question, not a panel-brand question)
  const TOPICS: [RegExp, string][] = [
    [/\b(how\s+long\s+(?:will|do|does|would)\s+(?:the\s+|a\s+|my\s+)?(?:system|panels?|solar|battery|inverter)\s+last|lifespan|life\s+span|lifetime|durable|durability)\b/, 'lifespan'],
    [/\b(how\s+many\s+panels|number\s+of\s+panels|panels?\s+(?:will\s+)?(?:i|we)\s+need|panel\s+count)\b/, 'panel-count'],
    [/\b(pump|motor|tubewell|tube\s+well|water\s+bore|borehole)\b/, 'pump'],
    [/\b(free)\b[^.?!]*\b(quotation|quote|survey|estimate|visit)\b|\b(quotation|quote|survey|estimate|visit)\b[^.?!]*\bfree\b/, 'survey'],
    [/\b(clean|cleaning|maintenance|maintain|wash|washing|dust|dusty)\b/, 'maintenance'],
    [/\b(warranty|warranties|guarantee|guaranteed)\b/, 'warranty'],
    [/\b(installation\s+(?:time|take|duration|period)|how\s+long\s+(?:does|will|would|to)\b[^.?!]*\b(?:install|installation|take|complete)|how\s+many\s+(?:days|weeks)|timeline|when\s+can\s+you\s+(?:install|start))\b/, 'installation'],
    [/\b(shade|shadow|shadows|shaded|tree|trees|water\s+tank)\b/, 'shade'],
    [/\b(roof|rooftop)\b[^.?!]*\b(space|area|size|square|sq|required|fit|big|large|need)\b|\b(space|area)\b[^.?!]*\b(roof|rooftop)\b|\bsquare\s+(?:feet|foot)\b|\bsq\.?\s?ft\b/, 'roof-space'],
    [/\b(installments?|emi|finance|financing|loan|payment\s+plan|payment\s+options?|pay\s+in\s+parts)\b/, 'financing'],
    [/\b(payback|pay\s+back|roi|return\s+on\s+investment|break\s+even|worth\s+it|worth\s+the)\b/, 'payback'],
    [/\b(net\s+metering|net\s+billing|buyback|buy\s+back|green\s+meter|nepra|disco|lesco|k-electric|iesco|fesco|mepco|wapda|sell\s+(?:back|extra|electricity|power)|export)\b/, 'net-billing'],
    [/\b(cloud|clouds|cloudy|rain|rainy|overcast|winter|heat|hot\s+weather|how\s+many\s+units|units\s+(?:per|a)\s+day|how\s+much\s+(?:power|electricity)\s+(?:does|will)[^.?!]*(?:make|produce|generate))\b/, 'output'],
    [/\b(night|nighttime|sunset|after\s+dark)\b/, 'how-solar-works'],
    [/\b(on-grid|off-grid|hybrid)\b/, 'hybrid-types'],
    [/\bhow\s+(?:does\s+)?solar\s+(?:work|works|energy\s+work)\b|\bhow\s+do\s+solar\s+panels\s+work\b/, 'how-solar-works'],
    [/\b(where|how)\b[^.?!]*\b(find|read|check|see)\b[^.?!]*\b(units|bill|kwh)\b/, 'bill-reading'],
  ];
  // 6a) comparing two sizes: "difference between 5kw and 7kw"
  const kwMentions = [...new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s?kw\b(?!h)/g)].map((m) => parseFloat(m[1])))];
  const compared = kwMentions.map((k) => PACKAGES.find((p) => p.kw === k)).filter((p): p is Pkg => !!p);
  if (compared.length >= 2 && has(t, /\b(difference|compare|comparison|versus|vs|better|between|or)\b/)) {
    return finish(compared.map((p) => shortPkg(p)).join(' '), 'compare');
  }
  const kwNow = current.kw ?? (kwMentions.length === 1 ? kwMentions[0] : undefined);
  const pkgNow = kwNow ? PACKAGES.find((p) => p.kw === kwNow) : undefined;
  if (pkgNow && has(t, /\b(how\s+many\s+units|units\s+(?:per|a)\s+day|produce|generate|make|output)\b/) && !asksPrice) {
    return finish(`A ${pkgNow.kw}kW system makes about ${pkgNow.unitsPerDayLow} to ${pkgNow.unitsPerDayHigh} units a day, roughly ${pkgNow.unitsPerMonth} units a month, depending on sunlight.`, 'output_pkg');
  }
  if (pkgNow && has(t, /\b(how\s+many\s+panels|number\s+of\s+panels|panels?\s+(?:will\s+)?(?:i|we)\s+need)\b/)) {
    const cnt = (pkgNow.panels.match(/^(\d+(?:-\d+)?)x/) || [])[1];
    if (cnt) return finish(`A ${pkgNow.kw}kW system uses about ${cnt.replace('-', ' to ')} panels of 585 watts, depending on the model and your roof layout.`, 'panel_count');
  }

  // 6b0) quotation requests without a price question go to the contact / survey flow
  if (has(t, /\b(quote|quotation|estimate|proposal)\b/) && !has(t, /\b(price|prices|pricing|cost|costs|rate|rates|how\s+much|kitne|kitna|charges?)\b/)) {
    if (slots.phone) return { reply: `Sure, I have your number ${slots.phone}. Our engineer will contact you with a free itemised quotation.`, intent: 'quote_request' };
    return { reply: 'I would be happy to arrange a free itemised quotation. May I have your name and phone number?', intent: 'quote_request' };
  }

  if (!has(t, /\b(price|cost|how\s+much)\b[^.?!]*\b(battery|inverter|panel)/)) {
    for (const [re, id] of TOPICS) {
      if (re.test(t)) {
        if (id === 'net-billing' && has(t, /\b(paperwork|documents?|application|apply|licen[sc]e|noc|approval|process)\b/)) return finish(SAY.paperwork + ' ' + SAY['net-billing'], 'kb:paperwork', false);
        return finish(SAY[id], `kb:${id}`);
      }
    }
  }

  // 6b) product questions (battery, inverter, panels) incl. their prices
  if (has(t, /\b(battery|batteries|lithium|tubular|lifepo4|backup|ups|load\s+shedding|power\s+cuts?|outage)\b/)) return finish(SAY.battery, 'battery');
  if (has(t, /\b(inverex|growatt|huawei|mppt|nitrox|sungrow)\b/) || (has(t, /\binverters?\b/) && !has(t, /\binverter\s+ac\b/))) return finish(SAY.inverters, 'inverter');
  if (has(t, /\b(longi|jinko|bifacial|topcon|tier-1|n-type)\b/) && asksPrice) return finish('Longi Hi-MO 6 585W panels are PKR 18,200 each and Jinko Tiger Neo 585W bifacial panels are PKR 18,800 each.', 'panel_price');
  if (has(t, /\b(longi|jinko|bifacial|topcon|tier-1|n-type)\b/) || has(t, /\b(panels?|brands?)\b/) && !asksPrice && !has(t, /\b(ac|acs|run|need|many)\b/)) return finish(SAY.panels, 'panels');
  if (has(t, /\b(panels?|plates?)\b/) && asksPrice) return finish('Longi Hi-MO 6 585W panels are PKR 18,200 each and Jinko Tiger Neo 585W bifacial panels are PKR 18,800 each.', 'panel_price');

  // 7) price
  if (objection) {
    return finish('I understand, solar is a big decision. Our smallest package, the 3kW system, is ' + priceText(PACKAGES[0]) + ', and our sales team shares the current payment options with your quotation.', 'objection_price');
  }
  if (asksPrice) {
    if (mentionedKw) {
      const p = PACKAGES.find((x) => x.kw === mentionedKw);
      if (p) return finish(`A ${shortPkg(p)}`, 'price_pkg');
      return finish(`We have standard systems of ${PACKAGES.map((x) => x.kw + 'kW').join(', ')}. Other sizes are designed by our engineers.`, 'price_unknown_kw');
    }
    const r = recText(slots);
    if (r) return finish(r, 'price_reco');
    return finish('Our turnkey packages are: ' + PACKAGES.slice(0, 4).map((p) => `${p.kw}kW at ${priceText(p)}`).join(', ') + `, and 20kW at ${priceText(PACKAGES[4])}.`, 'price_list');
  }

  // 7b) "can a 3kW system run 2 ACs?" style capacity questions (before sizing so the answer is honest)
  if (has(t, /\b(ac|acs|air\s+conditioners?)\b/) && has(t, /\b(run|work|handle|support|power|operate)\b/) && has(t, /\b(can|could|will|does|do|how\s+many|is\s+it)\b/)) {
    const kw = current.kw ?? slots.kw;
    const acs = current.acs;
    const p = kw ? PACKAGES.find((x) => x.kw === kw) : undefined;
    if (p && acs && p.acs < acs) {
      const need = recommend({ acs });
      return finish(`A ${p.kw}kW system runs ${p.acsText} during sunlight hours, so for ${acs} ACs I would recommend the ${need?.pkg.kw}kW system.`, 'ac_capacity');
    }
    if (p) return finish(`Yes, a ${p.kw}kW system runs ${p.acsText} during sunlight hours, along with your normal appliances.`, 'ac_capacity');
    return finish(SAY['ac-load'], 'ac_capacity');
  }

  // 8) sizing / recommendation
  const sizingAsk = has(t, /\b(which|what|recommend|suggest|suitable|right|best|ideal|enough|need)\b[^.?!]{0,40}\b(system|size|kw|capacity|package|solar)\b/) || has(t, /\bhow\s+(?:big|many\s+(?:kw|panels))\b/);
  if (current.billPkr || current.units || current.acs || (current.kw && !asksPrice) || sizingAsk) {
    const r = recText(slots);
    if (r) {
      const biz = slots.property === 'business' ? ' For business use, the engineer will also check your daytime load and three-phase connection.' : '';
      return finish(r + biz, 'sizing');
    }
    if (slots.property === 'business') return finish(SAY.commercial, 'commercial');
    return { reply: 'I can recommend the right size from your monthly electricity bill or units, or from how many ACs you want to run. ' + Q.bill, intent: 'sizing_ask' };
  }

  // 10) knowledge base retrieval
  const hits = retrieve(text, 2, 2.0);
  if (hits.length) {
    const top = hits[0].chunk.id;
    return finish(SAY[top], `kb:${top}`, top !== 'survey');
  }

  // 11) selected product on the page
  if (productContext) {
    const p = PACKAGES.find((x) => productContext.toLowerCase().includes(`${x.kw}kw`)) ||
      [...PRODUCT_BY_ID.values()].find((x) => productContext.toLowerCase().includes(x.name.toLowerCase().slice(0, 12)));
    if (p && 'kw' in p) return finish(`Regarding the ${productContext}: ${shortPkg(p as Pkg)}`, 'product_context');
    return finish(`Regarding the ${productContext}, I can share its price, specifications and warranty, or check if it suits your roof.`, 'product_context');
  }

  // 12) honest "don't know" instead of a random canned reply
  const solarish = has(t, /\b(solar|panel|energy|electric|electricity|power|bill|units|roof|grid|kw|watt)\b/);
  if (!solarish) {
    return { reply: 'I am focused on solar systems, so I may not be the best help with that. I can answer questions about system size, prices, batteries, net billing and installation. What would you like to know?', intent: 'off_topic' };
  }
  return finish('I want to give you accurate information, and I do not have that detail. Our solar engineer can answer it properly.', 'unknown');
}
