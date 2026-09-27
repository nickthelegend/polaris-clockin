import { ausdDomain } from "./chain";

/**
 * What can actually work today. A control whose service isn't live is
 * disabled, and the reason sits beside it: nothing is left to fail, and
 * nothing claims money moved when it didn't.
 *
 * Each switch is a public env var the team sets once the piece exists.
 */

/** AUSD on Monad, for ERC-3009 withdrawal signatures. */
export const AUSD_CONFIGURED = ausdDomain() !== null;

/** The relayer that submits signed withdrawals (not built yet). */
export const PAYOUT_RELAYER_LIVE = process.env.NEXT_PUBLIC_PAYOUT_RELAYER_LIVE === "1";

/** Our payout signer's key quorum, added to a merchant's wallet for automatic payouts. */
export const PAYOUT_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID || "";

/** The daily sweep job that uses the session signer (not built yet). */
export const PAYOUT_SWEEP_LIVE = process.env.NEXT_PUBLIC_PAYOUT_SWEEP_LIVE === "1";

/** One-tap withdraw needs AUSD and the relayer. */
export const WITHDRAW_READY = AUSD_CONFIGURED && PAYOUT_RELAYER_LIVE;

/** Automatic payouts need withdrawals, the payout signer and the daily sweep. */
export const AUTO_PAYOUTS_READY = WITHDRAW_READY && Boolean(PAYOUT_SIGNER_ID) && PAYOUT_SWEEP_LIVE;

function missing(parts: [boolean, string][]): string[] {
  return parts.filter(([ok]) => !ok).map(([, name]) => name);
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const WITHDRAW_BLOCKER = WITHDRAW_READY
  ? null
  : `Withdrawals open once ${list(
      missing([
        [AUSD_CONFIGURED, "AUSD on Monad"],
        [PAYOUT_RELAYER_LIVE, "the payout relayer"],
      ]),
    )} ${AUSD_CONFIGURED || PAYOUT_RELAYER_LIVE ? "is" : "are"} connected. Nothing can be sent until then.`;

export const AUTO_PAYOUTS_BLOCKER = AUTO_PAYOUTS_READY
  ? null
  : `Automatic payouts switch on once ${list(
      missing([
        [WITHDRAW_READY, "withdrawals"],
        [Boolean(PAYOUT_SIGNER_ID), "the Privy payout signer"],
        [PAYOUT_SWEEP_LIVE, "the daily sweep"],
      ]),
    )} ${[WITHDRAW_READY, Boolean(PAYOUT_SIGNER_ID), PAYOUT_SWEEP_LIVE].filter((x) => !x).length > 1 ? "are" : "is"} live.`;

/** API keys authenticate the checkout-session API, which isn't served yet. */
export const CHECKOUT_API_LIVE = process.env.NEXT_PUBLIC_CHECKOUT_API_LIVE === "1";

/** The demo storefront, when one is deployed. Without it the landing opens its built-in demo checkout. */
export const DEMO_SHOP_URL = process.env.NEXT_PUBLIC_DEMO_SHOP_URL || "";
