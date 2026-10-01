# Split the bill, as the product shows it

Captured on 28 Sep 2026 by `pnpm demo:e2e:split`
([`scripts/demo-e2e-split.cjs`](../../../scripts/demo-e2e-split.cjs)) against
`pnpm demo:local` (branch `metropolis/split`): headless Chrome, reduced
motion, phones at 402×877 and desktops at 1440×900. Four people, four browser
profiles, one local chain. Every amount, share and status on these screens
came from the chain (PolarisSplit, through `GET /api/public/splits/{id}`);
nothing was mocked in the browser. The dev signer stands in for Face ID (the
badge on every screen). [`results.json`](results.json) has each step, the
splits' ids and the local transaction hashes: 22 of 22 passed.

What is local: the chain is Hardhat's (chain 31337), the dollars are the
local faucet's test dollars, and the relayer is the dev adapter held to the
production policy. PolarisSplit is not on Monad testnet yet
(`deploy-split:monad`, not run).

## The dinner: $200, five people, equal shares

Maya paid. She splits it five ways with herself in, so her $40 stays hers and
four friends owe $40 each: $160 to collect, one link.

| | Phone (402×877) | Desktop (1440×900) |
|---|---|---|
| The bill on the keypad | [`01-phone-new-bill`](01-phone-new-bill.png) | |
| Equally between five, the friends named | [`02-phone-new-details`](02-phone-new-details.png) | |
| Confirm with Face ID, naming herself once | [`03-phone-new-confirm`](03-phone-new-confirm.png) | |
| Link ready: one link, its QR, Share and Copy | [`04-phone-link-ready`](04-phone-link-ready.png) | |
| Her split: 0 of 4 paid, Remind, Copy link, Close split | [`05-phone-organiser-open`](05-phone-organiser-open.png) | |
| Sam opens the link (no account): "Maya asked you to split", which one is you? | | [`06-desktop-friend-link`](06-desktop-friend-link.png) |
| He picks his name: Pay $40 | | [`07-desktop-friend-picked`](07-desktop-friend-picked.png) |
| Pay with Face ID (it makes his account) | | [`08-desktop-friend-confirm-new`](08-desktop-friend-confirm-new.png) |
| His account exists; with $0 he is told to add $40 before anything is signed | | [`09-desktop-friend-add-first`](09-desktop-friend-add-first.png), [`10-desktop-friend-short`](10-desktop-friend-short.png) |
| After Add money (test dollars): confirm, then Paid, straight to Maya | | [`11-desktop-friend-confirm`](11-desktop-friend-confirm.png), [`12-desktop-friend-paid`](12-desktop-friend-paid.png) |
| Priya (an account with dollars): 1 of 4 paid, picks her name, pays | [`13-phone-friend-link`](13-phone-friend-link.png), [`14-phone-friend-picked`](14-phone-friend-picked.png), [`15-phone-friend-confirm`](15-phone-friend-confirm.png), [`16-phone-friend-paid`](16-phone-friend-paid.png) | |
| Priya's Activity: her share, to Maya | [`17-phone-friend-activity`](17-phone-friend-activity.png) | |
| Maya: 2 of 4 paid, $80 of $160 | [`18-phone-organiser-2-of-4`](18-phone-organiser-2-of-4.png) | |
| Activity: Your splits, and each share as it landed | [`19-phone-activity`](19-phone-activity.png) | [`20-desktop-activity`](20-desktop-activity.png) |
| The split from Activity's panel | | [`21-desktop-organiser-split`](21-desktop-organiser-split.png) |
| Close split: the two unpaid shares are cancelled, nothing moves | | [`22-desktop-close-confirm`](22-desktop-close-confirm.png), [`23-desktop-organiser-closed`](23-desktop-organiser-closed.png) |
| Jon opens the link after it closed: nothing to pay, nothing charged | [`24-phone-friend-closed`](24-phone-friend-closed.png) | |

## The groceries: $90, by named amounts

From the desktop: Sam $35.50, Priya $24.50, Maya's own $30 hers. Both pay.

| | Phone (402×877) | Desktop (1440×900) |
|---|---|---|
| By amount, in the desktop's dialog | | [`25-desktop-new-by-amount`](25-desktop-new-by-amount.png) |
| Confirm, Link ready | | [`26-desktop-new-confirm`](26-desktop-new-confirm.png), [`27-desktop-link-ready`](27-desktop-link-ready.png) |
| Everyone paid | [`29-phone-organiser-settled`](29-phone-organiser-settled.png) | [`28-desktop-organiser-settled`](28-desktop-organiser-settled.png) |
| Activity afterwards: both splits, four shares in | [`30-phone-activity-after`](30-phone-activity-after.png) | |

## What the run checked

Against the chain and the API, not the screen alone: the split's organiser,
shares and total as signed; that the API never sees the split's words (only
their hash); that Sam's empty account relayed nothing; that each share was
paid by the friend who signed it and went straight to Maya (PolarisSplit
keeps nothing); that the same signed share relayed again pays nothing more
(the relayer answers with the first transaction); that Maya's balance rose by
exactly $80, then $140 in all; that closing left 2 of 4 paid and moved
nothing; and that the groceries split settled.

Friends' initials stand in for faces: a share's name is whatever the
organiser typed, so the app never shows a sample person's photo for it.
