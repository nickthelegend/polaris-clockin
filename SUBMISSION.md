# Submission: Polaris at Monad Metropolis

**Polaris: payment links with credit built in. Stripe for every app on Monad.**
Track 02 (Consumer Products & Payments). Deadline Tue 13 Oct 2026, 11:59 PM ET.

**The pitch.** Every app that sells something needs Stripe, but on Monad a buyer
still needs a wallet, gas and the full price up front. Polaris is one link: the
buyer signs up with Face ID and pays in full, in four instalments against an
on-chain credit line, or on a subscription; sends dollars across borders by
link; and splits a bill. The merchant is paid in full, up front, in under a
second. Live on Monad testnet; the whole product also runs on a local chain
with `pnpm demo:local`.

| What | Where |
|---|---|
| Portal fields (name, one-liner, description, URLs) | [`docs/submission/profile.md`](docs/submission/profile.md) |
| The write-up (Track 02 and each bounty) | [`docs/submission/writeup.md`](docs/submission/writeup.md) |
| Per-bounty answers, ready to paste (≤ 4,000 characters each) | [`docs/submission/bounty-fields.md`](docs/submission/bounty-fields.md) |
| Each bounty's requirement, how it's met, what's left | [`docs/SPONSOR-GAP.md`](docs/SPONSOR-GAP.md) |
| Demo video script (≤ 3 min) | [`docs/submission/video-script.md`](docs/submission/video-script.md) |
| Pitch video script (≤ 2 min, if the portal asks) | [`docs/submission/pitch-script.md`](docs/submission/pitch-script.md) |
| Rules and sources | [`docs/submission/sources.md`](docs/submission/sources.md) |
| The team's checklist to the deadline | [`docs/TODO.md`](docs/TODO.md) |
| The runbook for deploys still to come (PolarisSplit, real AUSD, Envio, the Face ID domain, the shop) | [`docs/DEPLOY-LATER.md`](docs/DEPLOY-LATER.md) |
| Testnet deployment and evidence | [README](README.md#monad-testnet-deployment), [`docs/demo/testnet`](docs/demo/testnet/README.md), [`workflows/evidence`](workflows/evidence/2026-09-28/README.md) |

Before submitting: fill the kit's placeholders (`<VIDEO_URL>`, `<APP_URL>`,
the team table), run `pnpm docs:diffstat` at the commit you submit, then
`pnpm docs:check`.
