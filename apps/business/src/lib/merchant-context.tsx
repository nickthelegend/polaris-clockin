"use client";

import { createContext, useContext } from "react";

import type { Merchant } from "./data/types";

type MerchantContextValue = {
  merchant: Merchant;
  /** Load /api/me again (after naming the business, or once the wallet exists). */
  refresh: () => void;
};

export const MerchantContext = createContext<MerchantContextValue | null>(null);

/** The signed-in merchant. Only available inside the dashboard frame. */
export function useMerchant(): MerchantContextValue {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error("useMerchant must be used inside the dashboard layout");
  return ctx;
}
