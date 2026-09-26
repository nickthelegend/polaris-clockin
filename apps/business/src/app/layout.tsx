import type { Metadata, Viewport } from "next";

import "@fontsource-variable/inter";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "Polaris for Business",
    template: "%s · Polaris for Business",
  },
  description:
    "Payment links with credit built in. Take payments in full, in four instalments or on a subscription, and get paid in dollars in under a second.",
  applicationName: "Polaris for Business",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eff1f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1016" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
