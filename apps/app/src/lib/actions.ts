import { type Address, type Hex, type LocalAccount, parseAbi, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { publicClient } from "./chain";
import type { PaymentLink, Person, Plan } from "./data/types";
import { contractAddress, getDomain, isConfigured } from "./domains";
import { amountParam, type Micros } from "./money";
import { type RelayReceipt, relayer, type Signed } from "./relayer";
import {
  buildCancel,
  buildCancelSubscription,
  buildClaim,
  buildPermit,
  buildPlanIntent,
  buildReceiveWithAuthorization,
  buildSubscribeIntent,
  buildTransferWithAuthorization,
  type Eip712Domain,
  orderIdToBytes32,
  paymentNonce,
  sendNonce,
} from "./sign";

/**
 * Each money action as the app performs it: build the typed data, sign it
 * with the account (no prompt: Face ID already happened in `authorize`), and
 * hand the signatures to the relayer.
 */

const MINUTE = 60n;
const now = () => BigInt(Math.floor(Date.now() / 1000));

/** How long a link stays claimable. PolarisSend allows 5 minutes to 30 days. */
export const SEND_LINK_LIFETIME_DAYS = 7;

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function permitNonce(owner: Address): Promise<bigint> {
  if (!isConfigured("ausd")) return 0n;
  try {
    return await publicClient().readContract({
      address: contractAddress("ausd"),
      abi: parseAbi(["function nonces(address owner) view returns (uint256)"]),
      functionName: "nonces",
      args: [owner],
    });
  } catch {
    return 0n;
  }
}

/** Signs a payload from one of the builders (which type-check it against viem). */
async function sign<M>(account: LocalAccount, typed: { domain: Eip712Domain; message: M }): Promise<Signed<M>> {
  const signature = await account.signTypedData(typed as unknown as Parameters<LocalAccount["signTypedData"]>[0]);
  return { signature, domain: typed.domain, message: typed.message };
}

export type PayMode = "now" | "later" | "subscription";

/** Checkout: Pay now, Pay in 4 or Subscribe. */
export async function payLink(
  account: LocalAccount,
  link: PaymentLink,
  mode: PayMode,
  opts: { outstanding?: Micros } = {},
): Promise<RelayReceipt> {
  const t = now();
  if (mode === "now") {
    const domain = await getDomain("ausd");
    const signed = await sign(
      account,
      buildReceiveWithAuthorization(domain, {
        from: account.address,
        to: contractAddress("payments"),
        value: link.amount,
        validAfter: 0n,
        validBefore: t + 10n * MINUTE,
        // Commits the signature to this merchant and this order.
        nonce: paymentNonce(link.merchant.address, link.orderId),
      }),
    );
    return relayer.payNow({ link, payer: account.address, authorization: signed });
  }

  if (mode === "later") {
    const offer = link.modes.later;
    if (!offer) throw new Error("This link doesn't offer Pay in 4");
    const [checkoutDomain, tokenDomain, nonce] = await Promise.all([
      getDomain("checkout"),
      getDomain("ausd"),
      permitNonce(account.address),
    ]);
    const deadline = t + 15n * MINUTE;
    const intent = await sign(
      account,
      buildPlanIntent(checkoutDomain, {
        borrower: account.address,
        merchant: link.merchant.address,
        principal: link.amount,
        installments: offer.installments,
        interval: BigInt(offer.interval),
        orderId: orderIdToBytes32(link.orderId),
        deadline,
      }),
    );
    // One allowance backs the whole book (§5.2): what's owed already plus this plan.
    const permit = await sign(
      account,
      buildPermit(tokenDomain, {
        owner: account.address,
        spender: contractAddress("loanEngine"),
        value: (opts.outstanding ?? 0n) + offer.total,
        nonce,
        deadline,
      }),
    );
    return relayer.openPlan({ link, intent, permit });
  }

  const offer = link.modes.subscription;
  if (!offer) throw new Error("This link doesn't offer a subscription");
  const [checkoutDomain, tokenDomain, nonce] = await Promise.all([
    getDomain("checkout"),
    getDomain("ausd"),
    permitNonce(account.address),
  ]);
  const deadline = t + 15n * MINUTE;
  const intent = await sign(
    account,
    buildSubscribeIntent(checkoutDomain, { subscriber: account.address, planId: offer.planId, deadline }),
  );
  const permit = await sign(
    account,
    buildPermit(tokenDomain, {
      owner: account.address,
      spender: contractAddress("payments"),
      value: offer.price * BigInt(offer.periodsAuthorised),
      nonce,
      deadline,
    }),
  );
  return relayer.subscribe({ link, intent, permit });
}

export type CreatedSendLink = {
  url: string;
  linkKey: Address;
  amount: Micros;
  expiresAt: number;
  receipt: RelayReceipt;
};

/**
 * Send by link. A throwaway key is born here and travels only inside the
 * link's fragment, which browsers never send to a server. The sender's
 * signature escrows the dollars against that key's address.
 */
export async function createSendLink(
  account: LocalAccount,
  amount: Micros,
  senderName: string,
  origin: string,
): Promise<CreatedSendLink> {
  const linkPrivateKey = generatePrivateKey();
  const linkKey = privateKeyToAccount(linkPrivateKey).address;
  const t = now();
  const expiresAt = t + BigInt(SEND_LINK_LIFETIME_DAYS) * 86_400n;
  const domain = await getDomain("ausd");
  const authorization = await sign(
    account,
    buildReceiveWithAuthorization(domain, {
      from: account.address,
      to: contractAddress("send"),
      value: amount,
      validAfter: 0n,
      validBefore: t + 10n * MINUTE,
      // Commits the signature to this link key and expiry.
      nonce: sendNonce(linkKey, expiresAt),
    }),
  );
  const receipt = await relayer.send({ sender: account.address, senderName, linkKey, amount, expiresAt, authorization });
  const fragment = new URLSearchParams({ k: linkPrivateKey, a: amountParam(amount), n: senderName });
  return {
    url: `${origin}/claim#${fragment.toString()}`,
    linkKey,
    amount,
    expiresAt: Number(expiresAt) * 1000,
    receipt,
  };
}

/** Claim: the link's key signs the recipient's address. No account signature needed. */
export async function claimLink(
  recipient: Address,
  linkPrivateKey: Hex,
  amount: Micros,
  senderName: string,
): Promise<RelayReceipt> {
  const linkAccount = privateKeyToAccount(linkPrivateKey);
  const domain = await getDomain("send");
  const claim = await sign(linkAccount, buildClaim(domain, { to: recipient }));
  return relayer.claim({ linkKey: linkAccount.address, claim, amount, senderName });
}

export async function cancelSendLink(account: LocalAccount, linkKey: Address): Promise<RelayReceipt> {
  const domain = await getDomain("send");
  const cancel = await sign(account, buildCancel(domain, { linkKey, deadline: now() + 15n * MINUTE }));
  return relayer.cancelSend({ cancel });
}

export async function cancelSubscription(account: LocalAccount, subId: bigint): Promise<RelayReceipt> {
  const domain = await getDomain("payments");
  const cancel = await sign(account, buildCancelSubscription(domain, { subId, deadline: now() + 15n * MINUTE }));
  return relayer.cancelSubscription({ cancel });
}

/** Send straight to someone who already has Polaris (their Receive code). */
export async function transferTo(account: LocalAccount, to: Person, amount: Micros): Promise<RelayReceipt> {
  if (!to.address || to.address === zeroAddress) throw new Error("That code has no account on it");
  const domain = await getDomain("ausd");
  const t = now();
  const authorization = await sign(
    account,
    buildTransferWithAuthorization(domain, {
      from: account.address,
      to: to.address,
      value: amount,
      validAfter: 0n,
      validBefore: t + 10n * MINUTE,
      nonce: randomNonce(),
    }),
  );
  return relayer.transfer({ to, authorization });
}

export async function payEarly(account: LocalAccount, plan: Plan): Promise<RelayReceipt> {
  return relayer.payEarly({ planId: plan.id, loanId: plan.loanId, borrower: account.address });
}
