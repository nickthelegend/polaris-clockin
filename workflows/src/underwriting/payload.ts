/**
 * The HTTP trigger's input: who to underwrite, the account's own consent, and
 * optionally the history wallet they proved they own.
 *
 *   { "user": "0x…", "consent": { "issuedAt": 1790000000, "nonce": "k3J9…", "signature": "0x…" } }
 *   { "user": "0x…", "consent": { … },
 *     "linked": { "wallet": "0x…", "issuedAt": 1790000000, "nonce": "k3J9…", "signature": "0x…" } }
 *
 * `consent` is the account's EIP-191 signature over
 * `underwriteConsentMessage({ account: user, wallet: linked?.wallet ?? null,
 * chainId, issuedAt, nonce })` (./consent.ts, exported as
 * `@polaris/cre-workflows/consent`). It is required: without it anyone who
 * can fire the trigger could fix someone else's opening line.
 *
 * `linked` is the Bring-your-history proof: the wallet's EIP-191 signature
 * over `linkMessage({ account: user, wallet, issuedAt, nonce })`
 * (@polarispay/underwriting). The gateway's `GET /v1/link-message` returns
 * that exact text for the app to have signed.
 */

import { z } from "zod";

const hexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
  .refine((a) => !/^0x0{40}$/.test(a), "must not be the zero address")
  .transform((a) => a as `0x${string}`);

const signedAt = {
  issuedAt: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "nonce must be 8-64 url-safe characters"),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/, "signature must be 65 bytes of hex")
    .transform((s) => s as `0x${string}`),
};

export const underwritingPayloadSchema = z
  .object({
    user: hexAddress,
    consent: z.object(signedAt, {
      required_error: "is required: the account's own signature over underwriteConsentMessage (@polaris/cre-workflows/consent)",
    }).strict(),
    linked: z
      .object({ wallet: hexAddress, ...signedAt })
      .strict()
      .nullish(),
  })
  .strict();

export type UnderwritingPayload = z.infer<typeof underwritingPayloadSchema>;

/** Parse the trigger's JSON bytes. Throws a readable error on anything else. */
export function parseUnderwritingPayload(input: Uint8Array): UnderwritingPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new Error("underwriting payload is not JSON");
  }
  const parsed = underwritingPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`underwriting payload: ${first ? `${first.path.join(".") || "(root)"} ${first.message}` : "invalid"}`);
  }
  return parsed.data;
}
