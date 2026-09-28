# Local amounts: sample rates → Chainlink rates

Captured 28 Sep 2026 with headless Chrome against `pnpm --filter @polaris/app dev`
(offline demo, dev signer), browser language **es-AR** unless named. Phone is
390 × 844 at 2×, desktop 1440 × 900.

| Screen | Before (`MOCK_FX`) | After (Chainlink) |
|---|---|---|
| Claim a $100 link | `before-phone-claim.png`: "≈ $ 118.200 · sample rate" (pesos printed with a "$") | `after-phone-claim.png`: "≈ ARS 161.241 · Chainlink rate, 2 h ago · indicative" |
| Checkout total, $200 (a Halcyon buyer sees the same page) | `before-phone-checkout.png`: nothing | `after-phone-checkout.png`: "≈ ARS 322.481 · …" |
| Payment details | `before-phone-transaction.png`: "≈ $ 5.437 · sample rate" | `after-phone-transaction.png`: "≈ ARS 7.417 · …" |
| Send $25 (keypad) | `before-phone-send.png`: nothing | `after-phone-send.png`: "≈ ARS 40.310 · …" |
| Link ready | `before-phone-link-ready.png`: nothing | `after-phone-link-ready.png` |
| Settings | `before-phone-settings.png`: "at sample exchange rates" | `after-phone-settings.png`: "at the Chainlink exchange rate" |

The same six as `before-desktop-*.png` / `after-desktop-*.png`. Two more:

- `after-phone-claim-de-de.png`: "≈ 87,88 EUR", read from Monad mainnet's EUR / USD feed.
- `after-phone-claim-es-cl.png` and `after-phone-settings-es-cl.png`: Chilean pesos have
  no Chainlink feed, so no line at all, and Settings says so.

ARS came from Chainlink's USD / ARS feed on Ethereum (1,612.41 pesos per dollar,
updated about two hours before the capture); the sample rate was 1,182.
