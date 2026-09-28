#!/usr/bin/env node
// The local end to end, headless, against a running `pnpm demo:local`:
//
//   PLAYWRIGHT_MODULE=<path to an installed playwright> node scripts/demo-e2e.cjs
//
// A buyer account (dev signer) with test dollars from the local faucet; Halcyon's
// bag -> Polaris checkout popup -> Pay now; Halcyon -> popup -> Raise your limit (the
// CRE underwriting workflow, local trigger) -> Pay in 4; both shop orders marked paid
// by Polaris webhooks; the merchant's dashboard showing the payments, the plan and its
// on-chain registration; then split the bill (scripts/demo-e2e-split.cjs: one link, four
// people, shares paid, the split closed; DEMO_E2E_SPLIT=0 skips it). Screenshots go to
// docs/demo (OUT to change it). Exits 1 if a step fails.
// Playwright isn't a dependency of the repo: install it anywhere and point PLAYWRIGHT_MODULE at it,
// or run from a folder where `require("playwright")` resolves.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");

// Where the running `pnpm demo:local` is: its .demo/demo.json (every URL, whatever DEMO_*_PORT
// moved), else APP, SHOP, BUSINESS, RPC and FAUCET, else demo:local's default ports.
const DEMO_JSON = path.join(__dirname, "..", ".demo", "demo.json");
const demo = fs.existsSync(DEMO_JSON) ? JSON.parse(fs.readFileSync(DEMO_JSON, "utf8")) : { urls: {} };
const APP = process.env.APP || demo.urls.app || "http://localhost:3000";
const SHOP = process.env.SHOP || demo.urls.shop || "http://127.0.0.1:3600";
const BUSINESS = process.env.BUSINESS || demo.urls.business || "http://localhost:3100";
const RPC = process.env.RPC || demo.urls.rpc || "http://127.0.0.1:8545";
const FAUCET = process.env.FAUCET || (demo.urls.faucet ? demo.urls.faucet.replace(/\/mint$/, "") : "http://127.0.0.1:3650");
// A first `next dev` compile of the checkout can take a minute or more; demo:local warms it, but be patient.
const POPUP_MS = 180000;
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "demo");
const PROFILE = process.env.PROFILE || path.join(require("os").tmpdir(), `polaris-demo-e2e-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open({ width = 1440, height = 900, profile = PROFILE } = {}) {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    viewport: { width, height },
  });
  context.on("page", (p) => watch(p));
  for (const p of context.pages()) watch(p);
  return context;
}

function watch(page) {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console ${new URL(page.url() || "about:blank").port || "-"}] ${m.text().slice(0, 240)}`);
  });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 240)}`));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  shot ${name}.png`);
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await sleep(ms);
}

async function buttons(page) {
  return (await page.getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}




const results = [];
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

async function shopCheckout(context, { product, mode, prefix }) {
  const page = await context.newPage();
  await page.goto(`${SHOP}/products/${product}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.evaluate(() => localStorage.removeItem("halcyon.bag.v1"));
  await page.reload({ waitUntil: "networkidle" });
  await settle(page, 800);
  await shot(page, `${prefix}-1-shop-product`);
  await page.getByRole("button", { name: /Add to bag/ }).filter({ visible: true }).first().click();
  await sleep(1200);
  await shot(page, `${prefix}-2-shop-bag`);
  await page.goto(`${SHOP}/checkout`, { waitUntil: "networkidle", timeout: 120000 });
  await settle(page, 1000);
  await page.getByText(mode, { exact: true }).first().click();
  await sleep(600);
  await shot(page, `${prefix}-3-shop-checkout`);
  const main = (await buttons(page)).find((t) => /with Polaris|Pay in 4 ·|Continue to Pay in 4/.test(t));
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: POPUP_MS }), page.getByRole("button", { name: main }).first().click()]);
  await until("the checkout in the popup", async () => popup.url().includes("/pay/"), POPUP_MS, 300);
  await settle(popup, 3000);
  await until("the checkout sheet", async () => (await buttons(popup)).some((t) => /^(Pay now|Pay in 4|Start Pay in 4)/.test(t)), 90000);
  step(`${prefix}: the shop opened the Polaris checkout in a popup`, true, popup.url().replace(/\?.*/, ""));
  await shot(popup, `${prefix}-4-app-checkout-popup`);
  return { page, popup };
}

async function confirmInPopup(popup, prefix) {
  const dialog = popup.getByRole("dialog").last();
  const confirm = dialog.getByRole("button", { name: /Face ID/ }).first();
  await confirm.waitFor({ timeout: 30000 });
  await sleep(1200);
  await shot(popup, `${prefix}-app-confirm`);
  await confirm.click();
}

/** The receipt the popup shows before it closes itself (polarispay-sdk leaves it up). */
async function receiptInPopup(popup, name) {
  const seen = await until("the receipt in the popup", async () => !popup.isClosed() && (await popup.getByText(/^(Paid|Done)\.$/).count()) > 0, 60000, 150).catch(() => false);
  if (seen && !popup.isClosed()) await shot(popup, name).catch(() => {});
  return Boolean(seen);
}

(async () => {
  const context = await open();
  let app = context.pages()[0] ?? (await context.newPage());

  // ── The buyer ────────────────────────────────────────────────────────
  await app.goto(APP + "/", { waitUntil: "networkidle", timeout: 240000 });
  await settle(app, 2500);
  if (app.url().includes("/onboard")) {
    await shot(app, "00-app-onboarding");
    await app.getByRole("button", { name: "Create account with Face ID" }).click();
    await settle(app, 2500);
  }
  const buyer = await app.evaluate(async () => {
    const raw = localStorage.getItem("polaris.dev-signer.v1");
    return raw ? JSON.parse(raw).privateKey.slice(0, 6) : null;
  });
  step("buyer account created with the dev signer (kept for the device)", Boolean(buyer));
  await app.goto(APP + "/add", { waitUntil: "networkidle", timeout: 120000 });
  await settle(app, 1500);
  await app.getByText("Get $500 test dollars").first().click();
  await sleep(3500);
  await app.goto(APP + "/add", { waitUntil: "networkidle" });
  await settle(app, 1500);
  await app.getByText("Get $500 test dollars").first().click();
  await sleep(3500);
  await app.goto(APP + "/", { waitUntil: "networkidle" });
  await settle(app, 3000);
  await shot(app, "01-app-home-funded");
  const balanceText = await app.getByText(/\$1,000\.00|\$1000\.00/).count();
  step("the app reads the buyer's balance from the chain ($1,000 test dollars from the faucet)", balanceText > 0);

  // ── Pay now ──────────────────────────────────────────────────────────
  {
    const { page, popup } = await shopCheckout(context, { product: "halcyon-one", mode: "Pay now", prefix: "10-paynow" });
    const pay = (await buttons(popup)).find((t) => /^Pay now/.test(t));
    await popup.getByRole("button", { name: pay }).first().click();
    await confirmInPopup(popup, "10-paynow-5");
    step("Pay now: the popup shows its receipt before closing", await receiptInPopup(popup, "10-paynow-6-app-receipt"));
    const closed = await until("the popup to close after paying", async () => popup.isClosed(), 90000, 300).catch(() => false);
    if (!closed) await shot(popup, "10-paynow-6-popup-still-open");
    step("Pay now: the popup posted its result and closed itself", Boolean(closed));
    await until("the shop's order page", async () => page.url().includes("/orders/"), 60000, 300);
    await until("the order to read as paid", async () => {
      await page.reload({ waitUntil: "networkidle" });
      return (await page.getByText(/Thank you|Paid|paid/).count()) > 0;
    }, 90000, 3000);
    await settle(page, 1500);
    await shot(page, "10-paynow-7-shop-order-paid");
    step("Pay now: the shop's order is paid", true, page.url().replace(SHOP, ""));
    await page.close();
  }

  // ── Pay in 4, with a credit line from the CRE workflow ────────────────
  {
    const { page, popup } = await shopCheckout(context, { product: "halcyon-one", mode: "Pay in 4", prefix: "20-payin4" });
    let labels = await buttons(popup);
    console.log("  pay in 4 popup buttons:", JSON.stringify(labels));
    // A new buyer has no line yet: Pay in 4 opens "Raise your limit" first.
    await popup.getByRole("button", { name: labels.find((t) => /^Pay in 4/.test(t)) }).first().click();
    await sleep(1200);
    if ((await popup.getByRole("button", { name: /Connect your wallet/ }).count()) > 0) {
      await shot(popup, "20-payin4-5-raise-your-limit");
      await popup.getByRole("button", { name: /Connect your wallet/ }).first().click();
      // Face ID (dev signer) for the account's consent: the Confirm sheet may not appear; the stand-in history wallet signs.
      await until("the CRE decision", async () => (await popup.getByText(/Your limit went up|still running/).count()) > 0, 240000, 2000);
      await sleep(800);
      await shot(popup, "20-payin4-6-limit-raised");
      const up = (await popup.getByText("Your limit went up").count()) > 0;
      step("Pay in 4: Bring your history ran the CRE underwriting workflow and opened a line on chain", up);
      const done = popup.getByRole("button", { name: "Done" });
      if (await done.count()) await done.last().click();
      await sleep(3000);
    }
    labels = await buttons(popup);
    const start = labels.find((t) => /^Pay in 4/.test(t));
    await shot(popup, "20-payin4-7-app-checkout-with-line");
    await popup.getByRole("button", { name: start }).first().click();
    await confirmInPopup(popup, "20-payin4-8");
    step("Pay in 4: the popup shows its receipt before closing", await receiptInPopup(popup, "20-payin4-8b-app-receipt"));
    const closed = await until("the popup to close after Pay in 4", async () => popup.isClosed(), 90000, 300).catch(() => false);
    if (!closed) await shot(popup, "20-payin4-9-popup-still-open");
    step("Pay in 4: the popup posted its result and closed itself", Boolean(closed));
    await until("the shop's order page", async () => page.url().includes("/orders/"), 60000, 300);
    await until("the plan order to read as paid", async () => {
      await page.reload({ waitUntil: "networkidle" });
      return (await page.getByText(/Thank you|0 of 4 paid|Pay in 4/).count()) > 0;
    }, 90000, 3000);
    await settle(page, 1500);
    await shot(page, "20-payin4-9-shop-order-plan");
    step("Pay in 4: the shop's order is paid through a Polaris plan", true, page.url().replace(SHOP, ""));
    await page.close();
  }

  // ── A new buyer on a fresh phone: Pay in 4 creates the account and raises the limit in one tap ──
  {
    const phone = await open({ width: 390, height: 844, profile: `${PROFILE}-newbuyer` });
    try {
      const { page, popup } = await shopCheckout(phone, { product: "arc-lamp", mode: "Pay in 4", prefix: "25-newbuyer" });
      const labels = await buttons(popup);
      await popup.getByRole("button", { name: labels.find((t) => /^(Pay in 4|Start Pay in 4)/.test(t)) }).first().click();
      await sleep(1500);
      const faceId = popup.getByRole("button", { name: /Continue with Face ID/ });
      const offered = await until("Continue with Face ID in Raise your limit", async () => (await faceId.count()) > 0, 30000, 500).catch(() => false);
      await shot(popup, "25-newbuyer-5-raise-your-limit");
      step("New buyer: Raise your limit offers Continue with Face ID (no account on this phone yet)", Boolean(offered));
      if (offered) {
        await faceId.first().click();
        const up = await until("the new buyer's CRE decision", async () => (await popup.getByText(/Your limit went up|still running/).count()) > 0, 240000, 2000).catch(() => false);
        await sleep(800);
        await shot(popup, "25-newbuyer-6-limit-raised");
        const alert = popup.getByRole("alert");
        const error = (await alert.count()) ? (await alert.first().innerText()).slice(0, 160) : "";
        step("New buyer: one tap created the account and the CRE workflow opened a line", Boolean(up) && (await popup.getByText("Your limit went up").count()) > 0, error);
      }
      await page.close().catch(() => {});
    } finally {
      await phone.close().catch(() => {});
    }
  }

  // ── Collections: the CRE collections workflow collects a due instalment (DEMO_FAST_PLANS=1) ──
  if (demo.fastPlans) {
    const { privateKeyToAccount } = require(require.resolve("viem/accounts", { paths: [path.join(__dirname, "..", "apps", "business")] }));
    const key = await app.evaluate(() => JSON.parse(localStorage.getItem("polaris.dev-signer.v1") || "null")?.privateKey ?? null);
    const buyerAddress = key ? privateKeyToAccount(key).address : null;
    const paid = buyerAddress
      ? await until("an instalment collected by the CRE collections run", async () => {
          const res = await fetch(`${BUSINESS}/api/public/buyers/${buyerAddress}`);
          const plans = (await res.json()).data?.plans ?? [];
          return plans.some((p) => p.installmentsPaid >= 1) ? plans : null;
        }, 300000, 5000).catch(() => null)
      : null;
    step("Collections: the CRE collections workflow collected the first instalment on chain (a minute after checkout)", Boolean(paid), paid ? `${paid[0].installmentsPaid} of ${paid[0].installments} paid` : "");
  }

  // ── Subscribe: the Coffee Club, monthly, in the Polaris popup ──────────
  {
    const page = await context.newPage();
    await page.goto(`${SHOP}/checkout?subscribe=coffee-club`, { waitUntil: "networkidle", timeout: 240000 });
    await settle(page, 1000);
    await shot(page, "50-subscribe-1-shop-checkout");
    const main = (await buttons(page)).find((t) => /^Subscribe ·/.test(t));
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: POPUP_MS }), page.getByRole("button", { name: main }).first().click()]);
    await until("the checkout in the popup", async () => popup.url().includes("/pay/"), POPUP_MS, 300);
    await settle(popup, 3000);
    await until("the subscribe button", async () => (await buttons(popup)).some((t) => /^Subscribe/.test(t)), 90000);
    await shot(popup, "50-subscribe-2-app-checkout-popup");
    const sub = (await buttons(popup)).find((t) => /^Subscribe/.test(t));
    await popup.getByRole("button", { name: sub }).first().click();
    await confirmInPopup(popup, "50-subscribe-3");
    const closed = await until("the popup to close after subscribing", async () => popup.isClosed(), 90000, 300).catch(() => false);
    step("Subscribe: the popup posted its result and closed itself", Boolean(closed));
    await until("the shop's order page", async () => page.url().includes("/orders/"), 60000, 300);
    await until("the subscription order to read as paid", async () => {
      await page.reload({ waitUntil: "networkidle" });
      return (await page.getByText(/Thank you/).count()) > 0;
    }, 90000, 3000);
    await settle(page, 1500);
    await shot(page, "50-subscribe-4-shop-order");
    step("Subscribe: the Coffee Club order is paid, the first month charged on chain", true, page.url().replace(SHOP, ""));
    await page.close();
  }

  // ── Pay directly with a wallet: polarispay-sdk's pay(), one signature, relayed ──
  {
    const { privateKeyToAccount, generatePrivateKey } = require(require.resolve("viem/accounts", { paths: [require("path").join(__dirname, "..", "apps", "business")] }));
    const wallet = privateKeyToAccount(generatePrivateKey());
    const rpcUrl = RPC;
    const faucet = FAUCET;
    await fetch(`${faucet}/mint`, { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: JSON.stringify({ address: wallet.address }) });
    const page = await context.newPage();
    // A browser wallet: this key signs; everything else is the local node's answer.
    await page.exposeFunction("__polarisDemoWallet", async (method, paramsJson) => {
      const params = JSON.parse(paramsJson || "[]");
      try {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return JSON.stringify({ result: [wallet.address] });
        if (method === "eth_signTypedData_v4") {
          const typed = JSON.parse(params[1]);
          const { EIP712Domain: _unused, ...types } = typed.types;
          return JSON.stringify({ result: await wallet.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message }) });
        }
        if (method === "wallet_switchEthereumChain") return JSON.stringify({ result: null });
        const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = await res.json();
        return JSON.stringify(body.error ? { error: body.error } : { result: body.result });
      } catch (e) {
        return JSON.stringify({ error: { code: -32603, message: String(e) } });
      }
    });
    await page.addInitScript(() => {
      window.ethereum = {
        isMetaMask: true,
        async request({ method, params }) {
          const out = JSON.parse(await window.__polarisDemoWallet(method, JSON.stringify(params || [])));
          if (out.error) {
            const e = new Error(out.error.message);
            e.code = out.error.code;
            throw e;
          }
          return out.result;
        },
        on() {},
        removeListener() {},
      };
    });
    await page.goto(`${SHOP}/products/keys-75`, { waitUntil: "networkidle", timeout: 240000 });
    await page.evaluate(() => localStorage.removeItem("halcyon.bag.v1"));
    await page.reload({ waitUntil: "networkidle" });
    await settle(page, 800);
    await page.getByRole("button", { name: /Add to bag/ }).filter({ visible: true }).first().click();
    await sleep(1200);
    await page.goto(`${SHOP}/checkout`, { waitUntil: "networkidle", timeout: 120000 });
    await settle(page, 1000);
    await page.getByText("Pay directly with a wallet", { exact: true }).first().click();
    await sleep(800);
    await shot(page, "60-wallet-1-shop-checkout");
    const pay = (await buttons(page)).find((t) => /wallet|Pay \$/i.test(t) && !/Built with/.test(t));
    await page.getByRole("button", { name: pay }).first().click();
    await until("the wallet order page", async () => page.url().includes("/orders/"), 120000, 500);
    await until("the wallet order to read as paid", async () => {
      await page.reload({ waitUntil: "networkidle" });
      return (await page.getByText(/Thank you/).count()) > 0;
    }, 90000, 3000);
    await settle(page, 1500);
    await shot(page, "60-wallet-2-shop-order-paid");
    step("Direct wallet payment: one signature, relayed gas-free by Polaris, the order paid by webhook", true, page.url().replace(SHOP, ""));
    await page.close();
  }

  // ── The app afterwards ───────────────────────────────────────────────
  await app.goto(APP + "/", { waitUntil: "networkidle" });
  await settle(app, 4000);
  await shot(app, "30-app-home-after");
  await app.goto(APP + "/credit", { waitUntil: "networkidle" });
  await settle(app, 4000);
  await shot(app, "31-app-credit-line");
  await app.goto(APP + "/plans", { waitUntil: "networkidle" });
  await settle(app, 4000);
  await shot(app, "32-app-pay-in-4-plans");

  // ── The merchant's dashboard ─────────────────────────────────────────
  const dash = await context.newPage();
  await dash.goto(BUSINESS + "/dashboard", { waitUntil: "networkidle", timeout: 240000 });
  await settle(dash, 5000);
  await shot(dash, "40-dashboard-overview");
  const sawPayment = (await dash.getByText(/Halcyon order/).count()) > 0;
  step("the dashboard shows the payments (from the chain sync)", sawPayment);
  await dash.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);
  await shot(dash, "41-dashboard-panels");
  await dash.goto(BUSINESS + "/dashboard/payments", { waitUntil: "networkidle" });
  await settle(dash, 4000);
  await shot(dash, "42-dashboard-payments");
  await dash.goto(BUSINESS + "/dashboard/plans", { waitUntil: "networkidle" });
  await settle(dash, 4000);
  await shot(dash, "43-dashboard-pay-in-4");
  const sawPlan = (await dash.getByText(/Halcyon order/).count()) > 0;
  step("the dashboard shows the Pay in 4 plan", sawPlan);
  await dash.goto(BUSINESS + "/dashboard/settings", { waitUntil: "networkidle" });
  await settle(dash, 3000);
  await shot(dash, "44-dashboard-settings-registered");
  step("the merchant registered on chain through the dashboard's registration API", (await dash.getByText(/Active/).count()) > 0);

  // ── A dashboard payment link: paid, it ends on Done (Home), and stays open for the next buyer ──
  {
    await dash.goto(BUSINESS + "/dashboard/links?new=1", { waitUntil: "networkidle" });
    await settle(dash, 2500);
    // The New link dialog (the page's own Request a payment panel has the same fields).
    const form = dash.getByRole("dialog").last();
    await form.getByLabel("What it's for").fill("Logo work");
    await form.getByLabel("Amount").fill("40.00");
    await shot(dash, "45-dashboard-new-link");
    await form.getByRole("button", { name: "Create link" }).click();
    // Saved: share it from its row (the Share dialog shows the URL and its QR code).
    await dash.getByRole("button", { name: /Share .Logo work/ }).first().click({ timeout: 30000 }).catch(() => {});
    await sleep(1500);
    await shot(dash, "45-dashboard-share-link");
    const url = await until("the new link's URL", async () => {
      const codes = await dash.locator("code").allInnerTexts();
      return codes.find((c) => /\/pay\/pl_/.test(c)) ?? null;
    }, 30000, 500).catch(() => null);
    step("Dashboard: a reusable payment link was created", Boolean(url), url ?? "");
    if (url) {
      const buyerPage = await context.newPage();
      await buyerPage.goto(url, { waitUntil: "networkidle", timeout: POPUP_MS });
      await settle(buyerPage, 3000);
      await shot(buyerPage, "46-link-1-app-checkout");
      // "Pay now" on a phone, "Pay $40" on the desktop checkout.
      const pay = (await buttons(buyerPage)).find((t) => /^Pay (now|\$\d)/.test(t));
      if (pay) {
        await buyerPage.getByRole("button", { name: pay }).first().click();
        await confirmInPopup(buyerPage, "46-link-2");
        await until("the link's receipt", async () => (await buyerPage.getByText(/^Paid\.$/).count()) > 0, 90000, 300);
        await sleep(1200);
        await shot(buyerPage, "46-link-3-app-receipt");
        const done = buyerPage.getByRole("button", { name: "Done" });
        const saysDone = (await done.count()) > 0;
        if (saysDone) await done.last().click();
        await sleep(2500);
        const home = new URL(buyerPage.url()).pathname === "/";
        step("Dashboard link: the receipt says Done and goes Home (no loop back to the paid checkout)", saysDone && home, buyerPage.url().replace(APP, ""));
      } else {
        step("Dashboard link: the receipt says Done and goes Home (no loop back to the paid checkout)", false, `no Pay now in ${JSON.stringify(await buttons(buyerPage))}`);
      }
      // Another visitor opens the same link: a new session, open, not "already paid".
      const second = await open({ width: 390, height: 844, profile: `${PROFILE}-second` });
      try {
        const p2 = second.pages()[0] ?? (await second.newPage());
        await p2.goto(url, { waitUntil: "networkidle", timeout: POPUP_MS });
        await settle(p2, 3000);
        await shot(p2, "46-link-4-next-visitor");
        const paidAlready = (await p2.getByText(/is already paid/).count()) > 0;
        const open2 = (await buttons(p2)).some((t) => /^(Pay now|Pay in 4|Continue)/.test(t));
        step("Dashboard link: the next visitor gets a fresh checkout, not 'already paid'", !paidAlready && open2);
      } finally {
        await second.close().catch(() => {});
      }
      await buyerPage.close().catch(() => {});
    }
  }

  // ── Split the bill: four people, one link (scripts/demo-e2e-split.cjs; `pnpm demo:e2e:split` runs it alone) ──
  if (process.env.DEMO_E2E_SPLIT !== "0") {
    const { runSplit } = require("./demo-e2e-split.cjs");
    const urls = { app: APP, business: BUSINESS, rpc: RPC, stablecoin: demo.contracts?.Stablecoin ?? null };
    await runSplit({ chromium, urls, out: path.join(OUT, "split"), profile: `${PROFILE}-split`, step }).catch((e) =>
      step("Split: the scenario ran to the end", false, String(e?.message ?? e).slice(0, 200)),
    );
  }

  await context.close();
  console.log(JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  console.log(JSON.stringify(results, null, 1));
  process.exit(1);
});
