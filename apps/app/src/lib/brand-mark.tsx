import { ImageResponse } from "next/og";

const STAR = "M12 1.8C12.9 8.1 15.9 11.1 22.2 12 15.9 12.9 12.9 15.9 12 22.2 11.1 15.9 8.1 12.9 1.8 12 8.1 11.1 11.1 8.1 12 1.8Z";

/**
 * The app icon: the lime Polaris star on ink. `bleed` fills the square
 * (maskable and Apple icons, which the OS rounds itself); otherwise the
 * square has its own rounded corners.
 */
export function brandMark(size: number, opts: { bleed?: boolean; starScale?: number } = {}): ImageResponse {
  const star = Math.round(size * (opts.starScale ?? 0.58));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
          borderRadius: opts.bleed ? 0 : Math.round(size * 0.225),
        }}
      >
        <svg width={star} height={star} viewBox="0 0 24 24">
          <path d={STAR} fill="#b3de00" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
