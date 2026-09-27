"use client";

import { useCallback } from "react";

import { useAuth } from "./auth-context";
import { ausdDomain, AUTHORIZATION_TTL_SECONDS, CENTS_TO_AUSD_UNITS, TRANSFER_WITH_AUTHORIZATION_TYPES } from "./chain";
import type { Address, AutoPayouts, Cents, Payout, WithdrawInput } from "./data/types";
import { AUTO_PAYOUTS_READY, PAYOUT_SIGNER_ID } from "./features";
import { useDashboardData } from "./session";

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * One-tap withdraw. The merchant's embedded wallet signs an ERC-3009
 * TransferWithAuthorization (no gas: the relayer submits it) and the server
 * checks the signature came from that wallet before queueing it. Callers
 * only reach this when WITHDRAW_READY (see features.ts).
 */
export function useWithdraw() {
  const data = useDashboardData();
  const { wallet } = useAuth();

  return useCallback(
    async (amountCents: Cents, destination: Address): Promise<Payout> => {
      const domain = ausdDomain();
      const input: WithdrawInput = { amountCents, destination };

      if (domain) {
        if (!wallet.address) throw new Error("Your payout account is still being set up. Try again in a moment.");
        const validAfter = "0";
        const validBefore = String(Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL_SECONDS);
        const nonce = randomNonce();
        const signature = await wallet.signTypedData(
          {
            domain,
            types: { TransferWithAuthorization: [...TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization] },
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
          { title: "Confirm withdrawal", buttonText: "Confirm" },
        );
        input.authorization = { validAfter, validBefore, nonce, signature };
      }

      return data.withdraw(input);
    },
    [data, wallet],
  );
}

/**
 * Automatic daily payouts. The server creates a Privy policy that allows only
 * AUSD transfers to `payoutAddress`; we then add our payout signer to the
 * merchant's wallet with that policy. Turning off removes it, and never needs
 * the wallet on the server side.
 */
export function useAutoPayouts() {
  const data = useDashboardData();
  const { wallet } = useAuth();

  const enable = useCallback(
    async (payoutAddress: Address): Promise<AutoPayouts> => {
      const auto = await data.setAutoPayouts({ enabled: true, payoutAddress });
      if (AUTO_PAYOUTS_READY && auto.policyId) {
        try {
          await wallet.addPayoutSigner(PAYOUT_SIGNER_ID, [auto.policyId]);
        } catch (error) {
          // Keep the server honest: no signer means no automatic payouts.
          await data.setAutoPayouts({ enabled: false, payoutAddress }).catch(() => undefined);
          throw error;
        }
      }
      return auto;
    },
    [data, wallet],
  );

  const disable = useCallback(
    async (payoutAddress: Address | null): Promise<AutoPayouts> => {
      const auto = await data.setAutoPayouts({ enabled: false, payoutAddress });
      if (AUTO_PAYOUTS_READY) await wallet.removePayoutSigners().catch(() => undefined);
      return auto;
    },
    [data, wallet],
  );

  return { enable, disable };
}
