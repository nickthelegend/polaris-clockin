import { mockLedger } from "./data/mock";

/**
 * Bring your history (plan §5.5): the buyer proves they own a wallet they
 * already use with one signature over WalletConnect, and the `underwrite` CRE
 * workflow scores that wallet with Nansen and Zerion.
 *
 * STUB: waits as long as a review takes and marks the placeholder account as
 * having linked its history. The WalletConnect signature and the API call
 * replace this in a later step.
 */
export async function bringHistory(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1400));
  mockLedger.linkHistory();
}
