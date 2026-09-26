import { useId } from "react";
import type { CountryCode } from "@/lib/data";
import { Icon, type IconName } from "./icon";
import { cx } from "./ui";

/** Small drawn flags for the badge on a person's avatar. */
function FlagArt({ code }: { code: CountryCode }) {
  switch (code) {
    case "AR":
      return (
        <>
          <rect width="30" height="20" fill="#74acdf" />
          <rect y="6.67" width="30" height="6.67" fill="#fff" />
          <circle cx="15" cy="10" r="2.2" fill="#f6b40e" />
        </>
      );
    case "BR":
      return (
        <>
          <rect width="30" height="20" fill="#009c3b" />
          <path d="M15 2.5 27 10 15 17.5 3 10z" fill="#ffdf00" />
          <circle cx="15" cy="10" r="4" fill="#002776" />
        </>
      );
    case "DE":
      return (
        <>
          <rect width="30" height="20" fill="#ffce00" />
          <rect width="30" height="13.33" fill="#dd0000" />
          <rect width="30" height="6.67" fill="#000" />
        </>
      );
    case "GB":
      return (
        <>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
          <path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" strokeWidth="1.4" />
          <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
          <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" />
        </>
      );
    case "IN":
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          <rect width="30" height="6.67" fill="#ff9933" />
          <rect y="13.33" width="30" height="6.67" fill="#138808" />
          <circle cx="15" cy="10" r="2.4" fill="none" stroke="#000080" strokeWidth="0.8" />
        </>
      );
    case "KE":
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          <rect width="30" height="6" fill="#000" />
          <rect y="7" width="30" height="6" fill="#bb0000" />
          <rect y="14" width="30" height="6" fill="#006600" />
        </>
      );
    case "MX":
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          <rect width="10" height="20" fill="#006847" />
          <rect x="20" width="10" height="20" fill="#ce1126" />
          <circle cx="15" cy="10" r="2" fill="#8c6a3f" />
        </>
      );
    case "NG":
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          <rect width="10" height="20" fill="#008751" />
          <rect x="20" width="10" height="20" fill="#008751" />
        </>
      );
    case "PH":
      return (
        <>
          <rect width="30" height="10" fill="#0038a8" />
          <rect y="10" width="30" height="10" fill="#ce1126" />
          <path d="M0 0 17 10 0 20z" fill="#fff" />
          <circle cx="5.5" cy="10" r="2" fill="#fcd116" />
        </>
      );
    case "US":
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          {[0, 2, 4, 6, 8, 10, 12].map((i) => (
            <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
          ))}
          <rect width="13" height="10.77" fill="#3c3b6e" />
        </>
      );
  }
}

const COUNTRY_NAMES: Record<CountryCode, string> = {
  AR: "Argentina",
  BR: "Brazil",
  DE: "Germany",
  GB: "United Kingdom",
  IN: "India",
  KE: "Kenya",
  MX: "Mexico",
  NG: "Nigeria",
  PH: "Philippines",
  US: "United States",
};

export function countryName(code: CountryCode): string {
  return COUNTRY_NAMES[code];
}

export function Flag({ code, size = 16, className }: { code: CountryCode; size?: number; className?: string }) {
  const clip = `flag${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cx("rounded-full", className)}
      role="img"
      aria-label={COUNTRY_NAMES[code]}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="10" cy="10" r="10" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <g transform="translate(-5 0)">
          <FlagArt code={code} />
        </g>
      </g>
    </svg>
  );
}

const TINTS = ["#b3de00", "#e0a33b", "#5b9bd5", "#d46a7e", "#6baa8b", "#9a86d8"];

function tintFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * People get tinted initials and a flag badge; merchants a monogram on grey;
 * Polaris itself (money added, a link) a lime disc with an icon.
 */
export function Avatar({
  name,
  kind = "person",
  country,
  icon,
  size = 48,
  className,
}: {
  name: string;
  kind?: "person" | "merchant" | "polaris";
  country?: CountryCode | undefined;
  icon?: IconName;
  size?: number;
  className?: string;
}) {
  const badge = Math.round(size * 0.36);
  return (
    <span className={cx("relative inline-grid shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      {kind === "polaris" ? (
        <span className="grid size-full place-items-center rounded-full bg-lime text-on-lime">
          <Icon name={icon ?? "star"} size={Math.round(size * 0.44)} />
        </span>
      ) : kind === "merchant" ? (
        <span
          className="grid size-full place-items-center rounded-full bg-pill font-display font-bold tracking-[-0.03em] text-fg"
          style={{ fontSize: size * 0.4 }}
        >
          {name.trim()[0]?.toUpperCase()}
        </span>
      ) : (
        <span
          className="grid size-full place-items-center rounded-full font-semibold tracking-[-0.02em] text-fg"
          style={{
            fontSize: size * 0.34,
            background: `color-mix(in oklab, ${tintFor(name)} 34%, var(--surface))`,
          }}
        >
          {initials(name)}
        </span>
      )}
      {country ? (
        <span
          className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-surface p-[2px]"
          style={{ width: badge + 4, height: badge + 4 }}
        >
          <Flag code={country} size={badge} />
        </span>
      ) : null}
    </span>
  );
}
