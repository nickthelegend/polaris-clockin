#!/usr/bin/env node
// The Chainlink scenes of the product, end to end and headless, against a running
// `DEMO_FAST_PLANS=1 pnpm demo:local`:
//
//   PLAYWRIGHT_MODULE=<path to an installed playwright> pnpm demo:e2e:chainlink
//
//  1. An Argentine buyer (browser locale es-AR) makes an account with the dev signer and
//     gets test dollars; the Send form shows the amount in pesos at Chainlink's USD/ARS rate.
//  2. Halcyon -> Pay in 4 -> Raise your limit: the API fires the CRE underwriting workflow
//     (trigger:local runs the real polaris-underwrite handler) and the line opens on chain;
//     the credit screen says "Verified by Chainlink CRE". Pay in 4 opens a plan.
//  3. The buyer's approval to the loan engine is revoked (their own transaction, as a
//     wallet's revoke would), before payment 1 falls due a minute later.
//  4. The owner raises the guardian's depeg threshold above the real price (captioned
//     "threshold raised for demo"); the guardian's next scheduled run (the real
//     polaris-guardian handler, reading Chainlink AUSD/USD on Monad mainnet) pauses new
//     Pay in 4 plans on chain. The shop, the checkout and the dashboard say so; Pay now
//     still goes through. The owner restores the threshold; the next run resumes Pay in 4.
//  5. The collections cron (the real polaris-collections handler) could not take payment 1:
//     the plan asks the buyer to sign again. They sign once; PolarisCheckout.reauthorize
//     emits Reauthorized; the workflow's EVM log trigger collects the payment in seconds.
//  6. The dashboard's Chainlink page: all three workflows and their reports.
//
// Screenshots go to docs/demo/chainlink (OUT to change it), with results.json (every step,
// its evidence and the local transaction hashes). Exits 1 if a step fails.
// Playwright isn't a dependency of the repo: install it anywhere and point PLAYWRIGHT_MODULE
// at it, or run from a folder where `require("playwright")` resolves.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const DEMO_JSON = path.join(REPO, ".demo", "demo.json");
if (!fs.existsSync(DEMO_JSON)) throw new Error("Start `DEMO_FAST_PLANS=1 pnpm demo:local` first: .demo/demo.json is missing.");
const demo = JSON.parse(fs.readFileSync(DEMO_JSON, "utf8"));
if (!demo.fastPlans) throw new Error("This run needs Pay in 4 payments a minute apart: start demo:local with DEMO_FAST_PLANS=1.");
const APP = demo.urls.app;
const SHOP = demo.urls.shop;
const BUSINESS = demo.urls.business;
const POPUP_MS = 180000;
const OUT = process.env.OUT || path.join(REPO, "docs", "demo", "chainlink");
const PROFILE = process.env.PROFILE || path.join(require("os").tmpdir(), `polaris-chainlink-e2e-${Date.now()}`);
const DEMO_MIN_PRICE = process.env.DEMO_MIN_PRICE || "1.001";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { privateKeyToAccount } = require(require.resolve("viem/accounts", { paths: [path.join(REPO, "apps", "business")] }));

const results = [];
const evidence = {};
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function until(what, fn, timeoutMs = 60000, everyMs = 1000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out: ${what}`);
    await sleep(everyMs);
  }
}

async function open({ width = 1440, height = 900, profile = PROFILE, locale = "es-AR", timezoneId = "America/Argentina/Buenos_Aires" } = {}) {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    viewport: { width, height },
    locale,
    timezoneId,
    reducedMotion: "reduce",
  });
  // A first `next dev` compile of a route can take a minute on a slow disk; demo:local warms most of them.
  context.setDefaultNavigationTimeout(180000);
  context.setDefaultTimeout(60000);
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`  [console ${new URL(page.url() || "about:blank").port || "-"}] ${m.text().slice(0, 240)}`);
    });
    page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 240)}`));
  };
  context.on("page", watch);
  for (const p of context.pages()) watch(p);
  return context;
}

/** A caption on the screenshot only (a recording's subtitle), never part of the product's page. */
async function shot(page, name, caption) {
  if (caption) {
    await page
      .evaluate((text) => {
        const el = document.createElement("div");
        el.id = "__demo_caption";
        el.textContent = text;
        // A full-width subtitle bar: along the bottom of a wide page; under the dev-signer badge in a narrow popup
        // (whose sheet keeps its button at the bottom).
        const narrow = window.innerWidth < 700;
        Object.assign(el.style, {
          position: "fixed",
          left: "0",
          right: "0",
          ...(narrow ? { top: "30px" } : { bottom: "0" }),
          zIndex: "2147483647",
          background: "rgba(12,12,14,0.92)",
          color: "#fff",
          font: "600 13.5px/1.4 system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "8px 16px",
          borderTop: narrow ? "none" : "2px solid #c8f24a",
          borderBottom: narrow ? "2px solid #c8f24a" : "none",
          textAlign: "center",
          pointerEvents: "none",
        });
        document.body.appendChild(el);
      }, caption)
      .catch(() => {});
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  if (caption) await page.evaluate(() => document.getElementById("__demo_caption")?.remove()).catch(() => {});
  console.log(`  shot ${name}.png`);
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await sleep(ms);
}

async function buttons(page) {
  return (await page.getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function json(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body.data ?? body;
}

/** A view on one of the local deployment's contracts, through the business app's viem and the package's ABIs. */
async function readChain(contract, functionName, args = []) {
  const viem = await import(require.resolve("viem", { paths: [path.join(REPO, "apps", "business")] }).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  const abis = await import(`file:///${path.join(REPO, "packages", "contracts", "abi", "index.mjs").replace(/\\/g, "/")}`);
  const deployment = JSON.parse(fs.readFileSync(path.join(REPO, ".demo", "deployment.json"), "utf8"));
  const abiName = `${contract[0].toLowerCase()}${contract.slice(1)}Abi`;
  const client = viem.createPublicClient({ transport: viem.http(demo.urls.rpc) });
  return client.readContract({ address: deployment.contracts[contract].address, abi: abis[abiName], functionName, args });
}

/** guardian:local's result for the run that wrote attestation `round` (its status file, .demo/guardian.json). */
function guardianRun(round) {
  try {
    const out = JSON.parse(fs.readFileSync(demo.guardian.status, "utf8"));
    return Number(out.result?.round) === round ? out : null;
  } catch {
    return null;
  }
}

/** A scene step of scripts/demo-chainlink.mjs; its output is the evidence. */
function scene(args, env = {}) {
  const out = execFileSync(process.execPath, [path.join(REPO, "scripts", "demo-chainlink.mjs"), ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 300000,
  });
  for (const line of out.trim().split("\n")) console.log(`  ${line}`);
  return out;
}

async function shopCheckout(context, { product, mode, prefix, caption }) {
  const page = await context.newPage();
  await page.goto(`${SHOP}/products/${product}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.evaluate(() => localStorage.removeItem("halcyon.bag.v1"));
  await page.reload({ waitUntil: "networkidle" });
  await settle(page, 800);
  await shot(page, `${prefix}-shop-product`, caption);
  await page.getByRole("button", { name: /Add to bag/ }).filter({ visible: true }).first().click();
  await sleep(1200);
  await page.goto(`${SHOP}/checkout`, { waitUntil: "networkidle", timeout: 120000 });
  await settle(page, 1000);
  await page.getByText(mode, { exact: true }).first().click();
  await sleep(600);
  await shot(page, `${prefix}-shop-checkout`, caption);
  const main = (await buttons(page)).find((t) => /with Polaris|Pay in 4 ·|Continue to Pay in 4/.test(t));
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: POPUP_MS }), page.getByRole("button", { name: main }).first().click()]);
  await until("the checkout in the popup", async () => popup.url().includes("/pay/"), POPUP_MS, 300);
  await settle(popup, 3000);
  await until("the checkout sheet", async () => (await buttons(popup)).some((t) => /^(Pay now|Pay in 4|Start Pay in 4|Pay \$)/.test(t)), 90000);
  return { page, popup };
}

async function confirmInPopup(popup, name) {
  const dialog = popup.getByRole("dialog").last();
  const confirm = dialog.getByRole("button", { name: /Face ID/ }).first();
  await confirm.waitFor({ timeout: 30000 });
  await sleep(1000);
  if (name) await shot(popup, name);
  await confirm.click();
}

async function orderPaid(page, pattern) {
  await until("the shop's order page", async () => page.url().includes("/orders/"), 90000, 300);
  await until("the order to read as paid", async () => {
    await page.reload({ waitUntil: "networkidle" });
    return (await page.getByText(pattern).count()) > 0;
  }, 120000, 3000);
  await settle(page, 1500);
}

(async () => {
  const buyerCtx = await open();
  const merchantCtx = await open({ profile: `${PROFILE}-merchant`, locale: "en-US", timezoneId: "UTC" });
  const app = buyerCtx.pages()[0] ?? (await buyerCtx.newPage());
  const dash = merchantCtx.pages()[0] ?? (await merchantCtx.newPage());

  // ── 1. The buyer, in Argentina ────────────────────────────────────────
  await app.goto(APP + "/", { waitUntil: "networkidle", timeout: 240000 });
  await settle(app, 2500);
  if (app.url().includes("/onboard")) {
    await app.getByRole("button", { name: "Create account with Face ID" }).click();
    await settle(app, 2500);
  }
  const key = await app.evaluate(() => JSON.parse(localStorage.getItem("polaris.dev-signer.v1") || "null")?.privateKey ?? null);
  const buyer = key ? privateKeyToAccount(key).address : null;
  step("a buyer account (the dev signer standing in for Face ID)", Boolean(buyer), buyer ?? "");
  evidence.buyer = buyer;
  for (let i = 0; i < 2; i++) {
    await app.goto(APP + "/add", { waitUntil: "networkidle", timeout: 120000 });
    await settle(app, 1500);
    await app.getByText("Get $500 test dollars").first().click();
    await sleep(3500);
  }

  // Chainlink FX: the peso line, from the API's live read of Chainlink's USD / ARS feed.
  const fx = await json(`${APP}/api/fx?currency=ARS`).catch((e) => ({ status: "error", error: String(e) }));
  evidence.fx = fx;
  step(
    "FX: /api/fx reads Chainlink's USD / ARS feed",
    fx.status === "ok",
    fx.rate ? `${fx.rate.perUsd} ARS per USD, ${fx.rate.source.pair} on ${fx.rate.source.chain} ${fx.rate.source.address}, round ${fx.rate.source.roundId}` : JSON.stringify(fx),
  );
  await app.goto(APP + "/", { waitUntil: "networkidle" });
  await settle(app, 3000);
  const amount = app.getByLabel("Amount to send, in dollars").first();
  await amount.fill("100");
  await amount.blur();
  const pesoLine = await until("the ARS line under the Send amount", async () => {
    // LocalEquivalent: "≈ ARS 161.241 · Chainlink rate, 3 min ago · indicative", its pieces in nested spans.
    const t = await app.locator('[title^="Indicative only"]').first().innerText();
    return /ARS/.test(t) && /Chainlink rate/.test(t) ? t.replace(/\s+/g, " ") : null;
  }, 30000, 500).catch(() => null);
  await shot(app, "01-fx-send-ars", "An Argentine buyer: the dollar amount in pesos at Chainlink's USD / ARS rate (read server-side, indicative)");
  step("FX: the Send form shows the amount in pesos at the Chainlink rate", Boolean(pesoLine), pesoLine ?? "");
  await amount.fill("");

  // ── 2. Raise the limit through CRE underwriting, then Pay in 4 ────────
  let planId = null;
  {
    const { page, popup } = await shopCheckout(buyerCtx, { product: "halcyon-one", mode: "Pay in 4", prefix: "02-payin4" });
    let labels = await buttons(popup);
    await popup.getByRole("button", { name: labels.find((t) => /^Pay in 4/.test(t)) }).first().click();
    await sleep(1200);
    await until("Raise your limit", async () => (await popup.getByRole("button", { name: /Connect your wallet/ }).count()) > 0, 30000, 500);
    await shot(popup, "03-underwrite-raise-your-limit");
    await popup.getByRole("button", { name: /Connect your wallet/ }).first().click();
    await until("the CRE decision", async () => (await popup.getByText(/Your limit went up|still running/).count()) > 0, 240000, 2000);
    await sleep(800);
    await shot(popup, "04-underwrite-limit-raised", "Chainlink CRE: polaris-underwrite ran (the real handler via the local trigger, fixture evidence) and ScoreManager opened the line on chain");
    const credit = await json(`${BUSINESS}/api/public/credit/${buyer}`);
    evidence.underwriting = { decision: credit.decision?.status, score: credit.decision?.score, limit: credit.onChain?.creditLimit, report: credit.decision?.verified ?? credit.decision?.txHash ?? null };
    step(
      "Underwriting: Raise your limit ran the CRE underwriting workflow and opened a line on chain",
      (await popup.getByText("Your limit went up").count()) > 0 && credit.decision?.status === "applied",
      `score ${credit.decision?.score}, line $${credit.onChain?.creditLimit}, report tx ${credit.decision?.verified?.txHash ?? credit.decision?.txHash ?? "?"}`,
    );
    const done = popup.getByRole("button", { name: "Done" });
    if (await done.count()) await done.last().click();
    await sleep(3000);
    labels = await buttons(popup);
    await shot(popup, "05-payin4-checkout-with-line");
    await popup.getByRole("button", { name: labels.find((t) => /^(Pay in 4|Start Pay in 4)/.test(t)) }).first().click();
    await confirmInPopup(popup, null);
    await until("the popup to close after Pay in 4", async () => popup.isClosed(), 120000, 300).catch(() => false);
    await orderPaid(page, /Thank you|0 of 4 paid|Pay in 4/);
    await shot(page, "06-payin4-shop-order");
    const book = await json(`${BUSINESS}/api/public/buyers/${buyer}`);
    planId = book.plans[0]?.id ?? null;
    evidence.plan = book.plans[0] ? { id: planId, openedTxHash: book.plans[0].openedTxHash, intervalSeconds: book.plans[0].intervalSeconds } : null;
    step("Pay in 4: a plan opened on chain through PolarisCheckout.openPlan", Boolean(planId), planId ? `plan ${planId}, tx ${book.plans[0].openedTxHash}` : "");
    await page.close();
  }

  // ── 3. The approval goes (before payment 1 falls due, a minute on) ─────
  const lost = scene(["lose-approval"], { DEMO_BUYER_KEY: key });
  evidence.loseApproval = (lost.match(/tx (0x[0-9a-f]{64})/) || [])[1] ?? null;
  step("The buyer revoked the loan engine's approval (their own transaction)", Boolean(evidence.loseApproval), evidence.loseApproval ?? "");

  // "Verified by Chainlink CRE" on the credit line.
  await app.goto(APP + "/credit", { waitUntil: "networkidle" });
  await settle(app, 3500);
  const verified = (await app.getByText(/Verified by Chainlink CRE/).count()) > 0;
  await shot(app, "07-credit-verified-by-chainlink-cre");
  step("Credit: the line says Verified by Chainlink CRE, with the report's transaction", verified);

  // ── 4. The guardian pauses Pay in 4 (threshold raised for demo), then resumes it ──
  const raised = scene(["guard", "raise", DEMO_MIN_PRICE]);
  const pausedRound = Number((raised.match(/attested round (\d+)/) || [])[1]);
  // The runner writes its status file once its run ends, and the API caches the guard for 10 s.
  const run = await until("the guardian run's result", () => guardianRun(pausedRound), 60000, 500);
  const guardPaused = await until("the API to read the pause", async () => {
    const g = await json(`${BUSINESS}/api/public/credit-guard`);
    return g.paused ? g : null;
  }, 30000, 1000).catch(() => json(`${BUSINESS}/api/public/credit-guard`));
  evidence.guardianPause = { log: raised.trim().split("\n"), guard: { state: guardPaused.state, reasons: guardPaused.reasons, round: guardPaused.round }, run: run.result };
  const priceText = `${run.result.price.kind === "chainlink" ? "Chainlink" : "mock"} AUSD/USD ${run.result.price.answer}`;
  const caption = `Threshold raised for demo: the owner set the depeg bar to $${DEMO_MIN_PRICE}; the price is real (${priceText}${run.result.price.kind === "chainlink" ? ", Monad mainnet" : ""})`;
  step(
    "Guardian: its next scheduled run paused Pay in 4 on chain (depeg, threshold raised for demo)",
    guardPaused.paused && guardPaused.reasons.includes("depeg") && run.result.status === "written",
    `${priceText} < $${DEMO_MIN_PRICE}; attestation round ${run.result.round}, tx ${run.result.txHash}`,
  );

  await dash.goto(BUSINESS + "/dashboard/chainlink", { waitUntil: "networkidle", timeout: 240000 });
  await settle(dash, 5000);
  await shot(dash, "08-dashboard-chainlink-paused", caption);
  await dash.goto(BUSINESS + "/dashboard", { waitUntil: "networkidle" });
  await settle(dash, 4000);
  await shot(dash, "09-dashboard-overview-guard-banner", caption);

  // The gate itself: what PolarisCheckout.openPlan asks before every new plan.
  const gate = await readChain("PolarisCheckout", "creditPaused");
  evidence.gatePaused = { paused: gate[0], reasons: gate[1] };
  step("On chain: PolarisCheckout.creditPaused() is (true, depeg), so openPlan refuses new plans", gate[0] === true && (Number(gate[1]) & 1) === 1, `creditPaused() = (${gate[0]}, ${gate[1]})`);

  {
    // The shop reads the guard as it serves the page (10 s cache): Pay in 4 marked Paused, Pay now chosen.
    await sleep(11000);
    const { page, popup } = await shopCheckout(buyerCtx, { product: "halcyon-one", mode: "Pay now", prefix: "10-paused", caption });
    const pausedLine = (await page.getByText(/paused by our risk guard/).count()) > 0;
    step("Shop: Pay in 4 says it is paused by the risk guard; Pay now is offered", pausedLine);
    const pay = (await buttons(popup)).find((t) => /^Pay (now|\$\d)/.test(t));
    await popup.getByRole("button", { name: pay }).first().click();
    await confirmInPopup(popup, null);
    await until("the popup to close after paying", async () => popup.isClosed(), 120000, 300).catch(() => false);
    await orderPaid(page, /Thank you|Paid|paid/);
    await shot(page, "11-paused-pay-now-still-works", caption);
    step("Pay now still works while Pay in 4 is paused", true, page.url().replace(SHOP, ""));
    await page.close();
  }
  {
    // A checkout that offers Pay in 4 (the shop's Pay in 4 order, made through its API as its page would):
    // the app shows Pay in 4 paused with the guard's words and opens on Pay now.
    const res = await fetch(`${SHOP}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `chainlink-e2e-${Date.now()}` },
      body: JSON.stringify({
        items: [{ productId: "halcyon-one", optionId: "graphite", quantity: 1 }],
        contact: { email: "lena.hartmann@example.com" },
        address: { name: "Lena Hartmann", line1: "Torstraße 118", city: "Berlin", postalCode: "10119", country: "Germany" },
        payment: { method: "polaris", mode: "later" },
      }),
    });
    const order = await res.json();
    const sessionId = order.checkout?.sessionId;
    const session = sessionId ? await json(`${BUSINESS}/api/public/sessions/${sessionId}?buyer=${buyer}`).catch(() => null) : null;
    const page = await buyerCtx.newPage();
    await page.goto(`${APP}/pay/${sessionId}`, { waitUntil: "networkidle", timeout: POPUP_MS });
    await settle(page, 3000);
    await until("the checkout", async () => (await buttons(page)).some((t) => /^(Pay now|Pay \$)/.test(t)), 90000).catch(() => {});
    // It opens on Pay now; the Pay in 4 tab shows why it is off.
    const tab = page.getByRole("tab", { name: /Pay in 4/i }).first();
    if (await tab.count()) await tab.click();
    await sleep(1200);
    const appPaused = (await page.getByText(/paused by our risk guard/).count()) > 0;
    const disabled = await page.getByRole("button", { name: /Pay in 4 is paused/ }).first().isDisabled().catch(() => false);
    await shot(page, "10-paused-app-checkout", caption);
    step(
      "Checkout: on a session that offers Pay in 4, the app shows it paused with the guard's words, and the API refuses it",
      appPaused && disabled && session?.payIn4?.available === false,
      session ? `payIn4.available=${session.payIn4?.available}, reason ${JSON.stringify(session.payIn4?.reason ?? null)}` : `no session (${res.status})`,
    );
    await page.close();
  }

  const restored = scene(["guard", "restore"]);
  const resumedRound = Number((restored.match(/attested round (\d+)/) || [])[1]);
  const run2 = await until("the guardian run's result", () => guardianRun(resumedRound), 60000, 500);
  const guardOpen = await until("the API to read the resume", async () => {
    const g = await json(`${BUSINESS}/api/public/credit-guard`);
    return g.paused ? null : g;
  }, 30000, 1000).catch(() => json(`${BUSINESS}/api/public/credit-guard`));
  evidence.guardianResume = { log: restored.trim().split("\n"), guard: { state: guardOpen.state, round: guardOpen.round }, run: run2.result };
  step("Guardian: after the owner restored the threshold, the next run resumed Pay in 4", !guardOpen.paused && run2.result.transition === "resumed", `round ${run2.result.round}, tx ${run2.result.txHash}`);
  await dash.goto(BUSINESS + "/dashboard/chainlink", { waitUntil: "networkidle" });
  await settle(dash, 5000);
  await shot(dash, "12-dashboard-chainlink-resumed");
  {
    await sleep(11000);
    const page = await buyerCtx.newPage();
    await page.goto(`${SHOP}/products/halcyon-one`, { waitUntil: "networkidle", timeout: 120000 });
    await settle(page, 1500);
    const stillPaused = (await page.getByText(/paused by our risk guard/).count()) > 0;
    await shot(page, "13-shop-pay-in-4-resumed");
    step("Shop: Pay in 4 is offered again", !stillPaused);
    await page.close();
  }

  // ── 5. Dunned, signs again, collected by the log trigger ──────────────
  const dunned = await until(
    "the plan to ask the buyer to sign again",
    async () => {
      const book = await json(`${BUSINESS}/api/public/buyers/${buyer}`);
      const p = book.plans.find((x) => x.id === planId);
      return p?.needsSignature ? p : null;
    },
    300000,
    5000,
  ).catch(() => null);
  step("Collections: the cron's run could not take payment 1 (lost approval); the plan asks the buyer to sign again", Boolean(dunned), dunned ? `lastFailure ${JSON.stringify(dunned.lastFailure)}` : "");
  await app.goto(APP + "/", { waitUntil: "domcontentloaded" });
  await settle(app, 4000);
  const notice = app.getByRole("link", { name: "Sign again" }).first();
  await notice.waitFor({ timeout: 60000 });
  await shot(app, "14-app-home-sign-again");
  await notice.click();
  const signBtn = app.getByRole("button", { name: "Sign again with Face ID" }).first();
  await signBtn.waitFor({ timeout: 180000 });
  await sleep(1500);
  await shot(app, "15-app-plan-sign-again");
  await signBtn.click();
  await confirmInPopup(app, "16-app-sign-again-confirm");
  const collected = await until(
    "the log-triggered collection",
    async () => {
      const book = await json(`${BUSINESS}/api/public/buyers/${buyer}`);
      const p = book.plans.find((x) => x.id === planId);
      return p?.reauthorized?.collected ? p : null;
    },
    180000,
    1000,
  ).catch(() => null);
  await until("Collected in the app", async () => (await app.getByText(/^Collected$/).count()) > 0, 60000, 1000).catch(() => {});
  await sleep(800);
  await shot(app, "17-app-plan-collected");
  if (collected) {
    const r = collected.reauthorized;
    const seconds = Math.round((Date.parse(r.collected.at) - Date.parse(r.at)) / 1000);
    evidence.instantRetry = { reauthorizeTx: r.txHash, collectionTx: r.collected.txHash, seconds, signedAt: r.at, collectedAt: r.collected.at };
    step("Instant retry: Reauthorized fired the collections workflow's log trigger, and payment 1 was collected", true, `${seconds} s after signing; reauthorize ${r.txHash}, collection ${r.collected.txHash}`);
  } else {
    step("Instant retry: Reauthorized fired the collections workflow's log trigger, and payment 1 was collected", false);
  }
  const collectionsLog = fs.readFileSync(path.join(REPO, ".demo", "logs", "cre-collections.log"), "utf8").split("\n");
  evidence.collectionsLog = collectionsLog.filter((l) => /\[cre collections\] (log trigger: Reauthorized|log |cron written)/.test(l)).slice(-8);
  const logRun = collectionsLog.filter((l) => /\[cre collections\] log written: .* [1-9]\d* collected/.test(l)).slice(-1)[0];
  step("The collections log shows the log-triggered run that collected", Boolean(logRun), logRun ?? "");

  // ── 6. The merchant's Chainlink page ──────────────────────────────────
  await dash.goto(BUSINESS + "/dashboard/chainlink", { waitUntil: "networkidle" });
  await settle(dash, 6000);
  await shot(dash, "18-dashboard-chainlink-workflows");
  await dash.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);
  await shot(dash, "19-dashboard-chainlink-runs");
  step("Dashboard: the Chainlink page lists the collections run that followed the re-sign as an instant retry", (await dash.getByText(/Instant retry/).count()) > 0);

  await buyerCtx.close();
  await merchantCtx.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), guardianPrice: { price: demo.guardian.price, why: demo.guardian.why }, results, evidence }, null, 2));
  console.log(JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), error: String(e), results, evidence }, null, 2));
  process.exit(1);
});
