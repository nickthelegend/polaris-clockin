import { describe, expect, it } from "vitest";

import { salesSeries, type SeriesFrame } from "@/lib/data/analytics";
import { createSampleBook, SAMPLE_MERCHANT } from "@/lib/data/sample";

/**
 * The Overview's line (ref E): a smoothed running total over the chart's own
 * window, so it starts at zero, never dips, and ends at the headline figure.
 */

const NOW = Date.UTC(2026, 8, 27, 15, 7);

describe("salesSeries", () => {
  const { payments } = createSampleBook(SAMPLE_MERCHANT, NOW);

  it.each<SeriesFrame>(["1h", "24h", "1w", "1m"])("is a running total at %s: 0 at the left edge, monotone, ending at the gross", (frame) => {
    const s = salesSeries(payments, frame, { now: NOW });
    const values = s.points.map((p) => p.value);
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(s.grossCents / 100);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
  });

  it("has sales in the sample day, so the 24h line rises from 0 to the headline", () => {
    const s = salesSeries(payments, "24h", { now: NOW });
    expect(s.grossCents).toBeGreaterThan(0);
    expect(s.points.at(-1)!.value).toBe(s.grossCents / 100);
    expect(s.candles.length).toBeGreaterThan(0);
  });

  it("ends at the gross for one sale placed in the window", () => {
    const sale = { ...payments.find((p) => p.status === "succeeded")!, id: "x", amountCents: 12_34, createdAt: new Date(NOW - 3 * 3_600_000).toISOString() };
    const s = salesSeries([sale], "24h", { now: NOW });
    expect(s.grossCents).toBe(12_34);
    expect(s.points[0]!.value).toBe(0);
    expect(s.points.at(-1)!.value).toBe(12.34);
  });
});
