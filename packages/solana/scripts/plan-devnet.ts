// Fixes every devnet address before the deploy: creates (if missing) the
// git-ignored keypairs the setup script will use for the two mints and the
// demo merchants, and writes deployments/devnet.json with "deployed": false.
// The app can then be built against devnet ahead of the deploy, and
// setup-devnet.ts later creates exactly these accounts.
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const KEYS = path.join(ROOT, "keys");
const PROGRAM_ID = new PublicKey(JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/polaris.json"), "utf8")).address);
const load = (f: string) => {
  const p = path.join(KEYS, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
};
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const MERCHANTS = { "studio-sol": "Studio Sol", "kora-rail": "Kora Rail", "nomada-coffee": "Nomada Coffee", "lumen-audio": "Lumen Audio" };
const out = path.join(ROOT, "deployments/devnet.json");
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
const merchants: any = {};
for (const [slug, name] of Object.entries(MERCHANTS)) {
  const k = load(`devnet-merchant-${slug}.json`);
  merchants[slug] = { name, authority: k.publicKey.toBase58(), pda: pda(Buffer.from("merchant"), k.publicKey.toBuffer()).toBase58() };
}
const rec = {
  deployed: false,
  ...prev,
  network: "devnet",
  programId: PROGRAM_ID.toBase58(),
  config: pda(Buffer.from("config")).toBase58(),
  admin: load("deployer.json").publicKey.toBase58(),
  usdMint: load("devnet-pusd-mint.json").publicKey.toBase58(),
  skrMint: load("devnet-skr-mint.json").publicKey.toBase58(),
  params: prev.params ?? { intervalSecs: 604800, graceSecs: 259200, skrPriceMicros: 50000, skrCollateralBps: 5000, checkinReward: 25000000 },
  merchants,
};
fs.writeFileSync(out, JSON.stringify(rec, null, 2) + "\n");
console.log(rec);
