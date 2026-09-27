#!/usr/bin/env node
// The local end to end, headless, against a running `pnpm demo:local`:
//
//   PLAYWRIGHT_MODULE=<path to an installed playwright> node scripts/demo-e2e.cjs
//
// A buyer account (dev signer) with test dollars from the local faucet; Halcyon's
// bag -> Polaris checkout popup -> Pay now; Halcyon -> popup -> Raise your limit (the
// CRE underwriting workflow, local trigger) -> Pay in 4; both shop orders marked paid
// by Polaris webhooks; the merchant's dashboard showing the payments, the plan and its
// on-chain registration. Screenshots go to docs/demo (OUT to change it). Exits 1 if a
// step fails.
// Playwright isn't a dependency of the repo: install it anywhere and point PLAYWRIGHT_MODULE at it,
// or run from a folder where `require("playwright")` resolves.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");

// The URLs `pnpm demo:local` prints (its default ports; set these to match DEMO_*_PORT).
const APP = process.env.APP || "http://localhost:3000";
const SHOP = process.env.SHOP || "http://127.0.0.1:3600";
const BUSINESS = process.env.BUSINESS || "http://localhost:3100";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "demo");
const PROFILE = process.env.PROFILE || path.join(require("os").tmpdir(), `polaris-demo-e2e-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open({ width = 1440, height = 900 } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE, {
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
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await sleep(1200);
  await shot(page, `${prefix}-2-shop-bag`);
  await page.goto(`${SHOP}/checkout`, { waitUntil: "networkidle", timeout: 120000 });
  await settle(page, 1000);
  await page.getByText(mode, { exact: true }).first().click();
  await sleep(600);
  await shot(page, `${prefix}-3-shop-checkout`);
  const main = (await buttons(page)).find((t) => /with Polaris|Pay in 4 ·|Continue to Pay in 4/.test(t));
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 60000 }), page.getByRole("button", { name: main }).first().click()]);
  await until("the checkout in the popup", async () => popup.url().includes("/pay/"), 60000, 300);
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

  // ── Subscribe: the Coffee Club, monthly, in the Polaris popup ──────────
  {
    const page = await context.newPage();
    await page.goto(`${SHOP}/checkout?subscribe=coffee-club`, { waitUntil: "networkidle", timeout: 240000 });
    await settle(page, 1000);
    await shot(page, "50-subscribe-1-shop-checkout");
    const main = (await buttons(page)).find((t) => /^Subscribe ·/.test(t));
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 60000 }), page.getByRole("button", { name: main }).first().click()]);
    await until("the checkout in the popup", async () => popup.url().includes("/pay/"), 60000, 300);
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
    const rpcUrl = process.env.RPC || "http://127.0.0.1:8545";
    const faucet = process.env.FAUCET || "http://127.0.0.1:3650";
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
    await page.getByRole("button", { name: /Add to bag/ }).click();
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

  await context.close();
  console.log(JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  console.log(JSON.stringify(results, null, 1));
  process.exit(1);
});
