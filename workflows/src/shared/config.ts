/**
 * Config pieces both workflows share, parsed with zod when the workflow
 * starts (`Runner.newRunner({ configSchema })`), so a wrong or missing value
 * stops the workflow before it reads or writes anything.
 *
 * Addresses come from `packages/contracts/deployments/<network>.json`
 * through `scripts/configure.ts`; nothing here is a placeholder. A target
 * whose contracts are not deployed yet has `null` addresses, which this
 * schema refuses with the command that fills them in.
 */

import { cre } from "@chainlink/cre-sdk";
import { z } from "zod";

const CONFIGURE_HINT =
  "is not set: deploy the contracts, then run `pnpm --filter @polaris/cre-workflows configure <target>`";

/** A 20-byte hex address, not the zero address. */
export const address = (what: string) =>
  z
    .string({ required_error: `${what} ${CONFIGURE_HINT}`, invalid_type_error: `${what} ${CONFIGURE_HINT}` })
    .regex(/^0x[0-9a-fA-F]{40}$/, `${what} must be a 0x-prefixed 20-byte address`)
    .refine((a) => !/^0x0{40}$/.test(a), `${what} is the zero address`)
    .transform((a) => a as `0x${string}`);

/** A CRE chain name with an EVM capability, e.g. `monad-testnet`. */
export const chainSelectorName = z
  .string()
  .refine(
    (name) => name in cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS,
    (name) => ({ message: `unknown CRE chain "${name}"` }),
  );

/** A decimal gas amount as a string, the way CRE's GasConfig takes it. */
const gasAmount = z.string().regex(/^\d+$/, "gas amounts are decimal strings");

/**
 * How a write's gas limit is sized. Monad bills the gas *limit*, not the gas
 * used, so the limit is an estimate plus headroom, never a blanket maximum
 * (plan §5.3). `overhead` covers what the estimate of `onReport` alone does
 * not: the forwarder's own work and the transaction's intrinsic cost.
 */
export const gasSchema = z.object({
  /**
   * Added to an estimate of `onReport` alone before the headroom: the
   * forwarder's own work (its signature checks and routing) and the
   * transaction's intrinsic cost.
   */
  overhead: gasAmount,
  /** Headroom on top, in basis points: 1500 = +15%. */
  headroomBps: z.number().int().min(0).max(10_000),
  /** Never below this. */
  min: gasAmount,
  /** Never above this. CRE's per-transaction cap is 10,000,000. */
  max: gasAmount.refine((v) => BigInt(v) <= 10_000_000n, "CRE caps a write at 10,000,000 gas"),
});
export type GasConfig = z.infer<typeof gasSchema>;

/**
 * An http(s) URL. zod's .url() calls the URL constructor, which the CRE
 * workflow runtime (WASM) does not provide: every URL failed validation there
 * ("Invalid url" for https://mainnet.base.org) while the Bun unit tests, which
 * have URL, passed. A pattern check behaves the same in both.
 */
export const httpUrl = z.string().regex(/^https?:\/\/[^\s/?#:]+(?::\d{1,5})?(?:[/?#]\S*)?$/i, "Invalid url");

/**
 * Where the workflow reports what it did to the Polaris API (dunning,
 * webhooks). Optional: the chain events are the record either way.
 */
export const callbackSchema = z
  .object({
    url: httpUrl,
    /** CRE secret id of the HMAC key both sides share. */
    secretId: z.string().min(1),
  })
  .nullable();
export type CallbackConfig = z.infer<typeof callbackSchema>;
