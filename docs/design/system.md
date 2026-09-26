# Polaris design system v2

**This supersedes `mobile.md` for both apps.** The team chose four new
references, and the product is rebuilt on a shared component library,
`packages/ui`, that reproduces their components exactly:

| Ref | File | What we take from it |
|---|---|---|
| **A · Aheadly** | [`refs-v2/ref-a-aheadly.webp`](refs-v2/ref-a-aheadly.webp) | The mobile app's core: dark base, lime balance card, round action buttons, quick-transfer avatars, transaction rows, the floating pill nav with a lime active circle, the transfer screen (card carousel, big amount, lime Send, keypad with a purple backspace), the purple spending card and pastel category bars |
| **B · Findex** | [`refs-v2/ref-b-findex.webp`](refs-v2/ref-b-findex.webp) | Onboarding (3D glass coins, "Invest smarter." headline, white Get Started), the gradient portfolio card, featured tiles, watchlist rows with sparklines, the purple chart card with range tabs, stat tiles, the Market/Limit segmented control, Sell/Buy buttons |
| **C · Trading** | [`refs-v2/ref-c-trading.webp`](refs-v2/ref-c-trading.webp) | Candlesticks on a dark panel (lime up, purple down, price tags, timeframe chips), the key-value stat grid, the details list, the Send/Receive/Top Up tile buttons, the pill nav with a lime "Home" tab, purple Sell / lime Buy. Its layout and density shape the web dashboard, which is dark (see "Web dashboard") |
| **D · Sales** | [`refs-v2/ref-d-sales.webp`](refs-v2/ref-d-sales.webp) | Analytics: the sales card with a sparkline and a delta chip, the weekly bar chart with a tooltip, the donut with floating value tags, the legend with thin progress bars, recent-sales rows, the balance card with side action squares |

Match them **exactly**: proportions, radii, spacing, weights, colours, icon
style, and the density of each component. The content is ours, mapped below.

## Type

- **Satoshi** (Fontshare, free for commercial use) for everything. Self-host
  the variable woff2 in `packages/ui/fonts`. Big numbers use weight 500–700
  with −0.03em tracking; labels 400–500.
- Figures are tabular (`font-variant-numeric: tabular-nums`). If Satoshi lacks
  `tnum`, use Inter Tight for numbers only.
- **The "dim dollar" pattern:** in `$25,841.11` the `$` and the cents render at
  about 40–55% opacity (refs A, B). It's a component (`<Money>`), not ad-hoc
  markup.

## Tokens

**Dark theme** (the mobile app, the web dashboard, the merchant landing and
sign-in):

| Token | Value |
|---|---|
| bg | `#0F1011` |
| surface-1 | `#1A1B1D` |
| surface-2 | `#232426` |
| surface-3 | `#2C2D30` |
| hairline | `rgba(255,255,255,.06)` |
| text | `#F5F5F5` |
| text-muted | `#8A8D93` |
| text-dim | `#55585E` |

**Light theme** (ref C's light screens; kept in `packages/ui` for light
previews and the gallery, but no product screen uses it as its shell):

| Token | Value |
|---|---|
| bg | `#EEEDF2` |
| surface | `#FFFFFF` |
| surface-2 | `#F6F5F9` |
| ink | `#13141F` |
| muted | `#6E7080` |

**Brand and accents:**

| Token | Value |
|---|---|
| lime | `#9CEF5E` (ref A; the balance card and primary CTA) |
| lime-bright | `#D2EC34` (ref C; up candles, Buy, Top Up) |
| lime-logo | `#BFFA62` |
| purple | `#8E5CF0` (ref A spending card, keypad backspace) |
| purple-deep | `#6A17EE` (ref C Receive, Sell, down candles) |
| purple-chart | `#923ECA` → `#B45AF2` (ref B chart card gradient) |
| crimson | `#DE2F53` → `#F0506B` (ref B portfolio card gradient) |
| up | `#3DDC84` |
| down | `#FF5A6E` |

**Chart pastels** (refs A, D): blue `#8FB2FF`, yellow `#FFE98C`,
lilac `#D8A8FF`, salmon `#FF8C85`, cyan `#7EF2F4`, mint `#92F2B2`,
teal `#63B59C`, pink `#F8D2D1`, sage `#B0CCC0`, sky `#C5DBF2`.

**Shape and motion:**

| Token | Value |
|---|---|
| Radius | cards 28px, tiles 20px, rows 18px, buttons and pills fully round, keypad keys 22px |
| Elevation | none on dark (surfaces separate by tone); the nav pill has a soft shadow |
| Motion | spring presses (scale .96); numbers tween; charts draw in; everything respects reduced motion |

## packages/ui: real, reusable components

**Primitives:**
- `Button` (lime, white, dark, purple, outline, ghost; sizes; icon slot)
- `IconButton` (round, the bell and back buttons)
- `Pill`, `Chip`, `DeltaBadge` (up and down)
- `Avatar`, `AvatarStack`, `FlagBadge`
- `Card`, `Tile`, `SectionHeader` (title + "See all")
- `SegmentedControl` (Market/Limit, Expenses/Savings)
- `RangeTabs` (1D 1W 3M 6M All + calendar)
- `Money` (the dim-dollar formatter)
- `Keypad`, `AmountDisplay`
- `Toggle`, `Input`, `Sheet`, `Toast`, `Skeleton`, `EmptyState`

**Composites:**
- `BalanceCard` (ref A lime)
- `GradientCard` (ref B crimson and purple)
- `ActionRow` (round white action buttons)
- `QuickTransfer` (plus circle + avatars)
- `TxRow` (brand circle, title, time, amount, sub-amount)
- `AssetRow` (logo, name, sparkline, value, delta)
- `FeaturedTile`
- `MiniCardCarousel` (ref A transfer cards)
- `StatTile`, `KeyValueGrid`, `DetailsList` (ref C)
- `TileButton` (ref C Send/Receive/Top Up)
- `BottomNav` in two variants: icon pill with a lime active circle (ref A), and labelled "Home" pill (ref C)
- `AppHeader` (logo + bell + avatar)
- `ScreenHeader` (back, title, action)
- `CardStack` (ref D balance card with side squares)

**Charts (hand-built SVG, no chart library):**
- `Sparkline`
- `LineArea` (ref A spending and ref B price chart, with a gradient fill and
  a glow line)
- `CandlestickChart`
  - lime up and purple-deep down, wicks, a dashed last-price line with a lime
    tag and a purple reference tag
  - a right-hand price axis and timeframe chips
  - a crosshair on hover or drag, animated draw-in
- `DonutChart`: rounded segment ends, gaps, floating value tags, and a centre
  label
- `BarChart`: rounded bars with a selected bar and a tooltip bubble, ref D
- `HBarList`: ref A category bars, the width proportional to the share, a
  pastel fill and the percentage at the end
- `ProgressLegend`: ref D's Giveaway/Affiliate/Offline row

**Also required:**
- A **component gallery** route in each app (`/gallery`) renders every
  component in every variant. It is how reviewers compare against the
  references.
- **Icons:** `lucide-react` at 1.75 stroke, matching the references' outline
  icons.

## Mobile app screens (dark), reference → Polaris

1. **Onboarding (3 pages, ref B screen 1).**
   - Full-bleed Lottie art: glass coins in lime, purple and crimson, floating
     and turning.
   - A big two-line headline, one line of sub, page dots, and a white
     **Get Started**.
   - The pages:
     1. "Get paid in dollars. Instantly." (coins drift in)
     2. "Split it in four. Pay as you go." (a lime card splits into four
        segments)
     3. "Send money anywhere. By link." (a coin flies along an arc between
        two pins)
   - Then Face ID account creation (Mera).
2. **Home (ref A screen 1).**
   - `AppHeader` with the Polaris mark and wordmark, the bell and the avatar.
   - A lime `BalanceCard`:
     - a "Main account ▾" dark pill, and bolt and pencil round buttons
     - "USD · AUSD" labels, then `$1,284.50` with a +2.1% delta
     - `ActionRow` (Add, Receive, Send, More)
   - `QuickTransfer` (send by link to contacts).
   - Recent transactions as `TxRow`s: merchant logo circle, time, amount, and
     the Pay in 4 instalment as the sub-amount.
   - `BottomNav` variant A: Insights · Cards · **Home** · Links · Profile.
3. **Send (ref A screen 2):**
   - the recipient row with a swap icon
   - `MiniCardCarousel`: Dollar account, Pay later line, Boost
   - `AmountDisplay` with the dim `$`
   - a lime **Send**, then the `Keypad` with a purple backspace
4. **Insights (ref A screen 3):** a purple "My spending" `GradientCard` with a
   `LineArea` and delta; `SegmentedControl` Expenses | Plans + a calendar
   `IconButton`; an `HBarList` of spending by category (Food, Shopping,
   Travel, Bills, Subscriptions, Other).
5. **Credit (ref B screen 2):**
   - a crimson `GradientCard`, "Your credit line" `$500.00`, with a delta chip
   - "Active plans" `FeaturedTile`s: merchant logo, remaining, next payment,
     4-tick progress
   - "Upcoming" `AssetRow`s with sparklines of the instalment schedule
6. **Credit score (ref B screen 3 + ref C screen 2):**
   - a purple chart card, "648 (+12, +1.9%)", with `RangeTabs`, toggling
     between `LineArea` and `CandlestickChart` (the score, week by week)
   - `StatTile`s (8 on time · $500 line · next tier $1,000)
   - a `KeyValueGrid`
   - a dark **Pay early** and a white **Raise limit**
7. **Checkout /pay/[id] (ref C screen 3 + ref B):**
   - `ScreenHeader` with the merchant name and a share button
   - a `KeyValueGrid` (Amount, Pay in 4, Interest, First payment) and a
     `DetailsList` (Merchant, Order, Due dates)
   - `SegmentedControl` Pay now | Pay in 4
   - a purple **Pay in 4** and a lime **Pay now**
8. **Activity (ref D screen 3):** `TxRow`s grouped by day, with filter chips.
9. **Cards / Profile (ref D screen 3 top):** `CardStack` with side action
   squares, account details, and sign out.
10. **Claim and Plans:** the same parts.

## Presentation: most screens slide up as bottom sheets

The team asked for most screens to pop up from the bottom. Only the five
tabs are full screens; everything you *do* slides up over them.

- **Tabs (full screens, BottomNav):** Home · Insights · Cards · Activity ·
  Profile.
- **Sheets:**

  | Sheet | Size |
  |---|---|
  | Send | full |
  | Receive (QR + request link) | half |
  | Add money | half |
  | Checkout `/pay/[id]` | full |
  | Claim | full |
  | Select account (the card carousel) | half |
  | Transaction detail | half |
  | Plan detail | half, drag up to full |
  | Credit line | full |
  | Credit score (candles) | full |
  | Notifications | half |
  | Settings and account actions | half |
  | Filters | half |
  | Confirm with Face ID | compact |
  | Success receipt, with a check-mark animation | half |

- **`BottomSheet` in packages/ui:**
  - Motion drag with snap points (compact, half, full) and a velocity-based
    swipe to dismiss.
  - A spring in and out; the backdrop dims to about 60% and blurs by 8px; the
    screen behind scales to 0.96 with rounded corners, like iOS.
  - The sheet has 32px top corners, a grab handle and an optional
    `Sheet.Header` (title + close).
  - The inner content scrolls without fighting the drag.
  - `aria-modal`, a focus trap, Escape to close, body scroll lock, safe-area
    padding. Reduced motion means a fade, no travel.
- **Routing:** Next.js App Router parallel routes (`@sheet`) with intercepting
  routes (`(.)send`, `(.)pay/[id]` and so on). Opening one from inside the app
  presents it as a sheet over the current tab, and its URL still deep-links. A
  cold link (a checkout link from a merchant) opens the sheet over a blurred
  Home.
- **Web dashboard:**
  - Detail views (payment, plan, payout) open in a right-hand `Drawer`, and
    create/edit flows (new link, new key, webhook) in a `Dialog`.
  - Below 768px both become `BottomSheet`s.

## Accounts

- **Consumer app:** Face ID through Mera is the primary sign-up, as the Agora
  bounty requires.
  - Privy (email or Google, with an embedded wallet) is offered beneath it as
    "Continue with email", using the same Privy app as the dashboard.
  - The account layer is one interface with three implementations: mera,
    privy and dev.
  - The Android build's Privy app client id is read from
    `NEXT_PUBLIC_PRIVY_ANDROID_CLIENT_ID`.
- **Web dashboard:** Privy, live. It reads the app id and secret from
  `apps/business/.env.local` (git-ignored), with real sign-in, embedded
  merchant wallets and server-side token verification.
  - The sign-in page's one **Continue** button opens Privy's own modal, which
    lists exactly the methods turned on in the Privy dashboard (today email
    and external wallets; Google appears by itself once it is enabled there).
    We never draw a button for a method that is off.
  - Every merchant gets an embedded payout wallet at sign-in (the client
    config requests it for all users).

## Web dashboard (apps/business)

**The web is dark, in the mobile app's visual language. There is no light
shell.** The merchant side should feel like the same product as the Polaris
app: the dark tokens, Satoshi, lime accents, the glass renders, and ref B's
and ref D's dark panels. Ref C sets the dashboard's layout and density only
(its stat grid, details list, candle panel and labelled nav), not its light
ground.

- **Ground and surfaces:** `canvas` for the page, `surface-1` cards at 28px,
  `surface-2` rows and tiles inside them, hairlines between table rows. The
  pastel `StatCard`s (sage, pink, honey) and the `CardStack`'s sky card carry
  the colour; lime is the one action colour.
- **Three public pages share the look:**
  - `/` is the merchant landing ("Polaris for Business"), in the spirit of
    `apps/landing` (its motion tokens, reveal-on-scroll, Lenis and section
    rhythm), but dark. Its product visual is built from real components (a
    phone with the Checkout sheet beside a dark dashboard panel with the
    `CandlestickChart`), never a screenshot. Signed-in merchants see
    **Open dashboard** in its nav.
  - `/login` has the wordmark, a two-line headline, one **Continue** (Privy's
    modal), a trust line, and on wide screens a glass card and a mini
    dashboard built from components.
  - The dashboard lives under `/dashboard`; the old top-level paths redirect.
- **Shell:**
  - A left sidebar with the team's `PolarisMark` and wordmark
    (`packages/brand`) and a lime active item. It is full width from 1280px
    and an icon rail from 768 to 1279px. Below 768px there is a top bar and
    the floating `BottomNav` (ref A's icon pill with the lime active circle).
  - A header with the page title, the page's actions, and the signed-in
    merchant's avatar menu (business name, email, copy the payout address,
    sign out).
- **Overview:**
  - a Sales card with a sparkline and delta chip
  - a `BarChart` of customers this week
  - a `DonutChart` of sales by mode (Pay now / Pay in 4 / Subscriptions) with
    a `ProgressLegend`
  - `CandlestickChart` of daily payment volume, with timeframe chips
  - recent sales rows
  - credit exposure, with plain-language reasons from Nansen wallet history
  - a Collections card: the Chainlink CRE workflow's last and next run
  - an "Indexed by Envio" live event feed
- **Payments, Links, the Plans ledger** (instalment ticks), **Payouts** (a
  `CardStack` balance, one-tap withdraw, automatic payouts by a Privy session
  signer) and **Developers** (keys, webhooks, the SDK snippet), all from the
  same library. Detail views open in a `Drawer` and create and edit flows in
  a `Dialog`; both become `BottomSheet`s below 768px.
- **Honest data:** anything not yet backed by a live service (the indexer,
  the CRE workflow, Nansen, the relayer) shows an empty or "not connected"
  state. When sample data is on, every card and row that shows it carries a
  `Sample` chip. A control that can't work yet is disabled with the reason
  beside it; it is never left to fail.

## Rules

- **Nothing one-off.** A screen is composed from `packages/ui`; if a screen
  needs something new, it becomes a component first.
- **Copy rules from `mobile.md` still apply to the buyer path:** no wallet, gas
  or blockchain words.
- **Accessibility:** contrast AA, focus rings, labelled icon buttons,
  reduced motion.
