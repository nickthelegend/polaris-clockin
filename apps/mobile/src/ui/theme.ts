// The Polaris design language, from packages/ui/styles.css (dark theme) and
// docs/screenshots/customer-app-screens.jpg: a near-black canvas, lime for
// money you hold, purple for credit, coral for what you owe. Satoshi.
export const color = {
  canvas: "#0f1011",
  surface1: "#1a1b1d",
  surface2: "#232426",
  surface3: "#2c2d30",
  hairline: "rgba(255,255,255,0.06)",
  hairlineStrong: "rgba(255,255,255,0.12)",
  text: "#f5f5f5",
  muted: "#8a8d93",
  dim: "#55585e",
  lime: "#9cef5e",
  limeBright: "#bffa62",
  onLime: "#0f1011",
  purple: "#8e5cf0",
  purpleDeep: "#6a17ee",
  purpleText: "#b596ff",
  crimsonFrom: "#de2f53",
  crimsonTo: "#f0506b",
  up: "#3ddc84",
  down: "#ff5a6e",
  warn: "#f7b955",
  info: "#8fb2ff",
  yellow: "#ffe98c",
  track: "#333333",
  scrim: "rgba(0,0,0,0.6)",
} as const;

export const font = {
  regular: "Satoshi-Regular",
  medium: "Satoshi-Medium",
  bold: "Satoshi-Bold",
  black: "Satoshi-Black",
} as const;

export const radius = { card: 24, surface: 18, pill: 999, key: 16 } as const;
export const gutter = 16;
