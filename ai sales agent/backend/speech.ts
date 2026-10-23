/**
 * Speech helpers.
 *  - normalizeTranscript(): repairs common speech-to-text mistakes (units, brands, spoken numbers,
 *    spoken phone numbers, spoken e-mail addresses) BEFORE any understanding happens.
 *  - toSpeakable(): cleans the assistant reply so text-to-speech reads it naturally.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, million: 1_000_000 };
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

const isNum = (w: string) => w in ONES || w in TENS || w === 'hundred' || w in SCALES;

/** "forty five thousand" -> "45000", "one point five lakh" -> "150000" */
export function wordsToNumbers(input: string): string {
  const tokens = input.split(/(\s+)/); // keep whitespace tokens
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const w = tok.toLowerCase().replace(/[,.]$/, '');
    // a number run must start with a number word that is not a lone "one"/"zero" used as a pronoun-ish word
    // a run must start with a real number word; a bare scale word ("60 thousand") is handled later by unitFixes
    if (!isNum(w) || w in SCALES) {
      out.push(tok);
      i++;
      continue;
    }
    let j = i;
    let total = 0;
    let cur = 0;
    let used = false;
    let lastEnd = i;
    let sawScale = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (/^\s+$/.test(t)) { j++; continue; }
      const x = t.toLowerCase().replace(/[,.]$/, '');
      if (x in ONES) { cur += ONES[x]; used = true; lastEnd = j; j++; continue; }
      if (x in TENS) { cur += TENS[x]; used = true; lastEnd = j; j++; continue; }
      if (x === 'hundred') { cur = (cur || 1) * 100; used = true; lastEnd = j; j++; continue; }
      if (x in SCALES) { total += (cur || 1) * SCALES[x]; cur = 0; used = true; sawScale = true; lastEnd = j; j++; continue; }
      if (x === 'and' && used) {
        // only continue across "and" when a number word follows (e.g. "one hundred and fifty")
        let k = j + 1;
        while (k < tokens.length && /^\s+$/.test(tokens[k])) k++;
        const nx = (tokens[k] || '').toLowerCase();
        if (nx in ONES || nx in TENS) { j = k; continue; }
        break;
      }
      if (x === 'point' && used) {
        // decimal: "one point five lakh"
        let k = j + 1;
        let frac = '';
        while (k < tokens.length) {
          if (/^\s+$/.test(tokens[k])) { k++; continue; }
          const d = tokens[k].toLowerCase();
          if (d in ONES && ONES[d] < 10) { frac += ONES[d]; k++; continue; }
          break;
        }
        if (frac) {
          const dec = parseFloat('0.' + frac);
          // apply to the next scale word if any
          let m = k;
          while (m < tokens.length && /^\s+$/.test(tokens[m])) m++;
          const sc = (tokens[m] || '').toLowerCase();
          if (sc in SCALES) {
            total += (cur + dec) * SCALES[sc];
            cur = 0; sawScale = true; lastEnd = m; j = m + 1; continue;
          }
          total += cur + dec; cur = 0; lastEnd = k - 1; j = k; continue;
        }
        break;
      }
      break;
    }
    const value = total + cur;
    const wordCount = tokens.slice(i, lastEnd + 1).filter((t) => !/^\s+$/.test(t)).length;
    // Single small words ("one", "two") are left alone unless attached to a unit later in normalizeTranscript
    if (used && (wordCount > 1 || sawScale || value >= 10)) {
      out.push(String(Number.isInteger(value) ? value : +value.toFixed(2)));
    } else if (used) {
      out.push(String(value)); // single digit word, still useful ("five kilowatt" -> "5 kilowatt")
    } else {
      out.push(tok);
    }
    i = lastEnd + 1;
  }
  return out.join('');
}

/** Spoken digit runs ("zero three double zero one two ...") -> "03001234567" (needs >= 7 digits). */
export function spokenDigitsToDigits(input: string): string {
  const tokens = input.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i].toLowerCase().replace(/[,.-]$/, '');
    const startsRun = (w in DIGIT_WORDS && w !== 'o' && w !== 'for') || w === 'double' || w === 'triple' || /^\d$/.test(w);
    if (!startsRun) { out.push(tokens[i]); i++; continue; }
    let j = i;
    let digits = '';
    let real = 0;
    let lastEnd = i;
    while (j < tokens.length) {
      if (/^\s+$/.test(tokens[j])) { j++; continue; }
      const x = tokens[j].toLowerCase().replace(/[,.-]$/, '');
      if ((x === 'double' || x === 'triple') && j + 2 < tokens.length) {
        let k = j + 1;
        while (k < tokens.length && /^\s+$/.test(tokens[k])) k++;
        const d = (tokens[k] || '').toLowerCase().replace(/[,.-]$/, '');
        if (d in DIGIT_WORDS) {
          digits += DIGIT_WORDS[d].repeat(x === 'double' ? 2 : 3);
          real += 2; lastEnd = k; j = k + 1; continue;
        }
        break;
      }
      if (x in DIGIT_WORDS) {
        if ((x === 'o' || x === 'for') && real === 0) break;
        digits += DIGIT_WORDS[x];
        if (x !== 'o' && x !== 'for') real++;
        lastEnd = j; j++; continue;
      }
      if (/^\d$/.test(x)) { digits += x; real++; lastEnd = j; j++; continue; }
      break;
    }
    if (digits.length >= 7 && real >= 4) {
      out.push(digits);
      i = lastEnd + 1;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join('');
}

const REPLACEMENTS: [RegExp, string | ((m: string) => string)][] = [
  // brands
  [/\bin\s?ver(?:ex|ix|ax|ecs)\b|\binverex\b|\bin\s?verse\s+solar\b/gi, 'Inverex'],
  [/\bnitro(?:x|cks)?\b|\bnight\s?rocks\b/gi, 'Nitrox'],
  [/\bgrow\s?(?:watt|what|wat|at)\b|\bgrowat\b|\bgrow\s?wat\b/gi, 'Growatt'],
  [/\blong\s?(?:gi|ji|g)\b|\blonji\b|\blongy\b|\blongi\b/gi, 'Longi'],
  [/\bgin\s?ko\b|\bjin\s?ko\b|\bjinco\b|\bjingo\b|\bjinko\b/gi, 'Jinko'],
  [/\bhua\s?wei\b|\bwah\s?way\b|\bhuawei\b|\bwhy\s?way\b/gi, 'Huawei'],
  [/\bfelicit(?:y|ey)\b|\bfelicia\b/gi, 'Felicity'],
  [/\bphoenix\b|\bfeenix\b/gi, 'Phoenix'],
  [/\bsun\s?grow\b|\bsungrow\b/gi, 'Sungrow'],
  [/\bby\s?facial\b|\bbi\s?facial\b|\bbifacial\b/gi, 'bifacial'],
  [/\btop\s?con\b|\btopcon\b/gi, 'TOPCon'],
  [/\btier\s?(?:one|1|-1)\b|\btear\s?one\b/gi, 'Tier-1'],
  [/\b(?:n|and|in)\s?type\b/gi, 'N-type'],
  [/\blife\s?po\s?(?:4|four)\b|\blifepo4\b|\blithium\s+iron\s+phosphate\b/gi, 'LiFePO4'],
  [/\bhybrid\b|\bhybird\b|\bhigh\s?brid\b/gi, 'hybrid'],
  [/\bon\s+grid\b|\bongrid\b/gi, 'on-grid'],
  [/\boff\s+grid\b|\boffgrid\b/gi, 'off-grid'],
  [/\bnet\s?(?:meter(?:ing)?|metring|matering|meetering|meeting)\b/gi, 'net metering'],
  [/\bnet\s?billing\b/gi, 'net billing'],
  [/\b(?:k|kay|casey|ke)\s?-?\s?electric\b/gi, 'K-Electric'],
  [/\bles\s?co\b|\bleco\b|\bleskow\b|\blesco\b/gi, 'LESCO'],
  [/\bi\s?es?co\b|\biesco\b/gi, 'IESCO'],
  [/\bf\s?es?co\b|\bfesco\b/gi, 'FESCO'],
  [/\bm\s?ep?co\b|\bmepco\b/gi, 'MEPCO'],
  [/\bnep\s?ra\b|\bne\s?pra\b|\bnepra\b/gi, 'NEPRA'],
  [/\bwapda\b|\bwap\s?da\b/gi, 'WAPDA'],
  [/\bdisco\b|\bdiscos\b/gi, 'DISCO'],
  [/\bload\s?-?\s?shedding\b|\bload\s?shading\b|\bload\s?shed\b/gi, 'load shedding'],
  [/\bsolar\s?(?:panel|plate)s?\b/gi, (m: string) => (/s$/i.test(m) ? 'solar panels' : 'solar panel')],
  [/\binverter\s+a\s?c(?:s)?\b/gi, 'inverter AC'],
  [/\bair\s?conditioners?\b/gi, 'AC'],
  // cities
  [/\blah(?:o)?re?\b/gi, 'Lahore'],
  [/\bka+r(?:a|aa)?chi\b|\bcarachi\b/gi, 'Karachi'],
  [/\bislam\s?a?\s?bad\b/gi, 'Islamabad'],
  [/\brawal\s?pindi\b/gi, 'Rawalpindi'],
  [/\bfaisal\s?abad\b/gi, 'Faisalabad'],
  [/\bhyder\s?abad\b/gi, 'Hyderabad'],
  [/\bgujran\s?wala\b/gi, 'Gujranwala'],
  [/\bsial\s?kot\b/gi, 'Sialkot'],
  [/\bpesh\s?awar\b/gi, 'Peshawar'],
  [/\bbahawal\s?pur\b/gi, 'Bahawalpur'],
  // fillers
  [/\b(?:um+|uh+|erm+|hmm+|you know)\b[,.]?/gi, ''],
];

function unitFixes(s: string): string {
  return s
    // kilowatt-hours first
    .replace(/(\d+(?:\.\d+)?)\s*(?:kwh|kw\s?h|kilowatt[\s-]?hours?|kilo\s?watt[\s-]?hours?|k\s?w\s?h)\b/gi, '$1 kWh')
    // kilowatts
    .replace(/(\d+(?:\.\d+)?)\s*(?:k\.?\s?w\.?|kws?|kilo\s?watts?|kilowatts?)(?![\w])/gi, '$1kW')
    // "five kv"/"kva" left alone; spoken "k w" without number is left alone
    // compound amounts: "1 lakh 20 thousand" -> 120000
    .replace(/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*thousand\b/gi, (_m, a, b) => String(Math.round(parseFloat(a) * 100000 + parseFloat(b) * 1000)))
    // lakh / thousand / million scales attached to digits
    .replace(/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b/gi, (_m, n) => String(Math.round(parseFloat(n) * 100000)))
    .replace(/(\d+(?:\.\d+)?)\s*million\b/gi, (_m, n) => String(Math.round(parseFloat(n) * 1000000)))
    .replace(/(\d+(?:\.\d+)?)\s*thousand\b/gi, (_m, n) => String(Math.round(parseFloat(n) * 1000)))
    // "5 AC" style fine; "two tons" -> keep
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function emailFixes(s: string): string {
  return s
    .replace(/\s+at\s+the\s+rate(?:\s+of)?\s+/gi, '@')
    .replace(/\b([a-z0-9._-]+)\s+at\s+(gmail|yahoo|outlook|hotmail|icloud)\s+dot\s+com\b/gi, '$1@$2.com')
    .replace(/\s+dot\s+(com|pk|net|org)\b/gi, '.$1');
}

export interface Normalized { text: string; changed: boolean }

export function normalizeTranscript(raw: string): Normalized {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  const before = s;
  s = spokenDigitsToDigits(s);
  s = wordsToNumbers(s);
  s = emailFixes(s);
  for (const [re, rep] of REPLACEMENTS) s = s.replace(re, rep as string);
  s = unitFixes(s);
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.?!])/g, '$1').trim();
  return { text: s, changed: s !== before };
}

/* ---------------- output side ---------------- */

/** Make the reply easy for a text-to-speech engine: no markdown, spoken-friendly amounts. */
export function toSpeakable(text: string, maxWords = 85): string {
  let s = (text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>~|]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    // 1.2M -> 1.2 million, 750k -> 750 thousand (but never 5kW / 5kWh)
    .replace(/(\d+(?:\.\d+)?)\s?M\b(?!W|w)/g, '$1 million')
    .replace(/(\d+(?:\.\d+)?)\s?[kK]\b(?![Ww])/g, '$1 thousand')
    // ranges "12 - 15" / "750 thousand - 880 thousand" -> "to"
    .replace(/(\d(?:[\w.]*|\s?(?:thousand|million)))\s+[-–—]\s+(\d)/g, '$1 to $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = s.split(/\s+/);
  if (words.length > maxWords) {
    const cut = words.slice(0, maxWords).join(' ');
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    s = lastStop > cut.length * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/[,;:]?\s*\S*$/, '') + '.';
  }
  return s;
}
