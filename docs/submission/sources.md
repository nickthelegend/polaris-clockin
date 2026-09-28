# Where the requirements come from

The bounty requirements in [`writeup.md`](writeup.md) and
[`bounty-fields.md`](bounty-fields.md) are quoted from
[`docs/plan.md` §3](../plan.md#3-sponsor-strategy), which paraphrases copies
of the portal's Tracks & Bounties page. This page records what was checked
on 28 Sep 2026, and what could not be checked without logging in to the
portal. Each line names its source and how sure it is.

## The portal

- **Bounty details need a login.** The portal's catalogue of tracks and
  bounties (`hackathon.monad.xyz/api/v1/catalog`) answers 401 without one, so
  each bounty's exact wording and its questions were not read live.
  *Verified.*
- **What the submission form holds**, from the portal's own client code:
  project fields `name`, `oneLiner`, `description`, `repositoryUrl` and
  `demoUrl`; each selected bounty has a set number of required answers, each
  answer up to **4,000 characters**; evidence items are of the kinds
  repository, demo, video, document or file. How many questions each sponsor
  asks, and their wording, is unknown until logged in. *Verified*
  (`hackathon.monad.xyz/_next/static/chunks/1-a_h_45gyga1.js`).
  [`bounty-fields.md`](bounty-fields.md) is written to that shape.
- **Dates**, from the same code: submissions open 1 Oct 2026 23:59 ET
  (`2026-10-02T03:59:00Z`); the deadline is **13 Oct 2026 23:59 ET**
  (`2026-10-14T03:59:00Z`); judging ends 27 Oct; winners are announced
  3 Nov ([monad.xyz/developers/hackathons/metropolis](https://monad.xyz/developers/hackathons/metropolis)).
  *Verified.*

## The rules

The official rules, v3, last updated 3 Sep 2026
(`hackathon.monad.xyz/api/v1/policies/current`), read 28 Sep 2026.
*Verified.* In short:

- **Every entry** needs a public GitHub repository with the complete source,
  a README with setup, an open-source licence and attribution of external
  code, and a commit history covering the build window; a public demo video
  of 3 minutes or less showing the product and its Monad integration; an
  explanation of the Monad integration with contract addresses and a
  deployment on Monad mainnet or testnet; pre-existing code identified in the
  README; AI coding tools disclosed in the README (§4.1). The rules also ask
  for contract addresses or transaction hashes (§9.2).
- **Sponsor bounties are judged** 40% on meeting the sponsor's published
  requirements, 30% technical implementation, 20% Monad integration and 10%
  innovation (§5.2). Main-track judging is 20% each for product quality,
  technical excellence, Monad integration, track fit and innovation.
- **The public page's FAQ** calls open-sourcing encouraged; the rules require
  a public repository with an open-source licence, and the rules are the
  binding text. Polaris is [MIT](../../LICENSE).

Where each rule is met: [README](../../README.md) (setup, licence,
attribution, [pre-existing components](../../README.md#pre-existing-components),
[AI coding tools](../../README.md#ai-coding-tools)),
[`writeup.md`](writeup.md#monad-track-02) (the Monad integration and the
addresses), [`video-script.md`](video-script.md) (the video).

## Chainlink CRE

- **The prize:** "Best workflow with CRE", $3,000, all tracks, the only
  Chainlink bounty on the public Metropolis page. *Verified*
  ([monad.xyz/developers/hackathons/metropolis](https://monad.xyz/developers/hackathons/metropolis)).
- **The requirement:** build, simulate or deploy a CRE workflow used as an
  orchestration layer within the project. This matches
  [`docs/plan.md` §3](../plan.md#3-sponsor-strategy); it comes from another
  team's copy of the portal page dated 14 Sep 2026, so it is *likely*, not
  verified live.
- **Chainlink's standard rubric for the same bounty** at other events asks
  that the workflow (1) connect at least one blockchain with an external API,
  system, data source, LLM or agent, (2) show a successful CRE CLI simulation
  or a live deployment, and (3) be meaningfully used in the project. The
  Metropolis wording is nearly identical, so it probably uses this template;
  not confirmed ([ethglobal.com/events/cannes2026/prizes/chainlink](https://ethglobal.com/events/cannes2026/prizes/chainlink)).
  Polaris against those three:
  1. The workflows connect Monad testnet with Nansen, Zerion, Etherscan and
     public RPCs (underwriting), with Chainlink's AUSD/USD on Monad mainnet
     (the guardian), and with the Polaris API through a signed callback
     ([`workflows/README.md`](../../workflows/README.md)).
  2. Three `cre workflow simulate --broadcast` runs delivered reports on Monad
     testnet on 28 Sep 2026 ([`workflows/evidence/2026-09-28/`](../../workflows/evidence/2026-09-28/README.md)).
  3. No report, no unsecured credit; collections run on the workflow's
     schedule; the guardian pauses new Pay in 4 plans
     ([`workflows/README.md`, "Why it is load-bearing"](../../workflows/README.md#why-it-is-load-bearing)).
- **Simulation qualifies**, and only `--broadcast` produces Monad
  transactions (Chainlink's simulation guide). *Verified.*
- **Deploy access** is needed only for `cre workflow deploy`, not to simulate
  (Chainlink's "Requesting Deploy Access" page). *Verified.* The CLI's own
  message at the end of each run says it is not enabled for our organisation
  yet ([a run's log](../../workflows/evidence/2026-09-28/guardian-081657.log)).
- **Chainlink on Monad testnet:** CRE is supported, with the simulation
  forwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192` and the production
  forwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`; Data Feeds there
  cover USDT, USDC, BTC, LINK and ETH against USD only, with **no AUSD/USD**,
  which Monad mainnet has. That is why the guardian reads AUSD/USD from
  Monad mainnet inside a testnet workflow. *Verified* (Chainlink's CRE
  forwarder directory and feed directory, 28 Sep 2026).
- **Not known:** how many answer fields the Chainlink bounty has, whether its
  judges want CLI logs or transaction hashes (the kit gives both), and
  whether Data Feeds or Confidential HTTP earn credit inside the CRE bounty.

## The other bounties

Agora, Privy, Nansen, Mera and Envio: the requirement lines are
[`docs/plan.md` §3](../plan.md#3-sponsor-strategy)'s paraphrases, from copies
of the portal page that three teams posted. The team's own research for each
sponsor is in [`docs/research/`](../research): [`ausd.md`](../research/ausd.md),
[`privy.md`](../research/privy.md), [`data.md`](../research/data.md) (Nansen,
Zerion, Etherscan), [`mera.md`](../research/mera.md),
[`envio.md`](../research/envio.md), [`cre.md`](../research/cre.md).
**Confirm each requirement's wording on the logged-in portal before
submitting**; where it differs, the portal wins.
