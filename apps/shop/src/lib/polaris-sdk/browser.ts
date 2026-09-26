import { encodeFunctionData, encodePacked, keccak256, parseSignature, type TypedDataDomain } from "viem";

import { PolarisError, configurationError, walletError } from "./errors";
import { centsToBaseUnits, formatCents, toCents, type AmountInput } from "./money";
import type { Address, CheckoutMessage, CheckoutResult, CheckoutSession, Hex } from "./types";

/**
 * Browser half of polarispay-sdk 0.3.0: send the buyer to the hosted
 * checkout (a centred popup on desktop, a full-page redirect on phones) and
 * pay directly from any EIP-1193 wallet with an ERC-3009 signature.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface PolarisChain {
  key: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** AUSD. */
  stablecoin: Address;
  stablecoinSymbol: string;
  /** PolarisPayments, which records the order and forwards the money to the merchant. */
  payments: Address;
  /**
   * The stablecoin's EIP-712 domain. Read from the token (ERC-5267) when
   * omitted; pinned here where the RPC can't be asked.
   */
  stablecoinDomain?: { name: string; version: string };
}

export const MONAD_TESTNET: PolarisChain = {
  key: "monad-testnet",
  chainId: 10143,
  name: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorer: "https://testnet.monadvision.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  stablecoin: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  stablecoinSymbol: "AUSD",
  payments: ZERO_ADDRESS,
};

export type PolarisOptions = {
  publishableKey: string;
  /** Where the hosted checkout lives. Messages from any other origin are ignored. */
  checkoutOrigin?: string;
  /** Polaris's relayer: with it, pay() is a signature and nothing else, gasless for the buyer. */
  relayUrl?: string;
  chain?: PolarisChain;
};

export type SessionSource =
  | string
  | Pick<CheckoutSession, "id" | "url">
  | Promise<string | Pick<CheckoutSession, "id" | "url">>
  | (() => Promise<string | Pick<CheckoutSession, "id" | "url">>);

export type OpenCheckoutOptions = {
  /** "auto" (default): a popup on wide screens, a redirect on phones. */
  presentation?: "auto" | "popup" | "redirect";
  width?: number;
  height?: number;
};

export type PayStatus = "connecting" | "switching_network" | "signing" | "relaying" | "submitting" | "submitted";

export type PayParams = {
  merchant: Address;
  amount: AmountInput;
  /** The order id the payment is recorded under. Make it unguessable. */
  orderId: string;
  provider?: Eip1193Provider;
  onStatus?: (status: PayStatus) => void;
};

export type PayResult = {
  status: "submitted";
  payer: Address;
  txHash: Hex;
  paymentId: Hex;
  relayed: boolean;
};

const PK = /^pk_(test|live)_[A-Za-z0-9_]{8,}$/;
const MESSAGE_SOURCE = "polaris-checkout";

export function createPolaris(options: PolarisOptions) {
  const publishableKey = options.publishableKey?.trim();
  if (!publishableKey) throw configurationError("missing_publishable_key", "Pass a publishableKey (pk_test_… or pk_live_…).", "publishableKey");
  if (publishableKey.startsWith("sk_")) {
    throw configurationError(
      "secret_key_in_browser",
      "That is a secret key (sk_…). Never ship it to a browser: roll it, and pass the publishable key (pk_…) here instead.",
      "publishableKey",
    );
  }
  if (!PK.test(publishableKey)) throw configurationError("invalid_publishable_key", "publishableKey doesn't look like pk_test_… or pk_live_….", "publishableKey");

  const checkoutOrigin = new URL(options.checkoutOrigin ?? "https://pay.polarispay.app").origin;
  const chain = options.chain ?? MONAD_TESTNET;

  async function resolve(source: SessionSource): Promise<{ url: string; sessionId: string | null }> {
    const value = typeof source === "function" ? await source() : await source;
    const url = typeof value === "string" ? value : value.url;
    const sessionId = typeof value === "string" ? null : value.id;
    let parsed: URL;
    try {
      parsed = new URL(url, window.location.href);
    } catch {
      throw new PolarisError(`The session URL ${JSON.stringify(url)} isn't a URL.`, { type: "checkout_error", code: "invalid_session_url" });
    }
    if (parsed.origin !== checkoutOrigin) {
      throw new PolarisError(
        `The session URL is on ${parsed.origin}, but checkoutOrigin is ${checkoutOrigin}. Set checkoutOrigin to the Polaris checkout your server's sessions point at.`,
        { type: "configuration_error", code: "checkout_origin_mismatch" },
      );
    }
    return { url: parsed.toString(), sessionId };
  }

  async function redirectToCheckout(source: SessionSource): Promise<CheckoutResult> {
    const { url, sessionId } = await resolve(source);
    window.location.assign(url);
    return { status: "redirected", sessionId };
  }

  /**
   * Open the hosted checkout and resolve with what the buyer did. Call it
   * straight from a click handler: the popup opens synchronously (so it isn't
   * blocked) and shows a loading state while `source` resolves.
   */
  async function openCheckout(source: SessionSource, opts: OpenCheckoutOptions = {}): Promise<CheckoutResult> {
    const presentation = opts.presentation ?? "auto";
    if (presentation === "redirect" || (presentation === "auto" && prefersRedirect())) {
      return redirectToCheckout(source);
    }

    const width = opts.width ?? 460;
    const height = opts.height ?? 780;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open("", "polaris-checkout", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!popup) return redirectToCheckout(source);
    writeLoading(popup);

    let target: { url: string; sessionId: string | null };
    try {
      target = await resolve(source);
    } catch (error) {
      popup.close();
      throw error;
    }
    popup.location.replace(target.url);
    popup.focus();

    return new Promise<CheckoutResult>((done) => {
      let settled = false;
      const finish = (result: CheckoutResult) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        window.clearInterval(watch);
        done(result);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== checkoutOrigin) return;
        const data = event.data as Partial<CheckoutMessage> | null;
        if (!data || data.source !== MESSAGE_SOURCE || typeof data.sessionId !== "string") return;
        if (target.sessionId && data.sessionId !== target.sessionId) return;
        if (data.status === "complete") {
          finish({ status: "complete", sessionId: data.sessionId, mode: data.mode ?? null, orderId: data.orderId ?? null });
        } else if (data.status === "canceled") {
          finish({ status: "canceled", sessionId: data.sessionId });
        }
      };
      window.addEventListener("message", onMessage);
      // A message posted just before the popup closes can arrive after
      // `closed` flips, so give it a beat before calling it abandoned.
      const watch = window.setInterval(() => {
        if (popup.closed) window.setTimeout(() => finish({ status: "closed", sessionId: target.sessionId }), 350);
      }, 400);
    });
  }

  async function pay(params: PayParams): Promise<PayResult> {
    const provider = params.provider ?? (globalThis as { ethereum?: Eip1193Provider }).ethereum;
    if (!provider) throw walletError("no_wallet", "No browser wallet was found.");
    const status = params.onStatus ?? (() => {});
    const cents = toCents(params.amount);
    const value = centsToBaseUnits(cents);

    status("connecting");
    const accounts = (await call(provider, "eth_requestAccounts")) as string[];
    const payer = accounts?.[0] as Address | undefined;
    if (!payer) throw walletError("user_rejected", "The wallet didn't share an account.");

    await ensureChain(provider, chain, status);

    if (!options.relayUrl && chain.payments === ZERO_ADDRESS) {
      throw walletError("not_deployed", `Polaris isn't deployed on ${chain.name} yet.`);
    }

    const domain: TypedDataDomain = {
      ...(chain.stablecoinDomain ?? (await readDomain(provider, chain.stablecoin)) ?? { name: "AUSD", version: "1" }),
      chainId: chain.chainId,
      verifyingContract: chain.stablecoin,
    };
    const nonce = paymentIdFor(params.merchant, params.orderId);
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const typedData = receiveAuthorizationTypedData({
      domain,
      from: payer,
      to: chain.payments,
      value,
      validAfter,
      validBefore,
      nonce,
    });

    status("signing");
    const signature = (await call(provider, "eth_signTypedData_v4", [payer, JSON.stringify(typedData, bigintReplacer)])) as Hex;
    const { v, r, s, yParity } = parseSignature(signature);
    const vNumber = v !== undefined ? Number(v) : yParity + 27;

    if (options.relayUrl) {
      status("relaying");
      const res = await fetch(options.relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${publishableKey}` },
        body: JSON.stringify({
          payer,
          merchant: params.merchant,
          amount: formatCents(cents),
          value: value.toString(),
          orderId: params.orderId,
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          v: vNumber,
          r,
          s,
          signature,
          chainId: chain.chainId,
        }),
      }).catch((cause) => {
        throw walletError("relay_failed", "Couldn't reach the Polaris relayer.", cause);
      });
      const body = (await res.json().catch(() => null)) as { txHash?: Hex; paymentId?: Hex; error?: { message?: string } } | null;
      if (!res.ok || !body?.txHash) {
        throw walletError("relay_failed", body?.error?.message ?? `The relayer answered ${res.status}.`);
      }
      status("submitted");
      return { status: "submitted", payer, txHash: body.txHash, paymentId: body.paymentId ?? nonce, relayed: true };
    }

    status("submitting");
    const data = encodeFunctionData({
      abi: PAY_WITH_AUTHORIZATION_ABI,
      functionName: "payWithAuthorization",
      args: [payer, params.merchant, value, params.orderId, validAfter, validBefore, vNumber, r, s],
    });
    const txHash = (await call(provider, "eth_sendTransaction", [{ from: payer, to: chain.payments, data }])) as Hex;
    status("submitted");
    return { status: "submitted", payer, txHash, paymentId: nonce, relayed: false };
  }

  return { publishableKey, checkoutOrigin, chain, relayUrl: options.relayUrl ?? null, redirectToCheckout, openCheckout, pay };
}

export type Polaris = ReturnType<typeof createPolaris>;

/** keccak256(abi.encodePacked(merchant, orderId)): the payment id, and the ERC-3009 nonce. */
export function paymentIdFor(merchant: Address, orderId: string): Hex {
  return keccak256(encodePacked(["address", "string"], [merchant, orderId]));
}

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function receiveAuthorizationTypedData(input: {
  domain: TypedDataDomain;
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: input.domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...RECEIVE_WITH_AUTHORIZATION_TYPES,
    },
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: input.from,
      to: input.to,
      value: input.value,
      validAfter: input.validAfter,
      validBefore: input.validBefore,
      nonce: input.nonce,
    },
  };
}

const PAY_WITH_AUTHORIZATION_ABI = [
  {
    type: "function",
    name: "payWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payer", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "orderId", type: "string" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "paymentId", type: "bytes32" }],
  },
] as const;

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function call(provider: Eip1193Provider, method: string, params?: unknown[]): Promise<unknown> {
  try {
    return await provider.request(params ? { method, params } : { method });
  } catch (cause) {
    const code = (cause as { code?: number })?.code;
    if (code === 4001 || code === 4100) throw walletError("user_rejected", "You declined the request in your wallet.", cause);
    throw walletError("unknown_wallet_error", (cause as Error)?.message ?? "The wallet refused the request.", cause);
  }
}

async function ensureChain(provider: Eip1193Provider, chain: PolarisChain, status: (s: PayStatus) => void) {
  const current = Number.parseInt(String(await call(provider, "eth_chainId")), 16);
  if (current === chain.chainId) return;
  status("switching_network");
  const chainIdHex = `0x${chain.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (cause) {
    const code = (cause as { code?: number })?.code;
    if (code === 4902 || code === -32603) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.explorer],
            },
          ],
        });
      } catch (addCause) {
        throw walletError("wrong_network", `Switch your wallet to ${chain.name} to pay.`, addCause);
      }
    } else {
      throw walletError("wrong_network", `Switch your wallet to ${chain.name} to pay.`, cause);
    }
  }
  const after = Number.parseInt(String(await call(provider, "eth_chainId")), 16);
  if (after !== chain.chainId) throw walletError("wrong_network", `Switch your wallet to ${chain.name} to pay.`);
}

/** ERC-5267 eip712Domain() on the token, through the wallet's own RPC. Null when it can't be read. */
async function readDomain(provider: Eip1193Provider, token: Address): Promise<{ name: string; version: string } | null> {
  try {
    const result = (await provider.request({
      method: "eth_call",
      params: [{ to: token, data: "0x84b0196e" }, "latest"],
    })) as Hex;
    if (!result || result === "0x") return null;
    const { decodeAbiParameters } = await import("viem");
    const [, name, version] = decodeAbiParameters(
      [
        { type: "bytes1" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256[]" },
      ],
      result,
    );
    return { name, version };
  } catch {
    return null;
  }
}

function prefersRedirect(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 640px)").matches || (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900);
}

function writeLoading(popup: Window) {
  try {
    popup.document.title = "Polaris";
    popup.document.body.innerHTML = `
      <div style="position:fixed;inset:0;display:grid;place-items:center;background:#0f1011;color:#f5f5f5;font:500 15px/1.4 system-ui,sans-serif">
        <div style="display:grid;justify-items:center;gap:14px">
          <svg width="36" height="40" viewBox="16 12 520 580" aria-hidden="true"><path fill="#2E8C0A" d="M272.75 19.25 C234.43 201.65 229.25 269.62 24.75 309.00 C203.59 340.32 230.25 429.07 273.00 585.00 C318.08 425.91 340.04 338.84 524.50 309.00 C319.50 272.76 312.50 200.32 272.75 19.25Z"/><path fill="#BFFA62" d="M272.75 52.25 C266.92 210.23 239.78 285.35 71.25 307.25 C209.40 327.64 260.85 393.28 272.75 530.50 C285.19 395.19 337.69 324.22 477.50 307.75 C304.53 284.01 284.32 212.19 272.75 52.25Z"/></svg>
          <span>Opening Polaris checkout…</span>
        </div>
      </div>`;
  } catch {
    // Cross-origin already (a reused popup): nothing to draw into.
  }
}
