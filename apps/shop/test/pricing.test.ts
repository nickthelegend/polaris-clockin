import { quotePayIn4 } from "polarispay-sdk";
import { describe, expect, it } from "vitest";

import { payInFourApr } from "@/lib/polaris";

describe("Pay in 4 pricing the store advertises", () => {
  it("is interest-free by default: $349 is 4 × $87.25", () => {
    const quote = quotePayIn4("349.00", { aprBps: payInFourApr({}) });
    expect(quote.each).toBe("87.25");
    expect(quote.interestFree).toBe(true);
  });

  it("follows POLARIS_PAY_IN_4_APR_BPS: at the loan engine's 10%, $200 is 4 × $50.38", () => {
    const quote = quotePayIn4("200.00", { aprBps: payInFourApr({ POLARIS_PAY_IN_4_APR_BPS: "1000" }) });
    expect(quote.each).toBe("50.38");
    expect(quote.interest).toBe("1.53");
  });

  it("ignores a nonsense setting", () => {
    expect(payInFourApr({ POLARIS_PAY_IN_4_APR_BPS: "lots" })).toBe(0);
    expect(payInFourApr({ POLARIS_PAY_IN_4_APR_BPS: "20000" })).toBe(0);
  });
});
