import { brandMark } from "@/lib/brand-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return brandMark(64, { starScale: 0.66 });
}
