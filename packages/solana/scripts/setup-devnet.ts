// One-time, idempotent setup of a polaris deployment (devnet, or a local
// validator for development): the two stand-in mints (mint authority = the
// config PDA), the config, a funded credit pool and rewards vault, and the
// demo merchants. Writes deployments/<network>.json with every address and
// transaction signature.
//
//   SOLANA_URL=https://api.devnet.solana.com npx ts-node --transpile-only scripts/setup-devnet.ts
//   NETWORK=localnet SOLANA_URL=http://127.0.0.1:4270 npx ts-node --transpile-only scripts/setup-devnet.ts
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createMint, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import type { Polaris } from "../target/types/polaris";

const ROOT = path.resolve(__dirname, "..");
const URL = process.env.SOLANA_URL ?? "https://api.devnet.solana.com";
const NETWORK = process.env.NETWORK ?? (URL.includes("devnet") ? "devnet" : "localnet");
const OUT = path.join(ROOT, "deployments", `${NETWORK}.json`);
const KEYS = path.join(ROOT, "keys");
const USD = 1_000_000;
const SKR = 1_000_000;

const MERCHANTS = [
  { slug: "studio-sol", name: "Studio Sol" },
  { slug: "kora-rail", name: "Kora Rail" },
  { slug: "nomada-coffee", name: "Nomada Coffee" },
  { slug: "lumen-audio", name: "Lumen Audio" },
];

function loadOrCreate(file: string): Keypair {
  const p = path.join(KEYS, file);
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  const k = Keypair.generate();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

async function main() {
  const conn = new Connection(URL, "confirmed");
  const admin = loadOrCreate("deployer.json");
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/polaris.json"), "utf8"));
  const program = new Program<Polaris>(idl, provider);
  const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
  const config = pda(Buffer.from("config"));
  const pool = pda(Buffer.from("pool"));
  const rewards = pda(Buffer.from("rewards"));

  const record: any = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  record.network = NETWORK;
  record.programId = program.programId.toBase58();
  record.config = config.toBase58();
  record.admin = admin.publicKey.toBase58();
  record.txs = record.txs ?? {};
  const save = () => fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");
  const log = (k: string, sig: string) => {
    record.txs[k] = sig;
    console.log(`${k}: ${sig}`);
    save();
  };
  console.log(`network ${NETWORK} (${URL}), admin ${admin.publicKey.toBase58()}, program ${record.programId}`);

  // 1. mints (stand-ins on devnet: the config PDA is their mint authority)
  if (!record.usdMint) {
    const m = await createMint(conn, admin, config, null, 6, loadOrCreate(`${NETWORK}-pusd-mint.json`));
    record.usdMint = m.toBase58();
    save();
  }
  if (!record.skrMint) {
    const m = await createMint(conn, admin, config, null, 6, loadOrCreate(`${NETWORK}-skr-mint.json`));
    record.skrMint = m.toBase58();
    save();
  }
  const usdMint = new PublicKey(record.usdMint);
  const skrMint = new PublicKey(record.skrMint);
  console.log(`pUSD ${usdMint.toBase58()}  SKR (devnet stand-in) ${skrMint.toBase58()}`);

  // 2. config
  const params = {
    intervalSecs: new BN(Number(process.env.INTERVAL_SECS ?? 7 * 86_400)),
    graceSecs: new BN(Number(process.env.GRACE_SECS ?? 3 * 86_400)),
    skrPriceMicros: new BN(Number(process.env.SKR_PRICE_MICROS ?? 50_000)), // $0.05, stand-in for an oracle
    skrCollateralBps: 5_000,
    checkinReward: new BN(25 * SKR),
    creditPaused: false,
    faucetEnabled: true,
  };
  if (!(await conn.getAccountInfo(config))) {
    log("initialize", await program.methods.initialize(params).accountsPartial({ admin: admin.publicKey, usdMint, skrMint }).rpc());
  } else {
    const c = await program.account.config.fetch(config);
    if (
      !c.skrPriceMicros.eq(params.skrPriceMicros) ||
      !c.checkinReward.eq(params.checkinReward) ||
      !c.intervalSecs.eq(params.intervalSecs) ||
      !c.graceSecs.eq(params.graceSecs)
    ) {
      log("setParams", await program.methods.setParams(params).accountsPartial({ admin: admin.publicKey }).rpc());
    }
  }
  record.params = {
    intervalSecs: params.intervalSecs.toNumber(),
    graceSecs: params.graceSecs.toNumber(),
    skrPriceMicros: params.skrPriceMicros.toNumber(),
    skrCollateralBps: params.skrCollateralBps,
    checkinReward: params.checkinReward.toNumber(),
  };

  // 3. fund the pool and the rewards vault from the faucet
  const poolBal = Number((await conn.getTokenAccountBalance(pool)).value.amount);
  if (poolBal < 2_000 * USD) {
    for (let i = 0; i < 5; i++) {
      await program.methods.faucet(new BN(1_000 * USD)).accountsPartial({ user: admin.publicKey, mint: usdMint }).rpc();
    }
    log(
      "fundPool",
      await program.methods
        .fundPool(new BN(5_000 * USD))
        .accountsPartial({ funder: admin.publicKey, from: getAssociatedTokenAddressSync(usdMint, admin.publicKey), vault: pool })
        .rpc(),
    );
  }
  const rewardsBal = Number((await conn.getTokenAccountBalance(rewards)).value.amount);
  if (rewardsBal < 5_000 * SKR) {
    for (let i = 0; i < 10; i++) {
      await program.methods.faucet(new BN(1_000 * SKR)).accountsPartial({ user: admin.publicKey, mint: skrMint }).rpc();
    }
    log(
      "fundRewards",
      await program.methods
        .fundRewards(new BN(10_000 * SKR))
        .accountsPartial({ funder: admin.publicKey, from: getAssociatedTokenAddressSync(skrMint, admin.publicKey), vault: rewards })
        .rpc(),
    );
  }

  // 4. demo merchants: own keys (git-ignored), a little SOL, registered, with a pUSD account
  record.merchants = record.merchants ?? {};
  for (const m of MERCHANTS) {
    const k = loadOrCreate(`${NETWORK}-merchant-${m.slug}.json`);
    const merchantPda = pda(Buffer.from("merchant"), k.publicKey.toBuffer());
    if (!(await conn.getAccountInfo(merchantPda))) {
      const fund = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: k.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, getAssociatedTokenAddressSync(usdMint, k.publicKey), k.publicKey, usdMint),
      );
      await provider.sendAndConfirm(fund);
      log(
        `registerMerchant:${m.slug}`,
        await program.methods.registerMerchant(m.name).accountsPartial({ authority: k.publicKey }).signers([k]).rpc(),
      );
    }
    record.merchants[m.slug] = { name: m.name, authority: k.publicKey.toBase58(), pda: merchantPda.toBase58() };
    save();
  }
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
