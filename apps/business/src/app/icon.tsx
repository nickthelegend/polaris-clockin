import { ImageResponse } from "next/og";

import { STAR_PATH } from "@/components/brand";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** The lime star on ink, as the consumer app's icon, with the Business chip's lime. */
export default function Icon() {
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
          borderRadius: 14,
        }}
      >
        <svg width={42} height={42} viewBox="0 0 24 24">
          <path d={STAR_PATH} fill="#b3de00" />
        </svg>
      </div>
    ),
    size,
  );
}
