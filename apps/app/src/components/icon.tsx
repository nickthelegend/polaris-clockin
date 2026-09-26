/**
 * One drawn icon set: 24px grid, 1.75 stroke, round joins. The four-point
 * star is the Polaris mark and the only filled glyph.
 */

const paths = {
  home: "M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.25v-5.25h-5.5V20H5a1 1 0 0 1-1-1z",
  activity: "M3.6 12a8.4 8.4 0 1 0 2.46-5.94M3.6 4.4v3.8h3.8M12 7.8v4.4l3 1.8",
  scan: "M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2M7.5 12h9",
  plans: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM8 3.8v4M16 3.8v4M4 10.5h16M8 14.5h2M14 14.5h2",
  profile: "M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM5 20c.8-3.3 3.6-5.4 7-5.4s6.2 2.1 7 5.4",
  cards: "M5.5 5.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM3.5 10h17M7 14.5h3",
  send: "M7 17 17 7M8.5 7H17v8.5",
  receive: "M17 7 7 17M15.5 17H7V8.5",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.9M12 17h.01",
  chevronDown: "m7 10 5 5 5-5",
  chevronRight: "m10 6.5 5.5 5.5-5.5 5.5",
  back: "M19 12H5M11 6l-6 6 6 6",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  check: "m5 12.5 4.5 4.5L19 7.5",
  backspace: "M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 5.34l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1-1",
  share: "M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5",
  copy: "M9.5 9h8.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H9.5a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5.5 15H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h8.5a1 1 0 0 1 1 1V6",
  faceId: "M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2M9 9.5v1.2M15 9.5v1.2M12.2 9.5v3.6h-1M9.4 15.6a3.7 3.7 0 0 0 5.2 0",
  plus: "M12 5v14M5 12h14",
  external: "M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  lock: "M6.5 10.5h11a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5",
  shield: "M12 3.5 19 6v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6zM9 12l2 2 4-4",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.3 2.4 3.4 5.4 3.4 9s-1.1 6.6-3.4 9c-2.3-2.4-3.4-5.4-3.4-9S9.7 5.4 12 3z",
  paste: "M9 4.5h6M9 4.5a1 1 0 0 0-1 1V6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-.5a1 1 0 0 0-1-1M8 5.5H6.5a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H16",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  logout: "M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14M10 16l-4-4 4-4M6 12h10",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  repeat: "M17 3.5 20 6.5l-3 3M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 0 1-4 4H4",
  phone: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2",
  install: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5zM16 14h.01",
  trendUp: "M4 16.5 9.5 11l3.5 3.5L20 7.5M14.5 7.5H20V13",
  store: "M4 9.5 5.5 4.5h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5",
  bag: "M6.2 8h11.6l.9 10.6a1.5 1.5 0 0 1-1.5 1.6H6.8a1.5 1.5 0 0 1-1.5-1.6zM9 10.5V7a3 3 0 0 1 6 0v3.5",
  calendar: "M6.5 5.5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2zM8.5 3.8v3.4M15.5 3.8v3.4M4.5 10h15",
  /* The floating nav, drawn after the reference's set. */
  navHome:
    "M4.6 10.4c0-.7.3-1.3.8-1.7l5.3-4.3a2 2 0 0 1 2.6 0l5.3 4.3c.5.4.8 1 .8 1.7v7.1a2.5 2.5 0 0 1-2.5 2.5H7.1a2.5 2.5 0 0 1-2.5-2.5zM9 14.2c1.7 1.5 4.3 1.5 6 0",
  navActivity: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7.3 12.4l2.3 2.4 3.6-5.2 3.5 4",
  navCards: "M7 4.5h10a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 16V8A3.5 3.5 0 0 1 7 4.5zM3.5 10h17M3.5 14h17",
  navPay:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.3 9.7c-.3-.9-1.2-1.5-2.3-1.5-1.3 0-2.3.7-2.3 1.8 0 2.4 4.7 1.3 4.7 3.9 0 1.1-1 1.9-2.4 1.9-1.2 0-2.1-.6-2.4-1.5M12 6.7v1.5M12 15.8v1.5",
  navProfile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM6.7 18.4c1.2-2 3-3 5.3-3s4.1 1 5.3 3",
} as const;

export type IconName = keyof typeof paths | "star";

/** The Polaris mark: a four-point star. */
const STAR = "M12 1.8C12.9 8.1 15.9 11.1 22.2 12 15.9 12.9 12.9 15.9 12 22.2 11.1 15.9 8.1 12.9 1.8 12 8.1 11.1 11.1 8.1 12 1.8Z";

export function Icon({
  name,
  size = 22,
  className,
  strokeWidth = 1.75,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Give a title only when the icon stands alone and carries meaning. */
  title?: string;
}) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  if (name === "star") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...a11y}>
        <path d={STAR} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...a11y}
    >
      <path d={paths[name]} />
    </svg>
  );
}
