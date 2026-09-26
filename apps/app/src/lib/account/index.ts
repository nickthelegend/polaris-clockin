import type { Address, LocalAccount } from "viem";
import { env } from "../env";
import { AccountError, toAccountError } from "./errors";
import { meraCreate, meraSignIn } from "./mera";
import { resolveRpId } from "./rp";
import { forgetStoredAccount, loadStoredAccount, STORED_ACCOUNT_KEY, saveStoredAccount, type StoredAccount } from "./storage";

/**
 * The Polaris account: Face ID in, a viem LocalAccount out.
 *
 *   createAccount()  Face ID makes a new passkey; the key is derived from its PRF.
 *   signIn()         Face ID on an existing passkey gives the same account back.
 *   getAccount()     The signed-in account for this session, from memory, or null.
 *   authorize()      What every Confirm calls: a fresh Face ID unless one just happened.
 *   signOut()        Zeroes the key and forgets the session.
 *
 * Browser only. Call the ceremonies from click handlers, never from effects,
 * and start them before awaiting anything else in the handler.
 */

export { AccountError, describeAccountError, toAccountError } from "./errors";
export type { AccountErrorKind } from "./errors";
export { checkAccountSupport, isInAppBrowser, type AccountSupport } from "./support";
export type { StoredAccount } from "./storage";

export type AccountSource = "mera" | "dev";

export type AccountState =
  /** Server render and first client paint: storage not read yet. */
  | { status: "unknown" }
  /** No account on this device. */
  | { status: "none" }
  /** An account lives on this device; Face ID unlocks it. */
  | { status: "locked"; address: Address; source: AccountSource }
  /** Signed in: the key is in memory until sign-out or the tab closes. */
  | { status: "ready"; address: Address; source: AccountSource };

/** True when `NEXT_PUBLIC_DEV_SIGNER=1` was set at build time. */
export const DEV_SIGNER = env.devSigner;

type Session = { account: LocalAccount; source: AccountSource; unlockedAt: number; end: () => void };

let session: Session | null = null;
let inflight: Promise<LocalAccount> | null = null;

/* ── Dev signer, loaded only when the flag is on ─────────────────────────── */

type DevModule = typeof import("./dev-signer");
let devModule: DevModule | null = null;
let devModuleLoading: Promise<DevModule> | null = null;

function loadDevModule(): Promise<DevModule> {
  if (!DEV_SIGNER) return Promise.reject(new Error("The dev signer is disabled"));
  devModuleLoading ??= import("./dev-signer").then((m) => {
    devModule = m;
    emit();
    return m;
  });
  return devModuleLoading;
}

/* ── Store (for useSyncExternalStore) ────────────────────────────────────── */

const listeners = new Set<() => void>();
const UNKNOWN: AccountState = { status: "unknown" };
let snapshot: AccountState = UNKNOWN;
let snapshotReady = false;
let windowListeners = false;

function computeState(): AccountState {
  if (session) return { status: "ready", address: session.account.address, source: session.source };
  if (DEV_SIGNER) {
    if (!devModule) return UNKNOWN;
    const address = devModule.devStoredAddress();
    return address ? { status: "locked", address, source: "dev" } : { status: "none" };
  }
  const stored = loadStoredAccount();
  return stored ? { status: "locked", address: stored.address, source: "mera" } : { status: "none" };
}

function sameState(a: AccountState, b: AccountState): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "locked" || a.status === "ready") {
    const other = b as typeof a;
    return a.address === other.address && a.source === other.source;
  }
  return true;
}

function emit(): void {
  const next = computeState();
  if (!sameState(next, snapshot)) snapshot = next;
  snapshotReady = true;
  for (const listener of listeners) listener();
}

function attachWindowListeners(): void {
  if (windowListeners || typeof window === "undefined") return;
  windowListeners = true;
  // Another tab created or forgot the account.
  window.addEventListener("storage", (event) => {
    if (event.key === STORED_ACCOUNT_KEY || event.key === null) emit();
  });
  // Leaving the page ends the session: the key never outlives the tab.
  window.addEventListener("pagehide", () => endSession());
  window.addEventListener("pageshow", () => emit());
  if (DEV_SIGNER) void loadDevModule();
}

export function subscribe(listener: () => void): () => void {
  attachWindowListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): AccountState {
  if (!snapshotReady && typeof window !== "undefined") {
    snapshot = computeState();
    snapshotReady = snapshot.status !== "unknown";
  }
  return snapshot;
}

export function getServerSnapshot(): AccountState {
  return UNKNOWN;
}

/* ── Sessions ────────────────────────────────────────────────────────────── */

function endSession(): void {
  if (!session) return;
  try {
    session.end();
  } finally {
    session = null;
    emit();
  }
}

function startSession(account: LocalAccount, source: AccountSource, end: () => void): LocalAccount {
  if (session && session.account !== account) session.end();
  session = { account, source, unlockedAt: Date.now(), end };
  emit();
  return account;
}

function once(run: () => Promise<LocalAccount>): Promise<LocalAccount> {
  // A double tap must never start two ceremonies (two creates = two accounts).
  if (inflight) return inflight;
  inflight = run()
    .catch((error: unknown) => {
      throw toAccountError(error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Face ID creates a new account on this device. */
export function createAccount(): Promise<LocalAccount> {
  return once(async () => {
    if (DEV_SIGNER) {
      const dev = await loadDevModule();
      const { account } = await dev.devCreate();
      return startSession(account, "dev", () => undefined);
    }
    const rpId = resolveRpId();
    const opened = await meraCreate(rpId);
    // Saved before anything else runs, so a failed payment never loses the account.
    saveStoredAccount({
      v: 1,
      credentialId: opened.credentialId,
      rpId,
      address: opened.account.address,
      createdAt: Date.now(),
      ...(opened.transports ? { transports: [...opened.transports] } : {}),
    });
    return startSession(opened.account, "mera", opened.end);
  });
}

/**
 * Face ID signs in to the account on this device. `anyAccount` skips the
 * remembered one and lets the system list every Polaris account (use it for
 * "Use a different account", or when the remembered one was deleted).
 */
export function signIn(opts: { anyAccount?: boolean } = {}): Promise<LocalAccount> {
  return once(async () => {
    if (DEV_SIGNER) {
      const dev = await loadDevModule();
      const { account } = await dev.devSignIn();
      return startSession(account, "dev", () => undefined);
    }
    const rpId = resolveRpId();
    const stored = loadStoredAccount();
    const pinned = !opts.anyAccount && stored && stored.rpId === rpId ? stored : null;
    const opened = await meraSignIn(
      rpId,
      pinned
        ? { credentialId: pinned.credentialId, ...(pinned.transports ? { transports: pinned.transports } : {}) }
        : undefined,
    );
    if (!pinned || pinned.credentialId !== opened.credentialId || pinned.address !== opened.account.address) {
      const record: StoredAccount = {
        v: 1,
        credentialId: opened.credentialId,
        rpId,
        address: opened.account.address,
        createdAt: pinned?.createdAt ?? Date.now(),
      };
      saveStoredAccount(record);
    }
    return startSession(opened.account, "mera", opened.end);
  });
}

/** The signed-in account for this session, or null. Never prompts. */
export function getAccount(): LocalAccount | null {
  return session?.account ?? null;
}

/**
 * For Confirm buttons: the account, behind Face ID. Reuses the session only
 * if Face ID ran in the last `withinMs` (so creating an account and paying is
 * one Face ID); otherwise asks again, like Apple Pay does per payment.
 */
export function authorize(withinMs = 60_000): Promise<LocalAccount> {
  if (session && Date.now() - session.unlockedAt <= withinMs) return Promise.resolve(session.account);
  return signIn();
}

/**
 * Ends the session and zeroes the key. `forget` also removes this device's
 * record of the account; Face ID can still find it again via "I already use
 * Polaris".
 */
export function signOut(opts: { forget?: boolean } = {}): void {
  endSession();
  if (opts.forget) {
    if (DEV_SIGNER) devModule?.devForget();
    else forgetStoredAccount();
  }
  emit();
}

/** The device's public account record (Mera path only). */
export function storedAccount(): StoredAccount | null {
  return typeof window === "undefined" || DEV_SIGNER ? null : loadStoredAccount();
}

export function isAccountError(error: unknown): error is AccountError {
  return error instanceof AccountError;
}
