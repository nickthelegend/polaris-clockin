// Two ways to sign:
//  - Mobile Wallet Adapter (Android): Seed Vault on Seeker, or any MWA wallet
//    (Phantom, Solflare, Mock MWA Wallet). The primary path.
//  - A guest wallet: a devnet-only keypair kept in SecureStore, for the iOS
//    simulator (MWA does not exist on iOS) and for trying the app without a
//    devnet wallet. Labelled "Guest wallet (devnet only)" wherever it shows.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { connection } from "../chain/polaris";
import { APP_IDENTITY, CLUSTER, MWA_CHAIN } from "../lib/config";

export type WalletKind = "mwa" | "guest";
type Stored = { kind: WalletKind; address: string; authToken?: string; label?: string };

type Ctx = {
  ready: boolean;
  kind: WalletKind | null;
  publicKey: PublicKey | null;
  walletLabel: string | null;
  mwaAvailable: boolean;
  connectMwa: () => Promise<void>;
  useGuest: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Build, sign and send one transaction; resolves with its confirmed signature. */
  send: (ixs: TransactionInstruction[], extraSigners?: Keypair[]) => Promise<string>;
  requestAirdrop: () => Promise<string>;
};

const WalletContext = createContext<Ctx | null>(null);
const STORE = "polaris.wallet.v1";
const GUEST_SECRET = "polaris.guest.secret.v1";

async function loadGuest(): Promise<Keypair> {
  const existing = await SecureStore.getItemAsync(GUEST_SECRET);
  if (existing) return Keypair.fromSecretKey(bs58.decode(existing));
  const k = Keypair.generate();
  await SecureStore.setItemAsync(GUEST_SECRET, bs58.encode(k.secretKey));
  return k;
}

async function mwaTransact<T>(fn: (wallet: any) => Promise<T>): Promise<T> {
  // Dynamic import: the native module only exists on Android.
  const { transact } = await import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
  return transact(fn);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [guest, setGuest] = useState<Keypair | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(STORE);
        if (raw) {
          const s: Stored = JSON.parse(raw);
          if (s.kind === "guest") setGuest(await loadGuest());
          setStored(s);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (s: Stored | null) => {
    setStored(s);
    if (s) await SecureStore.setItemAsync(STORE, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(STORE);
  }, []);

  const authorize = useCallback(async (wallet: any, authToken?: string) => {
    const auth = await wallet.authorize({ chain: MWA_CHAIN, identity: APP_IDENTITY, auth_token: authToken });
    const address = new PublicKey(Buffer.from(auth.accounts[0].address, "base64")).toBase58();
    return { address, authToken: auth.auth_token as string, label: auth.accounts[0].label as string | undefined };
  }, []);

  const connectMwa = useCallback(async () => {
    if (Platform.OS !== "android") throw new Error("Mobile Wallet Adapter needs Android.");
    const r = await mwaTransact((w) => authorize(w));
    await persist({ kind: "mwa", ...r });
  }, [authorize, persist]);

  const useGuest = useCallback(async () => {
    const k = await loadGuest();
    setGuest(k);
    await persist({ kind: "guest", address: k.publicKey.toBase58() });
  }, [persist]);

  const disconnect = useCallback(async () => {
    if (stored?.kind === "mwa" && stored.authToken) {
      mwaTransact((w) => w.deauthorize({ auth_token: stored.authToken })).catch(() => {});
    }
    await persist(null);
  }, [stored, persist]);

  const send = useCallback(
    async (ixs: TransactionInstruction[], extraSigners: Keypair[] = []) => {
      if (!stored) throw new Error("Connect a wallet first.");
      const payer = new PublicKey(stored.address);
      const {
        context: { slot: minContextSlot },
        value: { blockhash, lastValidBlockHeight },
      } = await connection.getLatestBlockhashAndContext();
      const tx = new VersionedTransaction(
        new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(),
      );
      if (extraSigners.length) tx.sign(extraSigners);

      let signature: string;
      if (stored.kind === "guest") {
        const k = guest ?? (await loadGuest());
        tx.sign([k]);
        signature = await connection.sendTransaction(tx, { maxRetries: 5 });
      } else {
        signature = await mwaTransact(async (w) => {
          const r = await authorize(w, stored.authToken);
          if (r.authToken !== stored.authToken) await persist({ ...stored, authToken: r.authToken });
          const [sig] = await w.signAndSendTransactions({ transactions: [tx], minContextSlot });
          return sig as string;
        });
      }
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return signature;
    },
    [stored, guest, authorize, persist],
  );

  const requestAirdrop = useCallback(async () => {
    if (!stored) throw new Error("Connect a wallet first.");
    const amount = CLUSTER === "localnet" ? 5 : 1;
    const sig = await connection.requestAirdrop(new PublicKey(stored.address), amount * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }, [stored]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      kind: stored?.kind ?? null,
      publicKey: stored ? new PublicKey(stored.address) : null,
      walletLabel: stored ? (stored.kind === "guest" ? "Guest wallet (devnet only)" : stored.label ?? "Mobile wallet") : null,
      mwaAvailable: Platform.OS === "android",
      connectMwa,
      useGuest,
      disconnect,
      send,
      requestAirdrop,
    }),
    [ready, stored, connectMwa, useGuest, disconnect, send, requestAirdrop],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const c = useContext(WalletContext);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

/** Plain-language message for a failed transaction or wallet action. */
export function explainError(e: any): string {
  const msg: string = e?.message ?? String(e);
  const logs: string[] = e?.logs ?? [];
  const anchorMsg = [msg, ...logs].join("\n").match(/Error Message: ([^.\n]+)/);
  if (anchorMsg) return anchorMsg[1];
  if (/no wallet|ActivityNotFound|not found.*wallet|ERROR_WALLET_NOT_FOUND/i.test(msg))
    return "No Solana wallet app found on this phone. Install one (Phantom, Solflare) or use the guest wallet.";
  if (/declined|rejected|CancellationException|cancel/i.test(msg)) return "You cancelled in the wallet.";
  if (/insufficient lamports|0x1\b|debit an account but found no record/i.test(msg))
    return "Not enough devnet SOL for the network fee. Add some on Me → Get devnet SOL.";
  if (/429|airdrop/i.test(msg)) return "The devnet faucet is rate-limited right now. Try faucet.solana.com.";
  return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
}
