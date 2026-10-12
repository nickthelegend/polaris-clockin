import { useCallback, useState } from "react";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { explainError, useWallet, type SubmissionObserver } from "../wallet/WalletProvider";
import { useAccount } from "./AccountProvider";
import { useToast } from "../ui/Toast";

/** Send one transaction for a user action: profile setup, toast, refresh. */
export function useAction() {
  const { publicKey, send } = useWallet();
  const { withSetup, refresh } = useAccount();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (
      id: string,
      build: () => Promise<TransactionInstruction[]>,
      okText: string,
      opts: { signers?: Keypair[]; quiet?: boolean } & SubmissionObserver = {},
    ): Promise<string | null> => {
      if (!publicKey) { await opts.onNoBroadcast?.(); return null; }
      setBusy(id);
      let sendInvoked = false;
      try {
        const ixs = await withSetup(publicKey, await build());
        sendInvoked = true;
        const sig = await send(ixs, opts.signers, opts);
        if (!opts.quiet) toast({ kind: "ok", text: okText, sig });
        refresh();
        return sig;
      } catch (e) {
        if (!sendInvoked) await opts.onNoBroadcast?.();
        console.warn(id, e);
        toast({ kind: "error", text: explainError(e) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [publicKey, send, withSetup, refresh, toast],
  );
  return { run, busy };
}
