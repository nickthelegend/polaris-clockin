"use client";

import { addRpcUrlOverrideToChain, PrivyProvider } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { monad, monadTestnet } from "viem/chains";

import { SetupScreen } from "@/components/setup-screen";
import { ThemeProvider, useTheme } from "@/components/theme";
import { Wordmark } from "@/components/brand";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;
const TESTNET_RPC = process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC || "";

// Point the embedded wallet at our own RPC when we have one; Privy has no
// hosted RPC for Monad testnet, and the public one is rate-limited.
const testnet = TESTNET_RPC ? addRpcUrlOverrideToChain(monadTestnet, TESTNET_RPC) : monadTestnet;

function Privy({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  return (
    <PrivyProvider
      appId={APP_ID}
      clientId={CLIENT_ID}
      config={{
        loginMethods: ["email", "google"],
        // Every merchant gets a self-custodial payout wallet on day one.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: testnet,
        supportedChains: [testnet, monad],
        appearance: {
          theme: resolved,
          accentColor: resolved === "dark" ? "#B3DE00" : "#111111",
          logo: <Wordmark size={26} />,
          landingHeader: "Sign in to Polaris for Business",
          loginMessage: "Payment links with credit built in. Paid in full, in dollars, in under a second.",
          walletChainType: "ethereum-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

/**
 * Without a Privy app ID there is nothing to sign in with, so every route
 * renders the setup screen instead of crashing inside PrivyProvider. This is
 * also what `next build` prerenders when the variable is unset.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // The component gallery is public and self-contained: no Privy, no setup gate.
  const standalone = usePathname()?.startsWith("/gallery") ?? false;
  if (standalone) return <ThemeProvider>{children}</ThemeProvider>;
  return <ThemeProvider>{APP_ID ? <Privy>{children}</Privy> : <SetupScreen />}</ThemeProvider>;
}
