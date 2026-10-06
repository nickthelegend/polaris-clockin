# Polaris: pitch outline (9 slides)

Render to Google Slides or a PDF (under 20 MB, at most 40 pages). Put the
content on the slides themselves; the portal does not read speaker notes.
Visual language: near-black canvas `#0f1011`, lime `#9cef5e` for money you
hold, purple `#8e5cf0` for credit, Satoshi. Screenshots are in
`clockin/screens/`.

---

### 1. Polaris
**Pay now, or in four. Grow your credit line every day.**
A Solana Mobile app with Pay in 4 built in, an on-chain credit score, and SKR
that does real work.
*Visual:* Home screen (lime dollar card + Clock-in card).

> Notes: One sentence: Polaris is buy-now-pay-later that lives in your
> wallet, where the credit line is a public, on-chain record you build
> yourself.

### 2. The problem
- Crypto checkout is "pay the full price, now". There's no credit, and there's
  no reason to open a payments app unless you're paying.
- Credit apps are black boxes: you can't see why your limit is what it is or
  what would raise it.
- Seeker owners hold SKR but have little to do with it beyond staking.

### 3. Polaris in one screen
- **Pay now** or **Pay in 4** (four weekly payments, 10% APR pro-rated,
  nothing due today); the shop is paid in full up front from a credit pool.
- **Score on chain**: start at 520; +12 per on-time instalment, −30 late,
  +1 per daily clock-in. The score sets the line: $50 → $1,000.
- **Send by link**: the recipient needs no SOL to claim.
*Visual:* Checkout (Pay in 4 schedule) next to Credit (score card).

### 4. Why you come back every day
- **Clock in**: one tap a day; streak multiplies the SKR reward up to 7×.
- Each clock-in is a score point, so the habit literally raises your limit.
- Reminders for the clock-in at 9:00 and the day before each instalment.
- The Coach tells you the shortest path to your next tier.
*Visual:* streak ring + week strip; a notification.

### 5. SKR that does real work
- **Earn** it by clocking in (from a rewards vault).
- **Lock** it as collateral: half its value is added to your Pay in 4 limit;
  the program refuses to unlock SKR that backs what you owe.
- **Spend** it: pay any instalment in SKR, which refills the rewards vault
  that pays tomorrow's check-ins, so spending and earning form one loop.
*Visual:* SKR sheet (locked → limit up). Footnote: devnet uses a labelled
stand-in mint; price is admin-set on devnet, an oracle feed on mainnet.

### 6. Built for Seeker
- Mobile Wallet Adapter: Seed Vault signs every action; cached authorization
  means a daily open costs no wallet prompt until you transact.
- Read-only Seeker Genesis Token check shows a "Seeker verified" badge.
- Native feel: haptics on every action, local notifications, a
  native UI (not a web view).

### 7. How it works (one Anchor program)
- Profile, Plan, Merchant and Link PDAs; vaults for the pool, rewards and
  SKR collateral are owned by the config PDA.
- Pay in 4 sets an **SPL delegate approval** for what's owed, so a
  permissionless **crank** can collect a due instalment.
- Send by link: an ephemeral key escrows the dollars and pays the claim
  itself; its change is swept back to the sender.
- 9 unit tests + 19 end-to-end tests on a local validator; a smoke script
  runs the whole app flow against the deployed program.
*Visual:* small diagram: phone → MWA → program → vaults.

### 8. What's next
- Mainnet with USDC and SKR, an oracle price for SKR, and the crank on a
  schedule.
- Merchants: payment links and a QR checkout for any Solana shop (the Monad
  version already had a merchant dashboard and SDK to port).
- Seeker-only perks keyed to the Genesis Token (one bonus per device).

### 9. Try it
- APK: `<APK_URL>` · Repo: https://github.com/nickthelegend/polaris-clockin
- Demo video: `<VIDEO_URL>`
- Devnet program `HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA`
- Team: `<TEAM>`
