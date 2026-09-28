/**
 * Dollars, as the buyer sees them.
 *
 * Amounts travel as bigint base units of the dollar token (6 decimals), the
 * same integers the contracts use, and become text only here. The buyer never
 * sees a token name: everything is "$".
 */

export type Micros = bigint;

export const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

export function dollars(value: number): Micros {
  return BigInt(Math.round(value * 1e6));
}

export function toNumber(micros: Micros): number {
  return Number(micros) / 1e6;
}

const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Rounds half up to the cent, in integers, so $50.385 never shows as $50.38. */
function roundToCents(micros: Micros): Micros {
  const cent = UNIT / 100n;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs + cent / 2n) / cent) * cent;
  return negative ? -rounded : rounded;
}

/**
 * "$1,284.50". With `trim`, whole amounts drop the cents: "$50", as a person
 * would say it. Balances keep them.
 */
export function usd(micros: Micros, opts: { trim?: boolean; sign?: boolean } = {}): string {
  const rounded = roundToCents(micros);
  const abs = rounded < 0n ? -rounded : rounded;
  const whole = abs % UNIT === 0n;
  const text = (opts.trim && whole ? usdWhole : usdCents).format(toNumber(abs));
  if (opts.sign) return `${rounded < 0n ? "−" : "+"} ${text}`;
  return rounded < 0n ? `−${text}` : text;
}

/** Splits "$1,284.50" into "$1,284" and ".50" so the cents can sit quieter. */
export function usdParts(micros: Micros): { whole: string; cents: string } {
  const text = usd(micros);
  const dot = text.lastIndexOf(".");
  return dot === -1 ? { whole: text, cents: "" } : { whole: text.slice(0, dot), cents: text.slice(dot) };
}

/**
 * Keypad text ("50", "12.5", "0.99") to base units. Returns null for anything
 * that is not a plain decimal with at most two places.
 */
export function parseAmount(text: string): Micros | null {
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(text)) return null;
  const [whole = "0", frac = ""] = text.split(".");
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(2, "0")) * (UNIT / 100n);
}

/** Base units back to the shortest decimal string: 50_000_000n → "50". */
export function amountParam(micros: Micros): string {
  const whole = micros / UNIT;
  const cents = (micros % UNIT) / (UNIT / 100n);
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
}

/* ── Local currency (display only) ─────────────────────────────────────────── */

/**
 * Sample rates, dollars to local currency, fixed on `SAMPLE_FX_AS_OF`.
 * Display only: nothing is ever priced or settled in these, and every place
 * they show says "sample rate" (LocalEquivalent). A live feed (Chainlink
 * Data Feeds where they exist) replaces them later.
 */
export const SAMPLE_FX_AS_OF = "2026-09-20";
export const MOCK_FX: Readonly<Record<string, number>> = {
  USD: 1,
  ARS: 1182,
  BRL: 5.41,
  MXN: 18.62,
  COP: 4046,
  CLP: 931,
  PEN: 3.71,
  GBP: 0.76,
  EUR: 0.87,
  CHF: 0.8,
  SEK: 9.42,
  NOK: 10.05,
  PLN: 3.66,
  TRY: 41.6,
  PHP: 57.6,
  INR: 88.4,
  PKR: 281,
  IDR: 16420,
  VND: 26310,
  THB: 32.4,
  MYR: 4.21,
  SGD: 1.29,
  JPY: 148.2,
  KRW: 1391,
  CNY: 7.12,
  NGN: 1523,
  KES: 129.2,
  GHS: 12.1,
  ZAR: 17.6,
  EGP: 48.5,
  AED: 3.6725,
  CAD: 1.38,
  AUD: 1.52,
  NZD: 1.68,
};

const REGION_CURRENCY: Readonly<Record<string, string>> = {
  US: "USD", AR: "ARS", BR: "BRL", MX: "MXN", CO: "COP", CL: "CLP", PE: "PEN",
  GB: "GBP", CH: "CHF", SE: "SEK", NO: "NOK", PL: "PLN", TR: "TRY",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR",
  AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", SK: "EUR", SI: "EUR",
  EE: "EUR", LV: "EUR", LT: "EUR", HR: "EUR", CY: "EUR", MT: "EUR",
  PH: "PHP", IN: "INR", PK: "PKR", ID: "IDR", VN: "VND", TH: "THB", MY: "MYR",
  SG: "SGD", JP: "JPY", KR: "KRW", CN: "CNY", NG: "NGN", KE: "KES", GH: "GHS",
  ZA: "ZAR", EG: "EGP", AE: "AED", CA: "CAD", AU: "AUD", NZ: "NZD",
};

export const LOCAL_CURRENCIES = Object.keys(MOCK_FX).sort();

/** The currency a locale implies: "es-AR" → ARS, "de" → EUR (via likely subtags). */
export function currencyForLocale(locale: string): string {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    const code = region ? REGION_CURRENCY[region] : undefined;
    return code && code in MOCK_FX ? code : "USD";
  } catch {
    return "USD";
  }
}

/** "≈ ARS 1.518.279" style text in the viewer's own number format. */
export function formatLocal(micros: Micros, currency: string, locale: string): string | null {
  const rate = MOCK_FX[currency];
  if (!rate || currency === "USD") return null;
  const value = toNumber(micros) * rate;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return null;
  }
}
