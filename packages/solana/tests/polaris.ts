// End-to-end tests of the polaris program on a local validator (`anchor test`).
// The config uses a 3-second instalment interval and 1-second grace so the
// late path and the collections crank can be exercised in real time.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { Polaris } from "../target/types/polaris";

const USD = 1_000_000;
const SKR = 1_000_000;
const INTERVAL = 3;
const GRACE = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const got = e?.error?.errorCode?.code ?? e?.message ?? String(e);
    expect(String(got)).to.contain(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("polaris", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.polaris as Program<Polaris>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const config = pda(Buffer.from("config"));
  const pool = pda(Buffer.from("pool"));
  const rewards = pda(Buffer.from("rewards"));
  const skrVault = pda(Buffer.from("skr_vault"));
  const profileOf = (k: PublicKey) => pda(Buffer.from("profile"), k.toBuffer());
  const merchantOf = (k: PublicKey) => pda(Buffer.from("merchant"), k.toBuffer());
  const planOf = (k: PublicKey, i: number) => {
    const idx = Buffer.alloc(4);
    idx.writeUInt32LE(i);
    return pda(Buffer.from("plan"), k.toBuffer(), idx);
  };

  const buyer = Keypair.generate();
  const shop = Keypair.generate();
  let usdMint: PublicKey;
  let skrMint: PublicKey;
  let buyerUsd: PublicKey;
  let buyerSkr: PublicKey;
  let shopUsd: PublicKey;

  const params = (over: Partial<Record<string, any>> = {}) => ({
    intervalSecs: new BN(INTERVAL),
    graceSecs: new BN(GRACE),
    skrPriceMicros: new BN(50_000), // $0.05 per SKR (stand-in price)
    skrCollateralBps: 5_000,
    checkinReward: new BN(5 * SKR),
    creditPaused: false,
    faucetEnabled: true,
    ...over,
  });

  async function fund(k: PublicKey, sol: number) {
    const sig = await conn.requestAirdrop(k, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }
  const bal = async (a: PublicKey) => Number((await getAccount(conn, a)).amount);
  const profile = () => program.account.profile.fetch(profileOf(buyer.publicKey));

  async function faucet(user: Keypair, mint: PublicKey, amount: number) {
    await program.methods
      .faucet(new BN(amount))
      .accountsPartial({ user: user.publicKey, mint })
      .signers([user])
      .rpc();
  }

  before(async () => {
    await fund(buyer.publicKey, 10);
    await fund(shop.publicKey, 2);
    // Devnet-style stand-in mints: the config PDA is the mint authority.
    usdMint = await createMint(conn, admin, config, null, 6);
    skrMint = await createMint(conn, admin, config, null, 6);
    buyerUsd = getAssociatedTokenAddressSync(usdMint, buyer.publicKey);
    buyerSkr = getAssociatedTokenAddressSync(skrMint, buyer.publicKey);
    shopUsd = getAssociatedTokenAddressSync(usdMint, shop.publicKey);
  });

  it("initializes the config and its three vaults", async () => {
    await program.methods
      .initialize(params())
      .accountsPartial({ admin: admin.publicKey, usdMint, skrMint })
      .rpc();
    const c = await program.account.config.fetch(config);
    expect(c.usdMint.toBase58()).to.eq(usdMint.toBase58());
    expect(c.skrCollateralBps).to.eq(5_000);
    expect((await getAccount(conn, pool)).owner.toBase58()).to.eq(config.toBase58());
  });

  it("only the admin can change parameters", async () => {
    await expectError(
      program.methods
        .setParams(params({ creditPaused: true }))
        .accountsPartial({ admin: buyer.publicKey })
        .signers([buyer])
        .rpc(),
      "ConstraintHasOne",
    );
  });

  it("the faucet mints stand-in dollars and SKR, within its cap", async () => {
    await faucet(buyer, usdMint, 500 * USD);
    await faucet(buyer, skrMint, 1_000 * SKR);
    await faucet(buyer, skrMint, 1_000 * SKR);
    await faucet(buyer, skrMint, 1_000 * SKR);
    await faucet(buyer, skrMint, 1_000 * SKR);
    expect(await bal(buyerUsd)).to.eq(500 * USD);
    expect(await bal(buyerSkr)).to.eq(4_000 * SKR);
    await expectError(faucet(buyer, usdMint, 1_001 * USD), "FaucetCap");
  });

  it("funds the credit pool and the SKR rewards vault", async () => {
    for (let i = 0; i < 3; i++) await faucet(admin, usdMint, 1_000 * USD);
    await faucet(admin, skrMint, 1_000 * SKR);
    const adminUsd = getAssociatedTokenAddressSync(usdMint, admin.publicKey);
    const adminSkr = getAssociatedTokenAddressSync(skrMint, admin.publicKey);
    await program.methods
      .fundPool(new BN(3_000 * USD))
      .accountsPartial({ funder: admin.publicKey, from: adminUsd, vault: pool })
      .rpc();
    await program.methods
      .fundRewards(new BN(1_000 * SKR))
      .accountsPartial({ funder: admin.publicKey, from: adminSkr, vault: rewards })
      .rpc();
    // The pool instruction refuses any other vault.
    await expectError(
      program.methods
        .fundPool(new BN(1))
        .accountsPartial({ funder: admin.publicKey, from: adminSkr, vault: rewards })
        .rpc(),
      "WrongVault",
    );
    expect(await bal(pool)).to.eq(3_000 * USD);
  });

  it("registers a merchant and a buyer profile at 520", async () => {
    await program.methods
      .registerMerchant("Studio Sol")
      .accountsPartial({ authority: shop.publicKey })
      .signers([shop])
      .rpc();
    // the merchant's dollar account (any ATA works; the shop creates its own)
    await faucet(shop, usdMint, 1);
    await program.methods
      .initProfile()
      .accountsPartial({ owner: buyer.publicKey })
      .signers([buyer])
      .rpc();
    const p = await profile();
    expect(p.score).to.eq(520);
    const m = await program.account.merchant.fetch(merchantOf(shop.publicKey));
    expect(m.name).to.eq("Studio Sol");
  });

  it("Pay now moves dollars to the merchant and adds 2 points", async () => {
    await program.methods
      .pay(new BN(25 * USD), Array.from(Buffer.alloc(16, 1)))
      .accountsPartial({
        buyer: buyer.publicKey,
        merchant: merchantOf(shop.publicKey),
        buyerUsd,
        merchantUsd: shopUsd,
      })
      .signers([buyer])
      .rpc();
    expect(await bal(shopUsd)).to.eq(25 * USD + 1);
    expect((await profile()).score).to.eq(522);
  });

  const openPlan = (principal: number, index: number) =>
    program.methods
      .openPlan(new BN(principal), Array.from(Buffer.alloc(16, 2)))
      .accountsPartial({
        buyer: buyer.publicKey,
        merchant: merchantOf(shop.publicKey),
        plan: planOf(buyer.publicKey, index),
        buyerUsd,
        merchantUsd: shopUsd,
      })
      .signers([buyer])
      .rpc();

  it("refuses Pay in 4 above the $50 starter line", async () => {
    await expectError(openPlan(60 * USD, 0), "OverLimit");
  });

  it("locking 4,000 SKR adds $100 to the limit, so a $120 plan opens", async () => {
    await program.methods
      .lockSkr(new BN(4_000 * SKR))
      .accountsPartial({ owner: buyer.publicKey, userSkr: buyerSkr })
      .signers([buyer])
      .rpc();
    expect((await profile()).skrLocked.toNumber()).to.eq(4_000 * SKR);

    const shopBefore = await bal(shopUsd);
    await openPlan(120 * USD, 0);
    const plan = await program.account.plan.fetch(planOf(buyer.publicKey, 0));
    expect(await bal(shopUsd)).to.eq(shopBefore + 120 * USD); // merchant paid in full
    expect(plan.totalOwed.toNumber()).to.be.greaterThan(120 * USD); // + pro-rated interest
    const p = await profile();
    expect(p.activeDebt.toNumber()).to.eq(plan.totalOwed.toNumber());
    // the config PDA is now the delegate for what the buyer owes
    const acct = await getAccount(conn, buyerUsd);
    expect(acct.delegate?.toBase58()).to.eq(config.toBase58());
    expect(Number(acct.delegatedAmount)).to.eq(plan.totalOwed.toNumber());
  });

  it("the SKR that backs the debt cannot be unlocked", async () => {
    await expectError(
      program.methods
        .unlockSkr(new BN(4_000 * SKR))
        .accountsPartial({ owner: buyer.publicKey, userSkr: buyerSkr })
        .signers([buyer])
        .rpc(),
      "CollateralInUse",
    );
  });

  it("the crank cannot collect before an instalment is due", async () => {
    await expectError(
      program.methods
        .collectDue()
        .accountsPartial({
          cranker: admin.publicKey,
          plan: planOf(buyer.publicKey, 0),
          profile: profileOf(buyer.publicKey),
          buyerUsd,
        })
        .rpc(),
      "NotDue",
    );
  });

  it("an early repayment is on time: +12", async () => {
    const before = (await profile()).score;
    await program.methods
      .repayInstallment()
      .accountsPartial({ buyer: buyer.publicKey, plan: planOf(buyer.publicKey, 0), buyerUsd })
      .signers([buyer])
      .rpc();
    const p = await profile();
    expect(p.score).to.eq(before + 12);
    expect(p.onTime).to.eq(1);
  });

  it("the daily check-in pays SKR, adds a point, and only once a day", async () => {
    const skrBefore = await bal(buyerSkr);
    const before = (await profile()).score;
    await program.methods
      .checkIn()
      .accountsPartial({ owner: buyer.publicKey, skrMint })
      .signers([buyer])
      .rpc();
    const p = await profile();
    expect(p.streak).to.eq(1);
    expect(p.score).to.eq(before + 1);
    expect(await bal(buyerSkr)).to.eq(skrBefore + 5 * SKR);
    await expectError(
      program.methods
        .checkIn()
        .accountsPartial({ owner: buyer.publicKey, skrMint })
        .signers([buyer])
        .rpc(),
      "AlreadyCheckedIn",
    );
  });

  it("an instalment can be paid in SKR, which refills the rewards vault", async () => {
    await faucet(buyer, skrMint, 1_000 * SKR);
    const plan = await program.account.plan.fetch(planOf(buyer.publicKey, 0));
    const due = Math.floor(plan.totalOwed.toNumber() / 4);
    const rewardsBefore = await bal(rewards);
    await program.methods
      .repayWithSkr()
      .accountsPartial({ buyer: buyer.publicKey, plan: planOf(buyer.publicKey, 0), userSkr: buyerSkr })
      .signers([buyer])
      .rpc();
    const skrPaid = Math.ceil((due * SKR) / 50_000);
    expect(await bal(rewards)).to.eq(rewardsBefore + skrPaid);
    expect((await program.account.plan.fetch(planOf(buyer.publicKey, 0))).paid).to.eq(2);
  });

  it("the crank collects a late instalment through the delegate: -30", async () => {
    // instalment 3 is due at start + 9s; wait past it and the grace
    const plan = await program.account.plan.fetch(planOf(buyer.publicKey, 0));
    const dueAt = plan.startedAt.toNumber() + INTERVAL * 3 + GRACE;
    while (true) {
      const slot = await conn.getSlot();
      const t = await conn.getBlockTime(slot);
      if (t && t > dueAt + 1) break;
      await sleep(1_000);
    }
    const before = await profile();
    const poolBefore = await bal(pool);
    await program.methods
      .collectDue()
      .accountsPartial({
        cranker: admin.publicKey,
        plan: planOf(buyer.publicKey, 0),
        profile: profileOf(buyer.publicKey),
        buyerUsd,
      })
      .rpc();
    const p = await profile();
    expect(p.score).to.eq(before.score - 30);
    expect(p.late).to.eq(1);
    expect(await bal(pool)).to.be.greaterThan(poolBefore);
  });

  it("the last instalment closes the plan, clears the debt and frees the SKR", async () => {
    await program.methods
      .repayInstallment()
      .accountsPartial({ buyer: buyer.publicKey, plan: planOf(buyer.publicKey, 0), buyerUsd })
      .signers([buyer])
      .rpc();
    const plan = await program.account.plan.fetch(planOf(buyer.publicKey, 0));
    expect(plan.paid).to.eq(4);
    expect(plan.repaid.toNumber()).to.eq(plan.totalOwed.toNumber());
    const p = await profile();
    expect(p.activeDebt.toNumber()).to.eq(0);
    expect(p.plansRepaid).to.eq(1);
    await expectError(
      program.methods
        .repayInstallment()
        .accountsPartial({ buyer: buyer.publicKey, plan: planOf(buyer.publicKey, 0), buyerUsd })
        .signers([buyer])
        .rpc(),
      "PlanClosed",
    );
    await program.methods
      .unlockSkr(new BN(4_000 * SKR))
      .accountsPartial({ owner: buyer.publicKey, userSkr: buyerSkr })
      .signers([buyer])
      .rpc();
    expect((await profile()).skrLocked.toNumber()).to.eq(0);
  });

  it("send by link: the link key pays the claim, the recipient holds no SOL", async () => {
    const linkKey = Keypair.generate();
    const recipient = Keypair.generate(); // never funded
    const ix = await program.methods
      .createLink(new BN(40 * USD), new BN(7 * 86_400))
      .accountsPartial({ sender: buyer.publicKey, linkKey: linkKey.publicKey, usdMint, senderUsd: buyerUsd })
      .instruction();
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: linkKey.publicKey, lamports: 2_100_000 }))
      .add(ix);
    await provider.sendAndConfirm(tx, [buyer]);

    const claim = await program.methods
      .claimLink()
      .accountsPartial({
        linkKey: linkKey.publicKey,
        recipient: recipient.publicKey,
        sender: buyer.publicKey,
        usdMint,
      })
      .transaction();
    claim.feePayer = linkKey.publicKey;
    claim.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    claim.sign(linkKey);
    const sig = await conn.sendRawTransaction(claim.serialize());
    await conn.confirmTransaction(sig, "confirmed");

    const recipientUsd = getAssociatedTokenAddressSync(usdMint, recipient.publicKey);
    expect(await bal(recipientUsd)).to.eq(40 * USD);
    expect(await conn.getBalance(recipient.publicKey)).to.eq(0);
    expect(await conn.getBalance(linkKey.publicKey)).to.eq(0); // the fee top-up's change went back to the sender
    expect(await conn.getAccountInfo(pda(Buffer.from("link"), linkKey.publicKey.toBuffer()))).to.eq(null);
  });

  it("the sender can cancel an unclaimed link", async () => {
    const linkKey = Keypair.generate();
    const before = await bal(buyerUsd);
    await program.methods
      .createLink(new BN(10 * USD), new BN(3_600))
      .accountsPartial({ sender: buyer.publicKey, linkKey: linkKey.publicKey, usdMint, senderUsd: buyerUsd })
      .signers([buyer])
      .rpc();
    expect(await bal(buyerUsd)).to.eq(before - 10 * USD);
    await program.methods
      .cancelLink()
      .accountsPartial({
        sender: buyer.publicKey,
        link: pda(Buffer.from("link"), linkKey.publicKey.toBuffer()),
        senderUsd: buyerUsd,
      })
      .signers([buyer])
      .rpc();
    expect(await bal(buyerUsd)).to.eq(before);
  });

  it("pausing credit blocks new plans; the faucet can be switched off", async () => {
    await program.methods.setParams(params({ creditPaused: true, faucetEnabled: false })).accountsPartial({ admin: admin.publicKey }).rpc();
    await expectError(openPlan(20 * USD, 1), "CreditPaused");
    await expectError(faucet(buyer, usdMint, 1), "FaucetDisabled");
    await program.methods.setParams(params()).accountsPartial({ admin: admin.publicKey }).rpc();
    await openPlan(20 * USD, 1);
    expect((await profile()).plansOpened).to.eq(2);
  });

  it("a stranger cannot repay against someone else's plan account", async () => {
    const stranger = Keypair.generate();
    await fund(stranger.publicKey, 1);
    await faucet(stranger, usdMint, 100 * USD);
    await program.methods.initProfile().accountsPartial({ owner: stranger.publicKey }).signers([stranger]).rpc();
    await expectError(
      program.methods
        .repayInstallment()
        .accountsPartial({
          buyer: stranger.publicKey,
          plan: planOf(buyer.publicKey, 1),
          buyerUsd: getAssociatedTokenAddressSync(usdMint, stranger.publicKey),
        })
        .signers([stranger])
        .rpc(),
      "Constraint",
    );
  });
});
