"use client";

import { IconProvider, SheetStage, Toaster } from "@polaris/ui";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountProviders } from "@/lib/account/privy-bridge";
import { EmailLoginSheet } from "../email-login-sheet";
import { DesktopAside, DevSignerBadge } from "./chrome";
import { SheetHost } from "./sheet-host";

/**
 * The app frame. The stage is exactly the viewport and the page scrolls
 * inside it, so when a sheet pushes the stage back (scaled to 0.96 with
 * rounded corners, like iOS) the floating nav goes back with it.
 */
export function Providers({ children, sheet }: { children: ReactNode; sheet: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // The component gallery is self-contained: its own stage, no account.
  if (pathname.startsWith("/gallery")) return <>{children}</>;
  return (
    <IconProvider>
      <AccountProviders>
        <SheetStage className="h-dvh overflow-hidden">
          <SheetHost>
            <div id="scroller" className="h-full overflow-x-hidden overflow-y-auto overscroll-y-contain">
              {children}
            </div>
            {sheet}
            <EmailLoginSheet />
            <DesktopAside />
          </SheetHost>
        </SheetStage>
        <DevSignerBadge />
        <Toaster />
      </AccountProviders>
    </IconProvider>
  );
}
