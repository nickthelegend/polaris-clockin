# @polaris/ui

The Polaris component library, shared by the consumer app (`apps/app`) and the
merchant dashboard (`apps/business`). It reproduces the four references in
[`docs/design/refs-v2`](../../docs/design/refs-v2) component by component; the
contract is [`docs/design/system.md`](../../docs/design/system.md).

Open **`/gallery`** in either app to see every component in every variant,
set out beside the reference it comes from. Captures live in
[`docs/design/gallery`](../../docs/design/gallery).

## Setup in a Next.js app

```jsonc
// package.json
"dependencies": { "@polaris/ui": "workspace:*" }
```

```ts
// next.config.ts
transpilePackages: ["@polaris/ui", "@polaris/brand"],
```

```css
/* the global stylesheet */
@import "tailwindcss";
@import "@polaris/ui/styles.css";
```

`styles.css` registers the components with Tailwind (`@source "./src"`), loads
Satoshi, and defines every token. Everything is namespaced (`--ui-*` variables,
`ui-*` utilities, `font-satoshi`), so it sits beside an app's own tokens
without changing an existing screen, and nothing styles bare elements. Give a
screen root `className="ui-root"` (Satoshi, the theme's ground and text).

## Themes

| Theme | Where | How |
|---|---|---|
| Dark | the default; the app, and every analytics panel | `:root` or `data-theme="dark"` |
| Light | the web dashboard's shell (ref C) | `data-theme="light"` |

Scopes nest: `<ThemeScope theme="light">` for the shell, `<Card theme="dark">`
for a ref D panel inside it. Sheets, drawers, dialogs and select menus are
portalled but take the theme of whatever opened them.

Tokens (`bg-ui-*`, `text-ui-*`, `border-ui-*`): `canvas`, `surface-1..3`,
`hairline`, `hairline-strong`, `text`, `muted`, `dim`, `ink` / `on-ink` (the dark
button), `track`, `up`, `down`, `warn`, `info`, `purple-text`, `focus`,
`scrim`, `glass`; brand `lime`, `lime-bright`, `lime-logo`, `on-lime`,
`purple`, `purple-deep`, `purple-chart-from/to`, `crimson-from/to`; pastels
`blue`, `yellow`, `lilac`, `salmon`, `cyan`, `mint`, `teal`, `pink`, `sage`,
`sky`, `honey`, `mint-soft`. The light theme prints gains in purple-deep and
losses in red, as ref C does (and for AA contrast on white).

Radii: `rounded-ui-card` 28, `rounded-ui-tile` 20, `rounded-ui-row` 18,
`rounded-ui-key` 22, `rounded-ui-sheet` 32, `rounded-ui-field` 16. Shadows:
`shadow-ui-pop`, `shadow-ui-nav`, `shadow-ui-card`. Figures: `ui-figure`
(tabular, lining).

Icons are lucide at **1.75** stroke. Every icon slot sizes and strokes the icon
you pass (`icon={<Bell />}`); wrap an app in `<IconProvider>` for the same
default everywhere.

## Components

Every component takes `className` (merged with tailwind-merge, so yours
wins) and forwards refs where it renders one element.

### Primitives

| Component | Usage |
|---|---|
| `Button` | `<Button variant="lime" size="xl" block>Send</Button>` · variants `lime`, `lime-bright`, `white`, `dark`, `purple`, `violet`, `outline`, `ghost`; sizes `sm`–`xl`; `shape="rounded"` (ref B); `icon`, `iconRight`, `loading`, `asChild` |
| `IconButton` | `<IconButton label="Notifications" icon={<Bell />} tone="surface" dot />` · tones `surface`, `ink`, `outline`, `white`, `lime`, `purple`, `glass`, `ghost`, `black`; `shape="square"` |
| `Pill` | `<Pill tone="black" chevron onClick={open}>Main account</Pill>` · tones `ink`, `black`, `surface`, `white`, `glass`, `outline`, `lime` |
| `Chip` | `<Chip selected={tf === "5h"} onClick={…}>5h</Chip>` · `variant="plain" \| "outline" \| "solid"`, `count` |
| `DeltaBadge` | `<DeltaBadge value={3.25} />` · `variant="chip"` with `amount` on colour, `soft`, `note="From last week"`, `tone="current"` (white on ref A's purple) |
| `Badge` | `<Badge tone="up" dot>Paid</Badge>` · `neutral`, `lime`, `purple`, `up`, `down`, `warn`, `info`, `ink` |
| `Avatar` | `<Avatar name="Ana Ruiz" size="lg" badge={<FlagBadge code="MX" />} />` · photo, initials on a pastel, or a brand circle (`color`, `icon`) |
| `AvatarStack` | `<AvatarStack people={customers} max={4} />` |
| `FlagBadge` | `<FlagBadge code="US" />` · US, EU, GB, IN, NG, MX, BR, CA |
| `Card` | `<Card theme="dark" variant="canvas" padding="lg">…</Card>` · `surface`, `raised`, `canvas`, `outline`; `radius="card" \| "tile" \| "row"` |
| `Tile` | `<Tile variant="raised">…</Tile>` |
| `ThemeScope` | `<ThemeScope theme="light" root>…</ThemeScope>` |
| `SectionHeader` | `<SectionHeader title="Recent sales" actionLabel="See all" href="/payments" />` · `size="lg"`, `subtitle`, `action` |
| `SegmentedControl` | `<SegmentedControl aria-label="Pay" options={[{ value: "now", label: "Pay now" }, { value: "four", label: "Pay in 4" }]} />` · `shape="pill"`, `size`, `block` |
| `RangeTabs` | `<RangeTabs value={range} onValueChange={setRange} onCalendar={pick} />` · `tone="onColor" \| "surface"` |
| `Tabs`, `TabList`, `Tab`, `TabPanel` | `<Tabs defaultValue="all" variant="pill"><TabList aria-label="Payments"><Tab value="all" count={24}>All</Tab></TabList><TabPanel value="all">…</TabPanel></Tabs>` · `text` (ref A), `pill`, `segmented` |
| `Money` | `<Money value={25841.11} />` · the dim dollar: `dim="both" \| "symbol" \| "cents" \| "none"`, `signed`, `compact`, `spaced` (ref D), `animate` |
| `Input`, `Textarea` | `<Input label="Business name" icon={<Store />} hint="…" error="…" />` · `variant="filled" \| "outline"`, `trailing` |
| `Select` | `<Select aria-label="Refresh" variant="outline" options={[…]} />` · `outline` (ref D), `white` (ref C), `chip` (in the candle panel), `filled` (forms); keyboard, type-ahead, flips above |
| `Toggle` | `<Toggle label="Automatic payouts" description="Every day at 17:00" />` |
| `Skeleton`, `SkeletonText` | `<Skeleton shape="card" height={200} />` |
| `EmptyState` | `<EmptyState icon={<Link2 />} title="No links yet" description="…" action={<Button>New link</Button>} />` |
| `Toaster`, `toast` | mount `<Toaster />` once; `toast({ title: "Link copied", tone: "success" })` |
| `Table`, `CellStack` | `<Table caption="Payments" columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={open} />` · `variant="lined" \| "rows"`, sorting, loading, `empty`, `hideBelow` |
| `Keypad`, `applyKey` | `<Keypad onKey={(k) => setAmount((a) => applyKey(a, k))} captureKeyboard />` |
| `AmountDisplay` | `<AmountDisplay value={amount} hint="Available $1,284.50" invalid={over} />` · shrinks as it grows, shakes when `invalid`, optional `caret` |
| `Logo`, `LogoMark` | `<Logo height={30} />` (the team's wordmark) · `<LogoMark size={28} />` (the star) |

### Composites

| Component | Usage |
|---|---|
| `BalanceCard` | `<BalanceCard account="Main account" balance={1284.5} delta={2.1} quickActions={[…]} actions={[…]} more={{ label: "More" }} />` (ref A) |
| `ActionRow` | `<ActionRow actions={[{ label: "Add", icon: <Plus /> }]} more={{ label: "More" }} />` |
| `GradientCard` | `<GradientCard tone="crimson" label="Your credit line" value={<Money value={500} dim="cents" />} meta={<DeltaBadge variant="chip" … />} />` · `purple` + `layout="side"` (ref A), `purple-chart` (ref B) |
| `QuickTransfer` | `<QuickTransfer people={contacts} onAdd={newLink} onSelect={sendTo} />` |
| `TxRow` | `<TxRow leading={<Avatar … />} title="Oat & Ember" subtitle="9:10 AM" amount={-59} subAmount="Pay in 4 · $14.75" />` · `variant="card"` (ref D) |
| `AssetRow` | `<AssetRow leading={…} title="Kiko Ramen" subtitle="Oct 14 · 2 of 4" spark={[…]} value="$9.40" meta="+2.24%" />` · `variant="sunken"`, `sparkFill` |
| `FeaturedTile` | `<FeaturedTile leading={…} title="Oat & Ember" value="$90.00" meta="Next Oct 12" progress={{ done: 2, total: 4 }} tint="#c2410c" />` |
| `MiniCardCarousel` | `<MiniCardCarousel aria-label="Pay from" cards={accounts} value={id} onValueChange={setId} />` |
| `StatTile` | `<StatTile value="+$850" label="Saved" tone="up" />` |
| `KeyValueGrid` | `<KeyValueGrid items={[{ label: "Amount", value: "$120.00" }]} />` · `variant="sunken"` for ref C on white |
| `DetailsList` | `<DetailsList items={[{ label: "Merchant", value: "Oat & Ember" }]} />` |
| `TileButton` | `<TileButton tone="purple" icon={<ArrowDownLeft />} label="Receive" />` · `ink`, `purple`, `lime`, `surface` |
| `BottomNav` | `<BottomNav floating items={tabs} value="home" linkAs={Link} />` · `variant="labelled"` (ref C), `activeTone="white"` (ref B) |
| `AppHeader` | `<AppHeader name="Ana Ruiz" unread onBell={open} />` · `variant="greeting"` (ref C) |
| `ScreenHeader` | `<ScreenHeader title="Send" onBack={back} action={…} />` · `variant="plain" \| "square" \| "arrow"` |
| `CardStack` | `<CardStack name="Oat & Ember" last4="2431" balance={62745} delta={11.05} actions={[…]} />` (ref D) |
| `StatCard` | `<StatCard tone="sage" icon={<Percent />} label="Sales" delta={23} value={<Money … />} spark={sales} />` · `sage`, `pink`, `honey`, `sky`, `lilac`, `lime`, `surface` |

### Charts (hand-built SVG)

| Component | Usage |
|---|---|
| `Sparkline` | `<Sparkline data={series} color="var(--ui-up)" height={32} />` · `fill`, `baseline="avg"`, `curve="linear"` |
| `LineArea` | `<LineArea label="Credit score" data={weeks} height={200} glow reference="avg" interactive />` |
| `CandlestickChart` | `<CandlestickChart label="Daily volume" data={ohlc} timeframes={["1D", "1W", "1M"]} reference={{ value: 97.45 }} />` · lime up, purple-deep down, dashed last-price line with a lime tag, crosshair on hover, drag and arrow keys, draw-in |
| `DonutChart` | `<DonutChart label="Sales by mode" data={[{ label: "Pay now", value: 56685, color: "var(--ui-teal)" }, …]} />` · round ends overlapping like ref D (`gap` opens them), `startAngle`, glass value tags, hover or focus a segment to read it |
| `BarChart` | `<BarChart label="Customers this week" data={week} formatValue={(v) => `$ ${v}`} />` |
| `HBarList` | `<HBarList label="Spending by category" data={[{ label: "Food", value: 35 }, …]} />` |
| `ProgressLegend` | `<ProgressLegend items={[{ label: "Pay now", value: 60, color: "var(--ui-teal)" }]} />` · `direction="column"` |

All charts draw in once on mount (a later re-measure does not replay it) and
stay still under reduced motion.

### Presentation

| Component | Usage |
|---|---|
| `BottomSheet` | `<BottomSheet open={open} onOpenChange={setOpen} snapPoints={["half", "full"]} title="Plan"><Sheet.Body>…</Sheet.Body><Sheet.Footer>…</Sheet.Footer></BottomSheet>` · snaps `compact`, `half`, `full` or px; velocity-based swipe to dismiss; content scrolls without fighting the drag |
| `SheetStage` | `<SheetStage className="min-h-dvh"><App /></SheetStage>` · scales the page behind an open sheet to 0.96 with rounded corners and makes it inert |
| `Sheet.Header`, `Sheet.Body`, `Sheet.Footer` | the parts every overlay shares (also `Drawer.*`, `Dialog.*`) |
| `Drawer` | `<Drawer open={!!p} onOpenChange={…} title="Payment" description={p.id}><Drawer.Body>…</Drawer.Body></Drawer>` · right side on desktop, a half/full sheet below 768px |
| `Dialog` | `<Dialog open={open} onOpenChange={setOpen} title="New payment link"><Dialog.Body>…</Dialog.Body><Dialog.Footer>…</Dialog.Footer></Dialog>` · centred on desktop, a sheet below 768px |
| `useOverlay` | inside any of them: `const { close, kind } = useOverlay()` |

All three are `aria-modal` with a focus trap, Escape to close (the topmost
layer only), a body scroll lock, safe-area padding, and a fade instead of
travel under reduced motion. Focus goes to the first control on open (on
touch screens, to the panel itself, so no keyboard pops up) and returns to
the opener on close.

### Helpers

`cn`, `formatMoney`, `formatPercent`, `formatCompact`, `moneyParts`,
`useMediaQuery`, `useControllable`, `useScrollLock`, `useFocusTrap`,
`IconSlot`, `IconProvider`.

## Gallery

`@polaris/ui/gallery` exports `<Gallery app="business" | "app" />`. Each app
mounts it at `/gallery` (`apps/*/src/app/gallery/page.tsx`); the dashboard's
route skips Privy, so it renders without a session.

## Font licence

`fonts/Satoshi-Variable.woff2` is **Satoshi Variable** by Indian Type Foundry,
downloaded from Fontshare (<https://www.fontshare.com/fonts/satoshi>). Fontshare
fonts are free for personal and commercial use under the ITF Free Font
License (<https://www.fontshare.com/licenses/itf-ffl>); the font files may be
embedded in apps and websites but not sold or redistributed on their own. The
file is the variable font (weight axis 300 to 900) and includes `tnum`, so
figures are tabular without a fallback face.
