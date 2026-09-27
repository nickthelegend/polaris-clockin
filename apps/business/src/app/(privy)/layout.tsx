import { Toaster } from "@polaris/ui";

import { AuthProvider } from "@/components/auth/auth-provider";
import { DataProvider } from "@/lib/session";

/**
 * The landing, /login and /dashboard: everything that needs to know who is
 * signed in. Privy mounts here and nowhere else.
 */
export default function PrivyLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>{children}</DataProvider>
      {/* Above the phone's floating nav bar; bottom right from 768px. */}
      <Toaster className="pb-[calc(92px+env(safe-area-inset-bottom))] md:pb-6" />
    </AuthProvider>
  );
}
