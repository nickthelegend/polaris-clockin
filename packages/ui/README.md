# @polaris/ui

The Polaris component library, shared by the consumer app (`apps/app`) and the
merchant dashboard (`apps/business`). It reproduces the four references in
[`docs/design/refs-v2`](../../docs/design/refs-v2) component by component; the
contract is [`docs/design/system.md`](../../docs/design/system.md).

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

## Font licence

`fonts/Satoshi-Variable.woff2` is **Satoshi Variable** by Indian Type Foundry,
downloaded from Fontshare (<https://www.fontshare.com/fonts/satoshi>). Fontshare
fonts are free for personal and commercial use under the ITF Free Font
License (<https://www.fontshare.com/licenses/itf-ffl>); the font files may be
embedded in apps and websites but not sold or redistributed on their own. The
file is the variable font (weight axis 300 to 900) and includes `tnum`, so
figures are tabular without a fallback face.
