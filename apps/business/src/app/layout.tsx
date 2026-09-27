import type { Metadata, Viewport } from "next";

import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

import { Icons } from "@/components/app/icons";

export const metadata: Metadata = {
  title: {
    default: "Polaris for Business",
    template: "%s · Polaris for Business",
  },
  description:
    "Payment links with credit built in. Take payments in full, in four instalments or on a subscription, and get paid in dollars in under a second.",
  applicationName: "Polaris for Business",
};

export const viewport: Viewport = {
  themeColor: "#121418",
  colorScheme: "dark",
};

/**
 * The root: ref E's theme (a dark panel on a lime canvas, docs/design/system.md),
 * Satoshi, the library's tokens. No sign-in here: Privy mounts
 * in the (privy) group (landing, /login, /dashboard), so the 404 page and the
 * gallery render without it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="ref-e">
      <body className="ui-root">
        <Icons>{children}</Icons>
      </body>
    </html>
  );
}
