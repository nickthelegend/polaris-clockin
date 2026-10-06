// Everything the screens show about the signed-in wallet, read from the chain:
// balances, the credit profile, plans, the program config and recent activity.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  connection,
  fetchConfig,
  fetchPlans,
  fetchProfile,
  ix,
  merchantName,
  merchants,
  pdas,
  Plan,
  Profile,
  skrAta,
  tokenBalance,
  usdAta,
} from "../chain/polaris";
import { useWallet } from "../wallet/WalletProvider";
import { creditLimit, STARTING_SCORE, today } from "../lib/credit";
import { PARAMS } from "../lib/config";

export type Activity = {
  sig: string;
  time: number;
  kind: string;
  title: string;
  usdDelta: number;
  skrDelta: number;
  ok: boolean;
};

type Config = Awaited<ReturnType<typeof fetchConfig>>;

type Ctx = {
  loading: boolean;
  error: string | null;
  sol: number;
  usd: number;
  skr: number;
  profile: Profile | null;
  config: Config | null;
  plans: Plan[];
  activity: Activity[];
  score: number;
  limit: number;
  available: number;
  checkedInToday: boolean;
  refresh: () => Promise<void>;
  /** Prepends init_profile (and token accounts) the first time. */
  withSetup: (owner: PublicKey, ixs: TransactionInstruction[]) => Promise<TransactionInstruction[]>;
};

const AccountContext = createContext<Ctx | null>(null);

const LABELS: Record<string, string> = {
  Pay: "Paid now",
  OpenPlan: "Pay in 4",
  RepayInstallment: "Instalment paid",
  RepayWithSkr: "Instalment paid in SKR",
  CollectDue: "Instalment collected",
  CheckIn: "Clocked in",
  LockSkr: "SKR locked",
  UnlockSkr: "SKR unlocked",
  CreateLink: "Sent by link",
  ClaimLink: "Link claimed",
  CancelLink: "Link cancelled",
  Faucet: "Test funds",
  InitProfile: "Joined Polaris",
};

async function loadActivity(owner: PublicKey): Promise<Activity[]> {
  const sigs = await connection.getSignaturesForAddress(owner, { limit: 20 });
  if (!sigs.length) return [];
  const txs = await connection.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  );
  const usdA = usdAta(owner).toBase58();
  const skrA = skrAta(owner).toBase58();
  const out: Activity[] = [];
  txs.forEach((tx, i) => {
    if (!tx) return;
    const logs = tx.meta?.logMessages ?? [];
    const names = logs
      .map((l) => l.match(/Program log: Instruction: (\w+)/)?.[1])
      .filter((n): n is string => !!n && !!LABELS[n]);
    if (!names.length) return;
    const kind = names.find((n) => n !== "InitProfile") ?? names[0];
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const delta = (ata: string) => {
      const idx = keys.indexOf(ata);
      if (idx < 0) return 0;
      const pre = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? "0";
      const post = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? "0";
      return Number(post) - Number(pre);
    };
    let title = LABELS[kind];
    if (kind === "Pay" || kind === "OpenPlan") {
      const m = merchants().find((m) => keys.includes(m.authority.toBase58()));
      const merchantKey = m?.authority.toBase58();
      if (merchantKey) title = `${merchantName(new PublicKey(merchantKey))} · ${kind === "Pay" ? "Paid in full" : "Pay in 4"}`;
    }
    out.push({
      sig: sigs[i].signature,
      time: (tx.blockTime ?? 0) * 1000,
      kind,
      title,
      usdDelta: delta(usdA),
      skrDelta: delta(skrA),
      ok: !tx.meta?.err,
    });
  });
  return out;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const [state, setState] = useState<Omit<Ctx, "refresh" | "withSetup" | "score" | "limit" | "available" | "checkedInToday">>({
    loading: false,
    error: null,
    sol: 0,
    usd: 0,
    skr: 0,
    profile: null,
    config: null,
    plans: [],
    activity: [],
  });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!publicKey || busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, loading: true }));
    try {
      const [sol, usd, skr, profile, config, plans] = await Promise.all([
        connection.getBalance(publicKey),
        tokenBalance(usdAta(publicKey)),
        tokenBalance(skrAta(publicKey)),
        fetchProfile(publicKey),
        fetchConfig(),
        fetchPlans(publicKey).catch(() => [] as Plan[]),
      ]);
      setState((s) => ({ ...s, sol, usd, skr, profile, config, plans, loading: false, error: null }));
      loadActivity(publicKey)
        .then((activity) => setState((s) => ({ ...s, activity })))
        .catch(() => {});
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e?.message ?? String(e) }));
    } finally {
      busy.current = false;
    }
  }, [publicKey]);

  useEffect(() => {
    setState((s) => ({ ...s, profile: null, plans: [], activity: [], usd: 0, skr: 0, sol: 0 }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => st === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const withSetup = useCallback(
    async (owner: PublicKey, ixs: TransactionInstruction[]) => {
      const pre: TransactionInstruction[] = [];
      const exists = state.profile ?? (await fetchProfile(owner));
      if (!exists) pre.push(await ix.initProfile(owner));
      return [...pre, ...ixs];
    },
    [state.profile],
  );

  const value = useMemo<Ctx>(() => {
    const p = state.profile;
    const score = p?.score ?? STARTING_SCORE;
    const price = state.config?.skrPriceMicros.toNumber() ?? PARAMS.skrPriceMicros;
    const bps = state.config?.skrCollateralBps ?? PARAMS.skrCollateralBps;
    const limit = creditLimit(score, p?.skrLocked.toNumber() ?? 0, price, bps);
    const debt = p?.activeDebt.toNumber() ?? 0;
    return {
      ...state,
      score,
      limit,
      available: Math.max(0, limit - debt),
      checkedInToday: !!p && p.lastCheckInDay.toNumber() >= today(),
      refresh,
      withSetup,
    };
  }, [state, refresh, withSetup]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const c = useContext(AccountContext);
  if (!c) throw new Error("useAccount outside AccountProvider");
  return c;
}

export { pdas };
