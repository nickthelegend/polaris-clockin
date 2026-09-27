/**
 * End to end on a local node, against deployments/monad-local.json:
 *
 *   pnpm --filter @polarispay/contracts e2e:local     # starts a node on :8600, deploys, runs this
 *
 * Every buyer, sender and recipient here is a fresh wallet that never holds
 * MON. Everything they do is a signature; a relayer account submits it, as the
 * Privy server wallet does on testnet. The Chainlink DON is played by a
 * signer that delivers reports through the MockKeystoneForwarder, as
 * `cre workflow simulate --broadcast` does through Chainlink's.
 *
 *   1. Underwrite: a CRE underwriting report opens the buyer's credit line
 *   2. Pay now:    ReceiveWithAuthorization -> PolarisCheckout.pay
 *   3. Pay in 4:   PlanIntent + Permit -> PolarisCheckout.openPlan (merchant paid in full)
 *   4. Collect:    a CRE collections report collects instalment 1 when due
 *   5. Pay early:  RepayIntent -> PolarisLoanEngine.repayWithSig closes the plan
 *   6. Subscribe:  SubscribeIntent + Permit -> PolarisCheckout.subscribe
 *   7. Renew:      a CRE collections report charges period 2
 *   8. Send:       ReceiveWithAuthorization + link-key Open -> PolarisSend.send
 *   9. Claim:      link-key Claim -> PolarisSend.claim to a fresh wallet
 *
 * It prints each transaction's gas used against the estimated limit it was
 * sent with, the balances that moved, and checks that no user spent any MON.
 *
 * The plan runs on weekly instalments by default, the terms the pitch quotes
 * ($200 as 4 x $50.38, $1.53 interest), with the clock moved forward a week;
 * E2E_INTERVAL_SECONDS=60 runs it on the demo deployment's one-minute
 * schedule instead.
 */

"use strict";

const hre = require("hardhat");
const { ethers } = hre;
const { Wallet, Signature, hexlify, randomBytes, formatUnits } = require("ethers");

const d = require("../deployments/monad-local.json");
const { TYPES, readDomain } = require("../lib/eip712");
const cre = require("../lib/cre");
const tx = require("../lib/tx");

const USD = (n) => ethers.parseUnits(String(n), 6);
const $ = (v) => `$${Number(formatUnits(v, 6)).toFixed(2)}`;

const rows = [];

async function now() {
  return BigInt((await ethers.provider.getBlock("latest")).timestamp);
}

async function travel(seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

function events(receipt, contract, name) {
  return receipt.logs
    .filter((l) => l.address.toLowerCase() === contract.target.toLowerCase())
    .map((l) => contract.interface.parseLog(l))
    .filter((e) => e && e.name === name);
}

async function record(step, what, receipt) {
  const sent = await ethers.provider.getTransaction(receipt.hash);
  rows.push({ step, what, gasUsed: receipt.gasUsed, gasLimit: sent.gasLimit, tx: receipt.hash });
  console.log(`  ${step}. ${what}  (gas ${receipt.gasUsed} of ${sent.gasLimit})`);
}

async function main() {
  if (d.chainId === 10143) throw new Error("This run time-travels; it is for a local node only.");
  const [cre_don, relayer] = await ethers.getSigners(); // account 0 deployed and is the simulation transmitter
  const at = (name) => ethers.getContractAt(name, d.contracts[name].address);

  const token = await ethers.getContractAt("MockAUSD", d.contracts.Stablecoin.address);
  const checkout = (await at("PolarisCheckout")).connect(relayer);
  const engine = (await at("PolarisLoanEngine")).connect(relayer);
  const payments = await at("PolarisPayments");
  const send = (await at("PolarisSend")).connect(relayer);
  const scores = await at("ScoreManager");
  const collections = await at("CollectionsReceiver");
  const underwriting = await at("UnderwritingReceiver");
  const forwarder = (await at("MockKeystoneForwarder")).connect(cre_don);
  const merchant = d.demo.merchant;

  const tokenDomain = await readDomain(token);
  const checkoutDomain = await readDomain(checkout);

  // Fresh, gasless people.
  const buyer = Wallet.createRandom().connect(ethers.provider);
  const history = Wallet.createRandom(); // the wallet the buyer "brings" for their history
  const studio = Wallet.createRandom().connect(ethers.provider);
  const freelancer = Wallet.createRandom().connect(ethers.provider);
  await tx.send(token.connect(cre_don), "mint", [buyer.address, USD(1_000)]);
  await tx.send(token.connect(cre_don), "mint", [studio.address, USD(500)]);

  console.log(`Polaris end to end on chain ${d.chainId}`);
  console.log(`  buyer      ${buyer.address}`);
  console.log(`  merchant   ${merchant} (${d.demo.merchantName})`);
  console.log(`  relayer    ${relayer.address}`);
  console.log(`  CRE (sim)  ${cre_don.address} via MockKeystoneForwarder ${forwarder.target}\n`);

  const report = async (receiver, body, workflowName) => {
    const raw = cre.encodeRawReport({
      body,
      workflowName,
      workflowOwner: cre_don.address,
      executionId: hexlify(randomBytes(32)),
      timestamp: Number(await now()),
    });
    const receipt = await tx.send(forwarder, "report", [receiver, raw, "0x", []]);
    const [processed] = events(receipt, forwarder, "ReportProcessed");
    if (!processed.args.result) throw new Error(`receiver refused the report: ${await forwarder.lastRevertData()}`);
    return receipt;
  };

  // 1. Underwrite ------------------------------------------------------
  console.log("Credit line");
  const facts = {
    walletAgeDays: 730,
    txCount: 1_200,
    stableBalance: USD(2_500),
    defiTenureDays: 400,
    priorLiquidations: 0,
    relatedWallets: 1,
    exchangeFunded: true,
    observedAt: await now(),
  };
  const uwReceipt = await report(
    underwriting.target,
    cre.encodeUnderwritingReport([{ user: buyer.address, linkedWallet: history.address, facts }]),
    cre.WORKFLOW_NAMES.UNDERWRITING
  );
  await record(1, "CRE underwrite report -> ScoreManager.underwrite", uwReceipt);
  const [applied] = events(uwReceipt, underwriting, "UnderwritingApplied");
  if (!applied) throw new Error("underwriting was refused");
  const limit = await scores.creditLimitOf(buyer.address);
  console.log(`     score ${applied.args.score}, credit line ${$(limit)}\n`);

  // 2. Pay now ---------------------------------------------------------
  console.log("Pay now");
  const payOrder = `order-now-${hexlify(randomBytes(6))}`;
  const payAmount = USD(25);
  let t = await now();
  const payAuth = Signature.from(
    await buyer.signTypedData(tokenDomain, { ReceiveWithAuthorization: TYPES.Stablecoin.ReceiveWithAuthorization }, {
      from: buyer.address,
      to: payments.target,
      value: payAmount,
      validAfter: 0,
      validBefore: t + 1800n,
      nonce: await checkout.orderKeyOf(merchant, payOrder),
    })
  );
  const merchantBefore = await token.balanceOf(merchant);
  const payReceipt = await tx.send(checkout, "pay", [
    buyer.address, merchant, payAmount, payOrder, 0, t + 1800n, payAuth.v, payAuth.r, payAuth.s,
  ]);
  await record(2, `PolarisCheckout.pay ${$(payAmount)}`, payReceipt);
  console.log(`     merchant +${$((await token.balanceOf(merchant)) - merchantBefore)} (0.5% fee to treasury)\n`);

  // 3. Pay in 4 --------------------------------------------------------
  console.log("Pay in 4");
  const principal = USD(200);
  const interval = BigInt(process.env.E2E_INTERVAL_SECONDS || 7 * 24 * 3600);
  const quote = await checkout.quotePlan(buyer.address, principal, 4, interval);
  t = await now();
  const permit = Signature.from(
    await buyer.signTypedData(tokenDomain, { Permit: TYPES.Stablecoin.Permit }, {
      owner: buyer.address,
      spender: engine.target,
      value: quote.permitValue,
      nonce: await token.nonces(buyer.address),
      deadline: t + 1800n,
    })
  );
  const planOrder = `order-plan-${hexlify(randomBytes(6))}`;
  const intent = {
    buyer: buyer.address,
    merchant,
    principal,
    installments: 4,
    interval,
    orderId: planOrder,
    nonce: await checkout.nonces(buyer.address),
    deadline: t + 600n,
  };
  const intentSig = await buyer.signTypedData(checkoutDomain, { PlanIntent: TYPES.PolarisCheckout.PlanIntent }, intent);
  const beforePlan = await token.balanceOf(merchant);
  const planReceipt = await tx.send(checkout, "openPlan", [
    intent,
    intentSig,
    { value: quote.permitValue, deadline: t + 1800n, v: permit.v, r: permit.r, s: permit.s },
  ]);
  await record(3, `PolarisCheckout.openPlan ${$(principal)} in 4`, planReceipt);
  const [opened] = events(planReceipt, checkout, "PlanOpened");
  const loanId = opened.args.loanId;
  console.log(
    `     loan #${loanId}: merchant +${$((await token.balanceOf(merchant)) - beforePlan)} now, ` +
      `buyer owes 4 x ${$(quote.installmentAmount)} (${$(quote.interest)} interest), first due in ${interval}s\n`
  );

  // 4. CRE collects instalment 1 ---------------------------------------
  console.log("Collections (CRE)");
  await travel(interval + 1n);
  const candidates = [{ action: cre.ACTION.COLLECT_INSTALLMENT, id: loanId }];
  const ready = await collections.checkTasks(candidates);
  const due = candidates.filter((_, i) => ready[i]);
  const colReceipt = await report(collections.target, cre.encodeCollectionsReport(due), cre.WORKFLOW_NAMES.COLLECTIONS);
  await record(4, "CRE collections report -> collectInstallment", colReceipt);
  const [collected] = events(colReceipt, collections, "TaskExecuted");
  console.log(`     instalment 1 collected: ${$(collected.args.amount)}, ${(await engine.getLoan(loanId)).installmentsPaid}/4 paid`);
  console.log(`     on time: score ${await scores.scoreOf(buyer.address)}, credit line ${$(await scores.creditLimitOf(buyer.address))}\n`);

  // 5. Pay the rest early ----------------------------------------------
  console.log("Pay early");
  const loan = await engine.getLoan(loanId);
  const outstanding = await engine.outstandingOf(loanId);
  t = await now();
  const repay = {
    loanId,
    amount: outstanding,
    expectedRepaid: loan.totalRepaid,
    nonce: await engine.nonces(buyer.address),
    deadline: t + 600n,
  };
  const repaySig = await buyer.signTypedData(await readDomain(engine), { RepayIntent: TYPES.PolarisLoanEngine.RepayIntent }, repay);
  const repayReceipt = await tx.send(engine, "repayWithSig", [loanId, outstanding, loan.totalRepaid, repay.deadline, repaySig]);
  await record(5, `PolarisLoanEngine.repayWithSig ${$(outstanding)}`, repayReceipt);
  const closed = events(repayReceipt, engine, "LoanFullyRepaid").length === 1;
  console.log(`     plan ${closed ? "paid off" : "STILL OPEN"}; score now ${await scores.scoreOf(buyer.address)}\n`);
  if (!closed) throw new Error("the plan did not close");

  // 6. Subscribe -------------------------------------------------------
  console.log("Subscribe");
  const plan = d.demo.subscriptionPlans[1];
  const price = BigInt(plan.pricePerPeriod);
  t = await now();
  const subPermit = Signature.from(
    await buyer.signTypedData(tokenDomain, { Permit: TYPES.Stablecoin.Permit }, {
      owner: buyer.address,
      spender: payments.target,
      value: price * 12n,
      nonce: await token.nonces(buyer.address),
      deadline: t + 1800n,
    })
  );
  const subIntent = {
    buyer: buyer.address,
    merchant,
    planId: BigInt(plan.planId),
    pricePerPeriod: price,
    periodSeconds: BigInt(plan.periodSeconds),
    orderId: `order-sub-${hexlify(randomBytes(6))}`,
    nonce: await checkout.nonces(buyer.address),
    deadline: t + 600n,
  };
  const subSig = await buyer.signTypedData(checkoutDomain, { SubscribeIntent: TYPES.PolarisCheckout.SubscribeIntent }, subIntent);
  const subReceipt = await tx.send(checkout, "subscribe", [
    subIntent,
    subSig,
    { value: price * 12n, deadline: t + 1800n, v: subPermit.v, r: subPermit.r, s: subPermit.s },
  ]);
  await record(6, `PolarisCheckout.subscribe "${plan.name}" ${$(price)}`, subReceipt);
  const [started] = events(subReceipt, checkout, "SubscriptionStarted");
  const subId = started.args.subId;
  console.log(`     subscription #${subId}, period 1 charged, renews every ${plan.periodSeconds}s\n`);

  // 7. CRE charges period 2 --------------------------------------------
  console.log("Renewal (CRE)");
  await travel(BigInt(plan.periodSeconds) + 1n);
  const renewal = [{ action: cre.ACTION.CHARGE_SUBSCRIPTION, id: subId }];
  if (!(await collections.checkTasks(renewal))[0]) throw new Error("subscription not due");
  const renewReceipt = await report(collections.target, cre.encodeCollectionsReport(renewal), cre.WORKFLOW_NAMES.COLLECTIONS);
  await record(7, "CRE collections report -> chargeDue", renewReceipt);
  console.log(`     periods charged: ${(await payments.getSubscription(subId)).periodsCharged}\n`);

  // 8. Send by link ----------------------------------------------------
  console.log("Send by link");
  const linkKey = Wallet.createRandom();
  const sendAmount = USD(50);
  const sendDomain = await readDomain(send);
  t = await now();
  const expiresAt = t + 7n * 24n * 3600n;
  const sendAuth = Signature.from(
    await studio.signTypedData(tokenDomain, { ReceiveWithAuthorization: TYPES.Stablecoin.ReceiveWithAuthorization }, {
      from: studio.address,
      to: send.target,
      value: sendAmount,
      validAfter: 0,
      validBefore: t + 1800n,
      nonce: await send.sendNonce(linkKey.address, expiresAt),
    })
  );
  const open = Signature.from(
    await linkKey.signTypedData(sendDomain, { Open: TYPES.PolarisSend.Open }, { sender: studio.address, amount: sendAmount, expiresAt })
  );
  const sendReceipt = await tx.send(send, "send", [
    studio.address, linkKey.address, sendAmount, expiresAt, 0, t + 1800n,
    sendAuth.v, sendAuth.r, sendAuth.s, open.v, open.r, open.s,
  ]);
  await record(8, `PolarisSend.send ${$(sendAmount)} as a link`, sendReceipt);
  console.log(`     link https://pay.polarispay.app/claim#k=<throwaway key> (key address ${linkKey.address})\n`);

  // 9. Claim -----------------------------------------------------------
  console.log("Claim");
  t = await now();
  const claim = Signature.from(
    await linkKey.signTypedData(sendDomain, { Claim: TYPES.PolarisSend.Claim }, { to: freelancer.address, deadline: t + 600n })
  );
  const claimReceipt = await tx.send(send, "claim", [linkKey.address, freelancer.address, t + 600n, claim.v, claim.r, claim.s]);
  await record(9, "PolarisSend.claim to a fresh account", claimReceipt);
  console.log(`     freelancer holds ${$(await token.balanceOf(freelancer.address))}\n`);

  // Summary ------------------------------------------------------------
  const gasless = [buyer, studio, freelancer];
  const spent = await Promise.all(gasless.map((w) => ethers.provider.getBalance(w.address)));
  const nonces = await Promise.all(gasless.map((w) => ethers.provider.getTransactionCount(w.address)));
  if (spent.some((b) => b !== 0n) || nonces.some((n) => n !== 0)) {
    throw new Error("a user sent a transaction or held MON");
  }

  console.log("Summary");
  console.log("  step  gas used   gas limit  (estimate + 15%)  what");
  for (const r of rows) {
    console.log(`  ${String(r.step).padEnd(4)}  ${String(r.gasUsed).padStart(9)}  ${String(r.gasLimit).padStart(9)}  ${r.what}`);
  }
  console.log(`\n  buyer      ${$(await token.balanceOf(buyer.address))} AUSD, 0 MON, 0 transactions sent`);
  console.log(`  studio     ${$(await token.balanceOf(studio.address))} AUSD, 0 MON, 0 transactions sent`);
  console.log(`  freelancer ${$(await token.balanceOf(freelancer.address))} AUSD, 0 MON, 0 transactions sent`);
  console.log(`  merchant   ${$(await token.balanceOf(merchant))} AUSD`);
  console.log(`  pool       ${$(await token.balanceOf(engine.target))} AUSD in PolarisLoanEngine`);
  console.log("\nAll nine flows passed. Every user action was a signature; the relayer and the DON paid all gas.");
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exitCode = 1;
});
