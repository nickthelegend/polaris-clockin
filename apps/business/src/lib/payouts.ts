"use client";

import { usePrivy, useSigners, useSignTypedData } from "@privy-io/react-auth";
import { useCallback } from "react";

import { ausdDomain, AUTHORIZATION_TTL_SECONDS, CENTS_TO_AUSD_UNITS, TRANSFER_WITH_AUTHORIZATION_TYPES } from "./chain";
import type { Address, AutoPayouts, Cents, Payout, WithdrawInput } from "./data/types";
import { useDashboardData, useEmbeddedWallet } from "./session";

const PAYOUT_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID || "";

type Domain = { name: string; version: string; chainId: number; verifyingContract: Address };

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

let networkDomain: Promise<Domain | null> | null = null;

/**
 * AUSD's EIP-712 domain as the server serves it (`/api/public/network`, from
 * the deployment record, so the chain id and address are the ones the relayer
 * uses), falling back to this build's NEXT_PUBLIC_AUSD_* settings. Null when
 * the server has no chain: withdrawals are then sample data.
 */
export function stablecoinDomain(): Promise<Domain | null> {
  networkDomain ??= fetch("/api/public/network", { cache: "no-store" })
    .then(async (res) => (res.ok ? ((await res.json()) as { data: { domains: { stablecoin: Domain } } }).data.domains.stablecoin : null))
    .catch(() => null)
    .then((d) => d ?? (ausdDomain() as Domain | null));
  return networkDomain;
}

/** Whether this build knows AUSD itself; the server's network, when reachable, is used either way. */
export const WITHDRAWALS_SIGNED = ausdDomain() !== null;
/** Whether turning on automatic payouts adds our Privy signer to the wallet. */
export const AUTO_PAYOUTS_LIVE = Boolean(PAYOUT_SIGNER_ID);

/**
 * One-tap withdraw. The merchant's embedded wallet signs an ERC-3009
 * TransferWithAuthorization (no gas: the relayer submits it as
 * `AUSD.transferWithAuthorization`) and the server checks the signature came
 * from that wallet before relaying it.
 */
export function useWithdraw() {
  const data = useDashboardData();
  const { signTypedData } = useSignTypedData();
  const { wallet } = useEmbeddedWallet();

  return useCallback(
    async (amountCents: Cents, destination: Address): Promise<Payout> => {
      const domain = await stablecoinDomain();
      const input: WithdrawInput = { amountCents, destination };

      if (domain) {
        if (!wallet) throw new Error("Your payout account is still being set up. Try again in a moment.");
        const validAfter = "0";
        const validBefore = String(Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL_SECONDS);
        const nonce = randomNonce();
        const { signature } = await signTypedData(
          {
            domain,
            types: {
              TransferWithAuthorization: [...TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization],
            },
            primaryType: "TransferWithAuthorization",
            // uint256 values as decimal strings (see docs/research/privy.md §2.5).
            message: {
              from: wallet.address,
              to: destination,
              value: (BigInt(amountCents) * CENTS_TO_AUSD_UNITS).toString(),
              validAfter,
              validBefore,
              nonce,
            },
          },
          {
            address: wallet.address,
            uiOptions: { title: "Confirm withdrawal", buttonText: "Confirm" },
          },
        );
        input.authorization = { validAfter, validBefore, nonce, signature: signature as `0x${string}` };
      }

      return data.withdraw(input);
    },
    [data, signTypedData, wallet],
  );
}

/**
 * Automatic daily payouts. The server creates a Privy policy that allows only
 * AUSD transfers to `payoutAddress`; we then add our payout signer to the
 * merchant's wallet with that policy as its override. Turning off removes it.
 */
export function useAutoPayouts() {
  const data = useDashboardData();
  const { addSigners, removeSigners } = useSigners();
  const { wallet } = useEmbeddedWallet();

  const enable = useCallback(
    async (payoutAddress: Address): Promise<AutoPayouts> => {
      const auto = await data.setAutoPayouts({ enabled: true, payoutAddress });
      if (AUTO_PAYOUTS_LIVE && auto.policyId) {
        if (!wallet) throw new Error("Your payout account is still being set up. Try again in a moment.");
        try {
          await addSigners({
            address: wallet.address,
            signers: [{ signerId: PAYOUT_SIGNER_ID, policyIds: [auto.policyId] }],
          });
        } catch (error) {
          // Keep the server honest: no signer means no automatic payouts.
          await data.setAutoPayouts({ enabled: false, payoutAddress }).catch(() => undefined);
          throw error;
        }
      }
      return auto;
    },
    [data, addSigners, wallet],
  );

  const disable = useCallback(
    async (payoutAddress: Address | null): Promise<AutoPayouts> => {
      const auto = await data.setAutoPayouts({ enabled: false, payoutAddress });
      if (AUTO_PAYOUTS_LIVE && wallet) await removeSigners({ address: wallet.address });
      return auto;
    },
    [data, removeSigners, wallet],
  );

  return { enable, disable };
}

/**
 * Register the business on chain (MerchantRegistry), right after it is named:
 * the embedded wallet signs the `Registration` the server prepares, and the
 * relayer sends `registerFor`. The merchant never holds MON.
 */
export function useRegisterMerchant() {
  const { getAccessToken } = usePrivy();
  const { signTypedData } = useSignTypedData();
  const { wallet } = useEmbeddedWallet();

  return useCallback(async () => {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const call = async (method: "GET" | "POST", body?: unknown) => {
      const res = await fetch("/api/merchant/registration", { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as { data?: RegistrationState; error?: { message?: string } } | null;
      if (!res.ok || !payload?.data) throw new Error(payload?.error?.message ?? "Registration didn't go through. Try again.");
      return payload.data;
    };
    const state = await call("GET");
    if (!state.typedData) return state;
    if (!wallet) throw new Error("Your payout account is still being set up. Try again in a moment.");
    const { signature } = await signTypedData(state.typedData, {
      address: wallet.address,
      uiOptions: { title: "Register your business", buttonText: "Confirm" },
    });
    return call("POST", { signature, deadline: state.typedData.message.deadline });
  }, [getAccessToken, signTypedData, wallet]);
}

type RegistrationState = {
  merchant: { registration?: { state: string } };
  typedData: {
    domain: Domain;
    types: { Registration: { name: string; type: string }[] };
    primaryType: "Registration";
    message: Record<string, string> & { deadline: string };
  } | null;
};
