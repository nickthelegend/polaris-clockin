import { describe, expect, it } from "vitest";

import { PolarisSignatureVerificationError } from "@/lib/polaris-sdk/errors";
import { computeSignature, verify } from "@/lib/polaris-sdk/webhooks";

import { SECRET, event, signed } from "./helpers";

const body = JSON.stringify(
  event("payment.succeeded", { orderId: "hc_x", paymentId: "pay_1", amount: "349.00", currency: "USD", mode: "now" }),
);

function reason(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof PolarisSignatureVerificationError ? e.reason : `unexpected: ${(e as Error).message}`;
  }
}

describe("webhooks.verify", () => {
  it("accepts a delivery signed with the secret, and returns the event", () => {
    const parsed = verify(body, signed(body), SECRET);
    expect(parsed.type).toBe("payment.succeeded");
    expect(parsed.data).toMatchObject({ orderId: "hc_x", amount: "349.00" });
  });

  it("accepts a raw Uint8Array body", () => {
    expect(verify(new TextEncoder().encode(body), signed(body), SECRET).type).toBe("payment.succeeded");
  });

  it("rejects a tampered body", () => {
    const tampered = body.replace('"349.00"', '"1.00"');
    expect(reason(() => verify(tampered, signed(body), SECRET))).toBe("signature_mismatch");
  });

  it("rejects a signature made with another secret", () => {
    expect(reason(() => verify(body, signed(body, "whsec_someone_else"), SECRET))).toBe("signature_mismatch");
  });

  it("rejects a stale delivery, outside the five-minute window (a replay of a captured request)", () => {
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(reason(() => verify(body, signed(body, SECRET, old), SECRET))).toBe("timestamp_outside_tolerance");
  });

  it("rejects a timestamp from the future too", () => {
    const future = Math.floor(Date.now() / 1000) + 400;
    expect(reason(() => verify(body, signed(body, SECRET, future), SECRET))).toBe("timestamp_outside_tolerance");
  });

  it("can't be rescued by re-stamping a captured signature with a fresh timestamp", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const v1 = computeSignature(SECRET, old, body);
    const now = Math.floor(Date.now() / 1000);
    expect(reason(() => verify(body, `t=${now},v1=${v1}`, SECRET))).toBe("signature_mismatch");
  });

  it("rejects a missing or malformed header", () => {
    expect(reason(() => verify(body, null, SECRET))).toBe("missing_header");
    expect(reason(() => verify(body, "v1=abc", SECRET))).toBe("malformed_header");
    expect(reason(() => verify(body, `t=${Math.floor(Date.now() / 1000)}`, SECRET))).toBe("no_signatures");
    expect(reason(() => verify(body, `t=${Math.floor(Date.now() / 1000)},v1=not-hex`, SECRET))).toBe("signature_mismatch");
  });

  it("accepts any matching v1 while a secret is being rolled", () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${computeSignature("whsec_old", t, body)},v1=${computeSignature(SECRET, t, body)}`;
    expect(verify(body, header, SECRET).id).toBeTruthy();
  });

  it("refuses to verify without a secret", () => {
    expect(reason(() => verify(body, signed(body), ""))).toBe("missing_secret");
  });

  it("rejects a signed body that isn't a Polaris event", () => {
    const junk = JSON.stringify({ hello: "world" });
    expect(reason(() => verify(junk, signed(junk), SECRET))).toBe("invalid_payload");
    expect(reason(() => verify("not json", signed("not json"), SECRET))).toBe("invalid_payload");
  });
});
