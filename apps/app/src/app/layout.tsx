import "@fontsource-variable/inter-tight";
import "@fontsource-variable/inter-tight/wght-italic.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DesktopAside, DevSignerBadge } from "@/components/chrome";
import { DemoModeBadge } from "@/components/demo-badge";

const description = "Pay in full, in four or every month, and send dollars anywhere with a link. Just Face ID.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.polarispay.app"),
  title: { default: "Polaris", template: "%s · Polaris" },
  description,
  applicationName: "Polaris",
  appleWebApp: { capable: true, title: "Polaris", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  other: {
    // Older iOS reads only the prefixed name.
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
  openGraph: { title: "Polaris", description, siteName: "Polaris", type: "website" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Light only, like the reference.
  colorScheme: "light",
  themeColor: "#eff1f3",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only-focusable fixed top-3 left-3 z-[60] rounded-full bg-chip px-4 py-2 text-[14px] font-medium text-on-chip"
        >
          Skip to content
        </a>
        <DesktopAside />
        <div className="app-column">
          <DevSignerBadge />
          <DemoModeBadge />
          {children}
        </div>
      </body>
    </html>
  );
}
