"use client";

import { useSigners, useSignTypedData } from "@privy-io/react-auth";
import { useCallback } from "react";

import { ausdDomain, AUTHORIZATION_TTL_SECONDS, CENTS_TO_AUSD_UNITS, TRANSFER_WITH_AUTHORIZATION_TYPES } from "./chain";
import type { Address, AutoPayouts, Cents, Payout, WithdrawInput } from "./data/types";
import { useDashboardData, useEmbeddedWallet } from "./session";

const PAYOUT_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_PAYOUT_SIGNER_ID || "";

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether withdrawals are signed by the payout wallet (AUSD configured) or recorded as sample data. */
export const WITHDRAWALS_SIGNED = ausdDomain() !== null;
/** Whether turning on automatic payouts adds our Privy signer to the wallet. */
export const AUTO_PAYOUTS_LIVE = Boolean(PAYOUT_SIGNER_ID) && WITHDRAWALS_SIGNED;

/**
 * One-tap withdraw. With AUSD configured, the merchant's embedded wallet signs
 * an ERC-3009 TransferWithAuthorization (no gas: the relayer submits it) and
 * the server checks the signature came from that wallet.
 */
export function useWithdraw() {
  const data = useDashboardData();
  const { signTypedData } = useSignTypedData();
  const { wallet } = useEmbeddedWallet();

  return useCallback(
    async (amountCents: Cents, destination: Address): Promise<Payout> => {
      const domain = ausdDomain();
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
