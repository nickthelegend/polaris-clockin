/**
 * Decode the revert data the CRE receivers record (TaskSkipped.reason,
 * UnderwritingRefused.reason) into a name and what it means for the buyer.
 *
 * The loan engine reports a shortfall before it moves anything, as one of two
 * errors a keeper can branch on: InsufficientAllowance means the buyer has to
 * sign a new allowance (RESIGN), InsufficientBalance means they have to top up
 * (TOP_UP). Telling them the wrong one duns a buyer for our mistake. A
 * subscription charge fails inside the token instead, so OpenZeppelin's
 * ERC20InsufficientAllowance / ERC20InsufficientBalance map the same way.
 * NotDue, LoanNotActive, InvalidLoan, SubscriptionNotActive and
 * NotLiquidatable mean the candidate was not actionable (STALE): nobody's fault.
 *
 * Selectors are the first four bytes of keccak256(signature); the test suite
 * recomputes every one with viem so a typo cannot hide here.
 */

export type ReasonAction = "RESIGN" | "TOP_UP" | "STALE" | "OTHER";

export type DecodedRevert = {
  /** The error's name, or the raw selector when unknown, or "EMPTY". */
  readonly name: string;
  readonly action: ReasonAction;
  /** What the buyer had and what was needed, for the two shortfall errors. */
  readonly have?: bigint;
  readonly need?: bigint;
  /** Error(string) message, if any. */
  readonly message?: string;
  /** Address arguments, lowercase, in order (WalletAlreadyLinked, InvalidUser, ...). */
  readonly addresses?: readonly string[];
};

type Known = {
  readonly name: string;
  readonly action: ReasonAction;
  /** Argument layout: which words are uint256 have/need, which are addresses. */
  readonly shape?: "have-need" | "addr-have-need" | "addr" | "addr-addr" | "string";
};

export const ERROR_SELECTORS: Readonly<Record<string, Known & { readonly signature: string }>> = {
  "0x2a1b2dd8": { signature: "InsufficientAllowance(uint256,uint256)", name: "InsufficientAllowance", action: "RESIGN", shape: "have-need" },
  "0xcf479181": { signature: "InsufficientBalance(uint256,uint256)", name: "InsufficientBalance", action: "TOP_UP", shape: "have-need" },
  "0xfb8f41b2": { signature: "ERC20InsufficientAllowance(address,uint256,uint256)", name: "ERC20InsufficientAllowance", action: "RESIGN", shape: "addr-have-need" },
  "0xe450d38c": { signature: "ERC20InsufficientBalance(address,uint256,uint256)", name: "ERC20InsufficientBalance", action: "TOP_UP", shape: "addr-have-need" },
  "0x47a2375f": { signature: "NotDue()", name: "NotDue", action: "STALE" },
  "0x082f7846": { signature: "LoanNotActive()", name: "LoanNotActive", action: "STALE" },
  "0x045f33d1": { signature: "InvalidLoan()", name: "InvalidLoan", action: "STALE" },
  "0xefb74efe": { signature: "SubscriptionNotActive()", name: "SubscriptionNotActive", action: "STALE" },
  "0xddeb79ba": { signature: "NotLiquidatable()", name: "NotLiquidatable", action: "STALE" },
  "0x60df9f87": { signature: "UnknownAction(uint8)", name: "UnknownAction", action: "OTHER" },
  "0x08c379a0": { signature: "Error(string)", name: "Error", action: "OTHER", shape: "string" },
  "0x4e487b71": { signature: "Panic(uint256)", name: "Panic", action: "OTHER" },
  "0x5274afe7": { signature: "SafeERC20FailedOperation(address)", name: "SafeERC20FailedOperation", action: "OTHER", shape: "addr" },
  "0x1f2a2005": { signature: "ZeroAmount()", name: "ZeroAmount", action: "OTHER" },
  // UnderwritingReceiver refusals (ScoreManager.underwrite and the receiver's own checks).
  "0x5d4ad9a9": { signature: "StaleEvidence()", name: "StaleEvidence", action: "OTHER" },
  "0xc64b752a": { signature: "AlreadyHasRecord()", name: "AlreadyHasRecord", action: "OTHER" },
  "0x4ae69729": { signature: "WalletAlreadyLinked(address,address)", name: "WalletAlreadyLinked", action: "OTHER", shape: "addr-addr" },
  "0xba1b16ec": { signature: "InvalidUser(address)", name: "InvalidUser", action: "OTHER", shape: "addr" },
  "0xb7ae6378": { signature: "NotUnderwriter()", name: "NotUnderwriter", action: "OTHER" },
  "0x751a1cd0": { signature: "NotWriter()", name: "NotWriter", action: "OTHER" },
};

function word(data: string, index: number): string | undefined {
  const start = 10 + index * 64;
  const w = data.slice(start, start + 64);
  return w.length === 64 ? w : undefined;
}

function uintAt(data: string, index: number): bigint | undefined {
  const w = word(data, index);
  return w === undefined ? undefined : BigInt(`0x${w}`);
}

function addressAt(data: string, index: number): string | undefined {
  const w = word(data, index);
  return w === undefined ? undefined : `0x${w.slice(24)}`;
}

function stringAt(data: string): string | undefined {
  const offset = uintAt(data, 0);
  if (offset === undefined || offset % 32n !== 0n) return undefined;
  const lenIndex = Number(offset / 32n);
  const len = uintAt(data, lenIndex);
  if (len === undefined || len > 4096n) return undefined;
  const start = 10 + (lenIndex + 1) * 64;
  const hex = data.slice(start, start + Number(len) * 2);
  if (hex.length !== Number(len) * 2) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** A token that reverts with a message rather than a custom error. */
function actionFromMessage(message: string): ReasonAction {
  const m = message.toLowerCase();
  if (m.includes("allowance")) return "RESIGN";
  if (m.includes("balance")) return "TOP_UP";
  return "OTHER";
}

export function decodeRevert(data: string | undefined | null): DecodedRevert {
  const hex = (data ?? "0x").toLowerCase();
  if (hex.length < 10) return { name: "EMPTY", action: "OTHER" };
  const selector = hex.slice(0, 10);
  const known = ERROR_SELECTORS[selector];
  if (!known) return { name: selector, action: "OTHER" };
  switch (known.shape) {
    case "have-need":
      return { name: known.name, action: known.action, have: uintAt(hex, 0), need: uintAt(hex, 1) };
    case "addr-have-need":
      return {
        name: known.name,
        action: known.action,
        have: uintAt(hex, 1),
        need: uintAt(hex, 2),
        addresses: [addressAt(hex, 0)].filter((a): a is string => a !== undefined),
      };
    case "addr":
      return { name: known.name, action: known.action, addresses: [addressAt(hex, 0)].filter((a): a is string => a !== undefined) };
    case "addr-addr":
      return {
        name: known.name,
        action: known.action,
        addresses: [addressAt(hex, 0), addressAt(hex, 1)].filter((a): a is string => a !== undefined),
      };
    case "string": {
      const message = stringAt(hex);
      return message === undefined
        ? { name: known.name, action: known.action }
        : { name: known.name, action: actionFromMessage(message), message };
    }
    default:
      return { name: known.name, action: known.action };
  }
}
