# The pitch video: two minutes

Sponsor research of 5 Oct lists a pitch video of 2 minutes or less beside the
3-minute demo. The rules we read on 28 Sep (v3,
[`sources.md`](sources.md#the-rules)) don't mention one, so confirm it on the
logged-in portal; if it isn't asked for, skip it. The demo shows the product working
([`video-script.md`](video-script.md)); the pitch says why it matters, in the
order of [`docs/plan.md` §2, "The pitch"](../plan.md#the-pitch). One speaker
on camera, with product shots cut in. No new claims: every line below is
something the README or the demo already shows.

**Total: 2:00.** Five beats.

## Rules for the recording

1. **Say only what ran.** Testnet facts are testnet facts; local-chain shots
   carry the same captions as in the demo video.
2. **The dollar on testnet is a labelled mock** (MockAUSD), unless the
   deployment has moved to Agora's AUSD by the time of recording
   ([`docs/TODO.md`](../TODO.md)). Say "dollars" aloud; the caption names it.
3. **Product shots come from the demo takes**, so the two videos match.

## The script

### [0:00–0:20] The problem

> Every app that sells something needs Stripe. On Monad, a buyer still has to
> install a wallet, buy gas and pay in full. A merchant waits for the money,
> then can't easily move it. So most apps don't sell anything on chain.

*Shots:* a crypto checkout asking for a wallet and gas, then the Halcyon shop.

### [0:20–0:50] What Polaris is

> Polaris is Stripe for every app on Monad. A merchant shares one link. The
> buyer signs up with Face ID, no seed phrase, and pays in full, in four
> instalments against a credit line, or on a subscription. They can send
> dollars across borders by link, and split a bill. They never hold gas.

*Shots:* the payment link opening the checkout; Pay now / Pay in 4 /
Subscribe; send by link and claim.

### [0:50–1:15] Why it works on Monad

> Every action is a signature. A relayer carries it, so buyers never touch
> MON, and Monad confirms it before the popup closes. The merchant is paid in
> full, up front, from the credit pool; the risk and the collections are ours.
> Credit limits come from on-chain history, scored by a Chainlink CRE
> workflow, and the pool pauses itself if the dollar slips its peg.

*Captions:* "Privy server wallet relayer, policy-locked" · "Chainlink CRE
underwriting, collections and guardian".

### [1:15–1:40] What is real today

> On Monad testnet: twelve contracts, verified. Fourteen of fourteen buyer and
> merchant actions ran gas-free through a policy-locked Privy server wallet,
> with accounts that never held MON. Three Chainlink CRE workflows delivered
> signed reports on chain. And what you buy is kept as a receipt only your
> Face ID can open.

*Shots:* Monadscan's verified source; the testnet run's table
([`docs/demo/testnet/README.md`](../demo/testnet/README.md)); a sealed
receipt opening.

### [1:40–2:00] The ask

> Polaris turns any app on Monad into a shop, with credit built in, for people
> who have never heard of a wallet. Merchants can start with one link today.
> Polaris: payment links with credit built in.

*End card:* the one-liner, the app URL, the repository URL.

## Before recording

- [ ] The demo takes are cut ([`video-script.md`](video-script.md)), so the
      product shots exist
- [ ] Re-read every number against the README on the day: contract count,
      the testnet run, the CRE reports
- [ ] Put the public link in [`profile.md`](profile.md) next to the demo's
