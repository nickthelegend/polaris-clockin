"use client";

import QRCode from "qrcode";
import { useMemo } from "react";
import { cx } from "./ui";

/**
 * A QR code drawn as one SVG path, dark on white in both themes (scanners
 * want the contrast), with the Polaris star in a quiet zone at the centre.
 * Error correction "Q" leaves room for the mark.
 */
export function QrCode({
  value,
  size = 200,
  label,
  className,
}: {
  value: string;
  size?: number;
  /** What the code opens, for screen readers. */
  label: string;
  className?: string;
}) {
  const drawn = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "Q" });
      const n = qr.modules.size;
      const centre = Math.floor(n / 2);
      const clear = Math.max(2, Math.round(n * 0.1));
      let d = "";
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (!qr.modules.get(row, col)) continue;
          if (Math.abs(row - centre) <= clear && Math.abs(col - centre) <= clear) continue;
          d += `M${col} ${row}h1v1h-1z`;
        }
      }
      return { d, n, clear };
    } catch {
      return null;
    }
  }, [value]);

  if (!drawn) return null;
  const { d, n, clear } = drawn;
  const pad = 2;
  const view = n + pad * 2;
  const c = n / 2;
  const r = clear + 0.6;
  return (
    <div className={cx("inline-block rounded-[20px] bg-white p-3", className)}>
      <svg
        viewBox={`${-pad} ${-pad} ${view} ${view}`}
        width={size}
        height={size}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
      >
        <path d={d} fill="#0b0b0b" />
        <g shapeRendering="geometricPrecision">
          <circle cx={c} cy={c} r={r} fill="#b3de00" />
          <path
            transform={`translate(${c - r * 0.62} ${c - r * 0.62}) scale(${(r * 1.24) / 24})`}
            d="M12 1.8C12.9 8.1 15.9 11.1 22.2 12 15.9 12.9 12.9 15.9 12 22.2 11.1 15.9 8.1 12.9 1.8 12 8.1 11.1 11.1 8.1 12 1.8Z"
            fill="#0b0b0b"
          />
        </g>
      </svg>
    </div>
  );
}
