// The app's view of the polaris program: PDAs, instruction builders (Anchor's
// coder; signing is the wallet's job), and reads.
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "./polaris.json";
import type { Polaris } from "./polaris-types";
import { MERCHANTS, PROGRAM_ID, RPC_URL, SKR_MINT, USD_MINT } from "../lib/config";

export const connection = new Connection(RPC_URL, "confirmed");

// A read-only provider: Anchor needs a wallet object, but this one never signs.
const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(t: T) => t,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(t: T[]) => t,
};
export const program = new Program<Polaris>(
  { ...(idl as any), address: PROGRAM_ID.toBase58() },
  new AnchorProvider(connection, readOnlyWallet as any, { commitment: "confirmed" }),
);

const seed = (s: string) => Buffer.from(s);
const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const pdas = {
  config: find(seed("config")),
  pool: find(seed("pool")),
  rewards: find(seed("rewards")),
  skrVault: find(seed("skr_vault")),
  profile: (owner: PublicKey) => find(seed("profile"), owner.toBuffer()),
  merchant: (authority: PublicKey) => find(seed("merchant"), authority.toBuffer()),
  plan: (buyer: PublicKey, index: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(index);
    return find(seed("plan"), buyer.toBuffer(), b);
  },
  link: (linkKey: PublicKey) => find(seed("link"), linkKey.toBuffer()),
};
export const usdAta = (owner: PublicKey) => getAssociatedTokenAddressSync(USD_MINT, owner, true);
export const skrAta = (owner: PublicKey) => getAssociatedTokenAddressSync(SKR_MINT, owner, true);

export type Profile = Awaited<ReturnType<typeof program.account.profile.fetch>>;
export type Plan = Awaited<ReturnType<typeof program.account.plan.fetch>> & { address: PublicKey };
export type Merchant = { slug: string; name: string; authority: PublicKey };

export const orderId = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b);
};

// ───────────── instructions ─────────────

export const ix = {
  ensureUsdAta: (payer: PublicKey, owner: PublicKey) =>
    createAssociatedTokenAccountIdempotentInstruction(payer, usdAta(owner), owner, USD_MINT),
  ensureSkrAta: (payer: PublicKey, owner: PublicKey) =>
    createAssociatedTokenAccountIdempotentInstruction(payer, skrAta(owner), owner, SKR_MINT),

  initProfile: (owner: PublicKey) => program.methods.initProfile().accountsPartial({ owner }).instruction(),

  faucet: (user: PublicKey, mint: PublicKey, amount: number) =>
    program.methods.faucet(new BN(amount)).accountsPartial({ user, mint }).instruction(),

  pay: (buyer: PublicKey, merchant: PublicKey, amount: number, order = orderId()) =>
    program.methods
      .pay(new BN(amount), order)
      .accountsPartial({
        buyer,
        merchant: pdas.merchant(merchant),
        buyerUsd: usdAta(buyer),
        merchantUsd: usdAta(merchant),
      })
      .instruction(),

  openPlan: (buyer: PublicKey, merchant: PublicKey, principal: number, index: number, order = orderId()) =>
    program.methods
      .openPlan(new BN(principal), order)
      .accountsPartial({
        buyer,
        merchant: pdas.merchant(merchant),
        plan: pdas.plan(buyer, index),
        buyerUsd: usdAta(buyer),
        merchantUsd: usdAta(merchant),
      })
      .instruction(),

  repay: (buyer: PublicKey, index: number) =>
    program.methods
      .repayInstallment()
      .accountsPartial({ buyer, plan: pdas.plan(buyer, index), buyerUsd: usdAta(buyer) })
      .instruction(),

  repayWithSkr: (buyer: PublicKey, index: number) =>
    program.methods
      .repayWithSkr()
      .accountsPartial({ buyer, plan: pdas.plan(buyer, index), userSkr: skrAta(buyer) })
      .instruction(),

  checkIn: (owner: PublicKey) => program.methods.checkIn().accountsPartial({ owner, skrMint: SKR_MINT }).instruction(),

  lockSkr: (owner: PublicKey, amount: number) =>
    program.methods.lockSkr(new BN(amount)).accountsPartial({ owner, userSkr: skrAta(owner) }).instruction(),

  unlockSkr: (owner: PublicKey, amount: number) =>
    program.methods.unlockSkr(new BN(amount)).accountsPartial({ owner, userSkr: skrAta(owner) }).instruction(),

  createLink: (sender: PublicKey, linkKey: PublicKey, amount: number, expiresInSecs: number) =>
    program.methods
      .createLink(new BN(amount), new BN(expiresInSecs))
      .accountsPartial({ sender, linkKey, usdMint: USD_MINT, senderUsd: usdAta(sender) })
      .instruction(),

  claimLink: (linkKey: PublicKey, recipient: PublicKey, sender: PublicKey) =>
    program.methods
      .claimLink()
      .accountsPartial({ linkKey, recipient, sender, usdMint: USD_MINT })
      .instruction(),

  cancelLink: (sender: PublicKey, linkKey: PublicKey) =>
    program.methods
      .cancelLink()
      .accountsPartial({ sender, link: pdas.link(linkKey), senderUsd: usdAta(sender) })
      .instruction(),

  fundLinkKey: (sender: PublicKey, linkKey: PublicKey, lamports: number) =>
    SystemProgram.transfer({ fromPubkey: sender, toPubkey: linkKey, lamports }),
};

// ───────────── reads ─────────────

export async function tokenBalance(ata: PublicKey): Promise<number> {
  try {
    const b = await connection.getTokenAccountBalance(ata);
    return Number(b.value.amount);
  } catch {
    return 0; // no account yet
  }
}

export async function fetchProfile(owner: PublicKey): Promise<Profile | null> {
  return program.account.profile.fetchNullable(pdas.profile(owner));
}

export async function fetchConfig() {
  return program.account.config.fetch(pdas.config);
}

export async function fetchPlans(buyer: PublicKey): Promise<Plan[]> {
  const all = await program.account.plan.all([{ memcmp: { offset: 8, bytes: buyer.toBase58() } }]);
  return all
    .map((p) => ({ ...p.account, address: p.publicKey }))
    .sort((a, b) => b.index - a.index);
}

export async function fetchLink(linkKey: PublicKey) {
  return program.account.link.fetchNullable(pdas.link(linkKey));
}

export function merchants(): Merchant[] {
  return Object.entries(MERCHANTS).map(([slug, m]) => ({ slug, name: m.name, authority: new PublicKey(m.authority) }));
}
export function merchantName(authority: PublicKey) {
  return merchants().find((m) => m.authority.equals(authority))?.name ?? authority.toBase58().slice(0, 4) + "…";
}

/** Claim a send link: the link key alone signs and pays, so no wallet is needed. */
export async function claimWithLinkKey(linkKey: Keypair, recipient: PublicKey) {
  const link = await fetchLink(linkKey.publicKey);
  if (!link) throw new Error("This link was already claimed or cancelled.");
  const instruction: TransactionInstruction = await ix.claimLink(linkKey.publicKey, recipient, link.sender);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: linkKey.publicKey, blockhash, lastValidBlockHeight }).add(instruction);
  tx.sign(linkKey);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return { sig, amount: link.amount.toNumber(), sender: link.sender };
}
