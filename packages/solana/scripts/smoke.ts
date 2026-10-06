// End-to-end smoke test against a deployed polaris (devnet or the local
// validator), the same instructions the app sends: a fresh buyer gets test
// funds, clocks in, pays now, locks SKR, opens Pay in 4, repays in pUSD and
// in SKR, sends a link and claims it from a wallet with no SOL. Writes every
// signature to deployments/<network>-smoke.json.
//   SOLANA_URL=https://api.devnet.solana.com npx ts-node --transpile-only scripts/smoke.ts
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import type { Polaris } from "../target/types/polaris";

const ROOT = path.resolve(__dirname, "..");
const URL = process.env.SOLANA_URL ?? "https://api.devnet.solana.com";
const NETWORK = process.env.NETWORK ?? (URL.includes("devnet") ? "devnet" : "localnet");
const ONE = 1_000_000;

async function main() {
  const conn = new Connection(URL, "confirmed");
  const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `deployments/${NETWORK}.json`), "utf8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, "keys/deployer.json"), "utf8"))));
  const buyer = Keypair.generate();
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(buyer), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/polaris.json"), "utf8"));
  const program = new Program<Polaris>(idl, provider);
  const usdMint = new PublicKey(dep.usdMint);
  const skrMint = new PublicKey(dep.skrMint);
  const merchant = new PublicKey(dep.merchants["studio-sol"].authority);
  const buyerUsd = getAssociatedTokenAddressSync(usdMint, buyer.publicKey);
  const buyerSkr = getAssociatedTokenAddressSync(skrMint, buyer.publicKey);
  const out: Record<string, string> = {};
  const step = (k: string, sig: string) => {
    out[k] = sig;
    console.log(`${k.padEnd(14)} ${sig}`);
  };

  // gas for the throwaway buyer comes from the deployer
  const fund = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: buyer.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
  );
  step("fundBuyer", await anchor.web3.sendAndConfirmTransaction(conn, fund, [admin]));

  step("initProfile", await program.methods.initProfile().accountsPartial({ owner: buyer.publicKey }).rpc());
  step("faucetUsd", await program.methods.faucet(new BN(300 * ONE)).accountsPartial({ user: buyer.publicKey, mint: usdMint }).rpc());
  step("faucetSkr", await program.methods.faucet(new BN(1_000 * ONE)).accountsPartial({ user: buyer.publicKey, mint: skrMint }).rpc());
  step("checkIn", await program.methods.checkIn().accountsPartial({ owner: buyer.publicKey, skrMint }).rpc());
  step(
    "payNow",
    await program.methods
      .pay(new BN(12 * ONE), Array(16).fill(7))
      .accountsPartial({ buyer: buyer.publicKey, merchant: PublicKey.findProgramAddressSync([Buffer.from("merchant"), merchant.toBuffer()], program.programId)[0], buyerUsd, merchantUsd: getAssociatedTokenAddressSync(usdMint, merchant) })
      .rpc(),
  );
  step("lockSkr", await program.methods.lockSkr(new BN(1_000 * ONE)).accountsPartial({ owner: buyer.publicKey, userSkr: buyerSkr }).rpc());
  const idx = Buffer.alloc(4);
  const plan = PublicKey.findProgramAddressSync([Buffer.from("plan"), buyer.publicKey.toBuffer(), idx], program.programId)[0];
  step(
    "openPlan",
    await program.methods
      .openPlan(new BN(60 * ONE), Array(16).fill(9))
      .accountsPartial({
        buyer: buyer.publicKey,
        merchant: PublicKey.findProgramAddressSync([Buffer.from("merchant"), merchant.toBuffer()], program.programId)[0],
        plan,
        buyerUsd,
        merchantUsd: getAssociatedTokenAddressSync(usdMint, merchant),
      })
      .rpc(),
  );
  step("repay", await program.methods.repayInstallment().accountsPartial({ buyer: buyer.publicKey, plan, buyerUsd }).rpc());
  await program.methods.faucet(new BN(1_000 * ONE)).accountsPartial({ user: buyer.publicKey, mint: skrMint }).rpc();
  step("repayWithSkr", await program.methods.repayWithSkr().accountsPartial({ buyer: buyer.publicKey, plan, userSkr: buyerSkr }).rpc());

  const linkKey = Keypair.generate();
  const createIx = await program.methods
    .createLink(new BN(20 * ONE), new BN(86_400))
    .accountsPartial({ sender: buyer.publicKey, linkKey: linkKey.publicKey, usdMint, senderUsd: buyerUsd })
    .instruction();
  step(
    "createLink",
    await provider.sendAndConfirm(
      new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: linkKey.publicKey, lamports: 2_100_000 })).add(createIx),
    ),
  );
  const recipient = Keypair.generate();
  const claim = await program.methods
    .claimLink()
    .accountsPartial({ linkKey: linkKey.publicKey, recipient: recipient.publicKey, sender: buyer.publicKey, usdMint })
    .transaction();
  claim.feePayer = linkKey.publicKey;
  claim.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  claim.sign(linkKey);
  const claimSig = await conn.sendRawTransaction(claim.serialize());
  await conn.confirmTransaction(claimSig, "confirmed");
  step("claimLink", claimSig);

  const p = await program.account.profile.fetch(PublicKey.findProgramAddressSync([Buffer.from("profile"), buyer.publicKey.toBuffer()], program.programId)[0]);
  const recBal = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(usdMint, recipient.publicKey));
  const summary = {
    buyer: buyer.publicKey.toBase58(),
    score: p.score,
    streak: p.streak,
    onTime: p.onTime,
    activeDebt: p.activeDebt.toNumber(),
    skrLocked: p.skrLocked.toNumber(),
    recipientUsd: recBal.value.uiAmountString,
    recipientSol: await conn.getBalance(recipient.publicKey),
  };
  console.log(summary);
  if (summary.score !== 520 + 1 + 2 + 12 * 2 - 0 || summary.recipientUsd !== "20" || summary.recipientSol !== 0) {
    throw new Error(`unexpected end state: ${JSON.stringify(summary)}`);
  }
  fs.writeFileSync(
    path.join(ROOT, `deployments/${NETWORK}-smoke.json`),
    JSON.stringify({ ranAt: new Date().toISOString(), url: URL.includes("127.0.0.1") ? "localnet" : URL, summary, txs: out }, null, 2) + "\n",
  );
  console.log("smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
