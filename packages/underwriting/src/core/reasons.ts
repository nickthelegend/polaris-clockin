/**
 * "Why is my limit this?", in the buyer's words.
 *
 * Every line is backed by exactly one attested fact and carries the points
 * that fact earned on chain, so the lines add up to the score: floor (520) plus
 * every line's points, before the contract's clamp. No line says wallet,
 * transaction, token, liquidation or any other word from the plan's "Words the
 * buyer never sees" table; `test/reasons.test.ts` enforces that.
 *
 * Each line also names the provider behind it (`nansen`, `zerion`, ...), so
 * the app can credit the data without putting the brand in the sentence.
 */

import type { Attribution, Derivation, FactField } from "./facts.ts";
import { formatCount, formatDollars, formatDuration, formatPoints } from "./format.ts";
import type { ScoreBreakdown } from "./score.ts";
import type { CreditReason, Facts, Provider } from "./types.ts";

/** What the reasons can say beyond the bare facts. All optional. */
export type ExplainContext = Partial<
  Pick<Derivation, "attribution" | "exchange" | "infrastructureFunder" | "linked" | "missing">
>;

function providerOf(source: string): Provider {
  const p = source.split(".")[0];
  return p === "nansen" || p === "zerion" || p === "etherscan" || p === "rpc" ? p : "polaris";
}

function line(
  id: CreditReason["id"],
  label: string,
  points: number,
  at: Attribution | undefined,
  fallbackSource: string,
  kind?: CreditReason["kind"],
): CreditReason {
  const source = at?.source ?? fallbackSource;
  return {
    id,
    label,
    text: kind === "info" ? label : `${label} · ${formatPoints(points)}`,
    points,
    kind: kind ?? (points > 0 ? "plus" : points < 0 ? "minus" : "neutral"),
    provider: providerOf(source),
    source,
  };
}

const KIND_ORDER: Record<CreditReason["kind"], number> = { plus: 0, minus: 1, neutral: 2, info: 3 };

export function explainFacts(facts: Facts, b: ScoreBreakdown, ctx: ExplainContext = {}): CreditReason[] {
  const at = (f: FactField): Attribution | undefined => ctx.attribution?.[f];
  const linkedUsed = ctx.linked?.used ?? false;
  const lines: CreditReason[] = [];

  // Age.
  {
    const a = at("walletAgeDays");
    const over = a?.lowerBound ? "over " : "";
    const whose = a?.subject === "linked" ? "your linked account" : "this account";
    const label =
      facts.walletAgeDays >= 30
        ? `You've used ${whose} for ${over}${formatDuration(facts.walletAgeDays)}`
        : linkedUsed
          ? "Your accounts are less than a month old"
          : "This account is less than a month old";
    lines.push(line("age", label, b.age, a, "polaris.rule"));
  }

  // Activity.
  {
    const label =
      facts.txCount >= 25
        ? `You've made ${formatCount(facts.txCount)} payments and transfers`
        : "Fewer than 25 payments and transfers so far";
    lines.push(line("activity", label, b.activity, at("txCount"), "polaris.rule"));
  }

  // Balance.
  {
    const where = linkedUsed ? " across your accounts" : "";
    const wholeDollars = (facts.stableBalance / 1_000_000n) * 1_000_000n;
    const label =
      facts.stableBalance >= 100_000_000n
        ? `You keep ${formatDollars(wholeDollars)} on hand${where}`
        : `Less than $100 on hand${where}`;
    lines.push(line("balance", label, b.balance, at("stableBalance"), "polaris.rule"));
  }

  // Savings and trading history.
  if (facts.defiTenureDays >= 30 || linkedUsed) {
    const a = at("defiTenureDays");
    const over = a?.lowerBound ? "over " : "";
    const label =
      facts.defiTenureDays >= 30
        ? `You've used savings and trading apps for ${over}${formatDuration(facts.defiTenureDays)}`
        : "No history with savings or trading apps yet";
    lines.push(line("defi", label, b.defi, a, "polaris.rule"));
  }

  // First funding.
  if (facts.exchangeFunded) {
    const label = ctx.exchange
      ? `First topped up from ${ctx.exchange}, a major exchange`
      : "First topped up from a major exchange";
    lines.push(line("exchange", label, b.exchange, at("exchangeFunded"), "nansen.first-funder"));
  }

  // Past loans elsewhere.
  if (facts.priorLiquidations > 0) {
    const n = facts.priorLiquidations;
    const label = n === 1 ? "A past loan elsewhere was closed by the lender" : `${formatCount(n)} past loans elsewhere were closed by the lender`;
    lines.push(line("liquidations", label, b.liquidations, at("priorLiquidations"), "etherscan.logs"));
  } else if (linkedUsed) {
    lines.push(line("liquidations", "No past loans closed by a lender", 0, at("priorLiquidations"), "etherscan.logs"));
  }

  // Accounts set up together.
  if (facts.relatedWallets > 3) {
    const label = `Set up from the same source as ${formatCount(facts.relatedWallets)} other accounts`;
    lines.push(line("cluster", label, b.cluster, at("relatedWallets"), "nansen.related-wallets"));
  } else if (linkedUsed && ctx.infrastructureFunder) {
    lines.push(line("cluster", "First topped up from a service many people use", 0, at("relatedWallets"), "nansen.related-wallets"));
  } else if (linkedUsed && !facts.exchangeFunded) {
    lines.push(line("cluster", "Not tied to a group of accounts set up together", b.cluster, at("relatedWallets"), "nansen.related-wallets"));
  }

  // What we could not count.
  if (ctx.linked && !ctx.linked.used) {
    const label =
      ctx.linked.excludedFor === "risk-label"
        ? "We couldn't count your linked account: its money first came from a source we can't accept"
        : "We couldn't finish checking your linked account, so it doesn't count yet";
    lines.push(line("linked-excluded", label, 0, undefined, "nansen.first-funder", "info"));
  }
  const accountMissing = (ctx.missing ?? []).some((m) => m.startsWith("account."));
  if (accountMissing) {
    lines.push(line("missing", "We couldn't read all of this account's history just now", 0, undefined, "polaris.rule", "info"));
  }

  return lines
    .map((l, i) => ({ l, i }))
    .sort((x, y) => {
      const k = KIND_ORDER[x.l.kind] - KIND_ORDER[y.l.kind];
      if (k !== 0) return k;
      const m = Math.abs(y.l.points) - Math.abs(x.l.points);
      return m !== 0 ? m : x.i - y.i;
    })
    .map(({ l }) => l);
}

/** The data providers' names, for a credit next to the lines they back. */
export const PROVIDER_NAMES: Readonly<Record<Provider, string>> = {
  nansen: "Nansen",
  zerion: "Zerion",
  etherscan: "Etherscan",
  rpc: "public RPC",
  polaris: "Polaris",
};

export interface ProviderCredit {
  provider: Provider;
  /** "Nansen". A badge, never part of a reason's sentence. */
  name: string;
  /** The reason lines this provider's data backs, in the order shown. */
  reasons: Array<CreditReason["id"]>;
}

/**
 * Which data providers a decision stands on, for a "from Nansen" credit on the
 * credit screen: each third-party provider behind at least one reason line,
 * in the order its first line appears, with the lines it backs. Polaris's own
 * rules and plain chain reads are not credited.
 */
export function poweredBy(reasons: ReadonlyArray<Pick<CreditReason, "id" | "provider">>): ProviderCredit[] {
  const out: ProviderCredit[] = [];
  for (const r of reasons) {
    if (r.provider === "polaris" || r.provider === "rpc") continue;
    let credit = out.find((c) => c.provider === r.provider);
    if (!credit) {
      credit = { provider: r.provider, name: PROVIDER_NAMES[r.provider], reasons: [] };
      out.push(credit);
    }
    if (!credit.reasons.includes(r.id)) credit.reasons.push(r.id);
  }
  return out;
}

/** The decline, in plain words. */
export function declineReasonFor(b: ScoreBreakdown): string | null {
  if (b.declinedFor.includes("liquidations")) return "Two or more past loans elsewhere were closed by the lender.";
  if (b.declinedFor.includes("cluster")) return "This account looks like one of many set up by the same person.";
  return null;
}
