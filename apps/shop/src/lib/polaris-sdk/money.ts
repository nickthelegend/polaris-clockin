import { invalidRequest } from "./errors";

/**
 * Dollar amounts, in integers. The API speaks decimal strings ("349.00"), the
 * chain speaks AUSD base units (6 decimals). Nothing in between is a float.
 */

export const STABLECOIN_DECIMALS = 6;
const MICROS_PER_CENT = 10_000n;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

export type AmountInput = string | number;

/** "349", "349.5", "349.00" or 349.5 → 34900n cents. Rejects anything that isn't a positive two-decimal amount. */
export function toCents(input: AmountInput, param = "amount"): bigint {
  const text = typeof input === "number" ? numberText(input, param) : String(input).trim();
  if (!DECIMAL.test(text)) {
    throw invalidRequest("invalid_amount", `${param} must be a positive dollar amount like "200.00", got ${JSON.stringify(input)}.`, param);
  }
  const [whole = "0", fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (cents <= 0n) throw invalidRequest("invalid_amount", `${param} must be more than zero.`, param);
  return cents;
}

function numberText(input: number, param: string): string {
  const fixed = input.toFixed(2);
  if (!Number.isFinite(input) || Number(fixed) !== input) {
    throw invalidRequest("invalid_amount", `${param} ${input} isn't a whole number of cents. Pass a string like "200.00".`, param);
  }
  return fixed;
}

/** 34900n → "349.00": the canonical form the API sends and receives. */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function normaliseAmount(input: AmountInput, param = "amount"): string {
  return formatCents(toCents(input, param));
}

export function centsToBaseUnits(cents: bigint): bigint {
  return cents * MICROS_PER_CENT;
}

/** Micro-dollars rounded half up to the cent. */
export function microsToCents(micros: bigint): bigint {
  return (micros + MICROS_PER_CENT / 2n) / MICROS_PER_CENT;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$87.25". Fixed locale, so server and client render the same text. */
export function formatUsd(amount: AmountInput): string {
  const cents = toCents(amount);
  return USD.format(Number(cents) / 100);
}

/* ── Pay in 4 ──────────────────────────────────────────────────────────── */

const DAY = 86_400;
const YEAR = 365 * DAY;

export const PAY_IN_4 = {
  installments: 4,
  intervalSeconds: 7 * DAY,
} as const;

export type PayIn4Options = {
  installments?: number;
  intervalSeconds?: number;
  /**
   * Buyer APR in basis points. The loan engine's default is 1000 (10%); a
   * merchant that funds its buyers' interest shows 0, "interest-free".
   */
  aprBps?: number;
};

export type PayIn4Quote = {
  principal: string;
  interest: string;
  total: string;
  /** What "4 payments of $X" shows: the first instalment. */
  each: string;
  installments: { index: number; amount: string; dueInSeconds: number }[];
  intervalSeconds: number;
  interestFree: boolean;
};

/**
 * Quote Pay in 4 the way the loan engine does, in base units:
 * interest = principal × apr × term / year. The instalments shown to the
 * buyer are then split in whole cents, the last one absorbing the remainder,
 * so what the buyer reads always adds up to the total ($159.01 is
 * 3 × $39.75 + $39.76, not 4 × $39.75).
 */
export function quotePayIn4(amount: AmountInput, options: PayIn4Options = {}): PayIn4Quote {
  const count = options.installments ?? PAY_IN_4.installments;
  const interval = options.intervalSeconds ?? PAY_IN_4.intervalSeconds;
  const aprBps = options.aprBps ?? 0;
  const principal = centsToBaseUnits(toCents(amount));
  const n = BigInt(count);
  const interest = (principal * BigInt(aprBps) * n * BigInt(interval)) / (10_000n * BigInt(YEAR));
  const totalCents = microsToCents(principal + interest);
  const eachCents = totalCents / n;
  const installments = Array.from({ length: count }, (_, i) => {
    const cents = i === count - 1 ? totalCents - eachCents * (n - 1n) : eachCents;
    return { index: i + 1, amount: formatCents(cents), dueInSeconds: i * interval };
  });
  return {
    principal: formatCents(microsToCents(principal)),
    interest: formatCents(totalCents - microsToCents(principal)),
    total: formatCents(totalCents),
    each: installments[0]!.amount,
    installments,
    intervalSeconds: interval,
    interestFree: interest === 0n,
  };
}
