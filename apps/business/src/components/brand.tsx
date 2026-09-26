/** The Polaris star: the same path the consumer app uses for its icon. */
export const STAR_PATH =
  "M12 1.8C12.9 8.1 15.9 11.1 22.2 12 15.9 12.9 12.9 15.9 12 22.2 11.1 15.9 8.1 12.9 1.8 12 8.1 11.1 11.1 8.1 12 1.8Z";

export function Star({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={STAR_PATH} fill="#b3de00" />
    </svg>
  );
}

/**
 * "Polaris" plus the lime "Business" chip. The chip is the consumer app's
 * balance-label chip, carried over as the one mark that tells the two apps
 * apart.
 */
export function Wordmark({ size = 24, tone = "text" }: { size?: number; tone?: "text" | "rail" }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Polaris for Business">
      <span
        aria-hidden="true"
        className="wordmark"
        style={{ fontSize: size, color: tone === "rail" ? "var(--rail-text)" : "var(--text)" }}
      >
        Polaris
      </span>
      <span
        aria-hidden="true"
        className="rounded-full bg-lime px-2 py-[3px] text-[11px] leading-none font-semibold tracking-[-0.01em] text-[#111]"
      >
        Business
      </span>
    </span>
  );
}
