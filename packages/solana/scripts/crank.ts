// The collections keeper: finds every open plan with an instalment due and
// calls the permissionless `collect_due`, which pulls it through the buyer's
// delegate approval. Anyone can run it; it pays only network fees.
//   SOLANA_URL=https://api.devnet.solana.com npx ts-node --transpile-only scripts/crank.ts [--loop 60]
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import type { Polaris } from "../target/types/polaris";

const ROOT = path.resolve(__dirname, "..");
const URL = process.env.SOLANA_URL ?? "https://api.devnet.solana.com";
const KEY = process.env.CRANK_KEYPAIR ?? path.join(ROOT, "keys/deployer.json");

async function once(program: Program<Polaris>, usdMint: PublicKey, cranker: PublicKey) {
  const now = Math.floor(Date.now() / 1000);
  const plans = await program.account.plan.all();
  let collected = 0;
  for (const { publicKey, account: p } of plans) {
    if (p.paid >= p.installments) continue;
    const due = p.startedAt.toNumber() + p.intervalSecs.toNumber() * (p.paid + 1);
    if (now < due) continue;
    try {
      const sig = await program.methods
        .collectDue()
        .accountsPartial({
          cranker,
          plan: publicKey,
          profile: PublicKey.findProgramAddressSync([Buffer.from("profile"), p.buyer.toBuffer()], program.programId)[0],
          buyerUsd: getAssociatedTokenAddressSync(usdMint, p.buyer),
        })
        .rpc();
      collected++;
      console.log(`collected plan ${publicKey.toBase58()} #${p.paid + 1}: ${sig}`);
    } catch (e: any) {
      console.log(`skip ${publicKey.toBase58()}: ${e?.error?.errorMessage ?? e?.message ?? e}`);
    }
  }
  console.log(`${new Date().toISOString()} checked ${plans.length} plans, collected ${collected}`);
}

async function main() {
  const conn = new Connection(URL, "confirmed");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, "utf8"))));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/polaris.json"), "utf8"));
  const program = new Program<Polaris>(idl, provider);
  const config = await program.account.config.fetch(PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0]);
  const loop = process.argv.indexOf("--loop");
  do {
    await once(program, config.usdMint, kp.publicKey);
    if (loop < 0) break;
    await new Promise((r) => setTimeout(r, Number(process.argv[loop + 1] ?? 60) * 1000));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
