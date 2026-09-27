import { AppFrame, Button, PrimaryButton, TopNav } from "@polaris/ui";
import { CircleHelp, CodeXml, House, LogIn, Tag } from "lucide-react";
import Link from "next/link";

import { BusinessLogo } from "@/components/app/brand";

export const metadata = { title: "Page not found" };

const NAV = [
  { key: "home", label: "Home", href: "/", icon: <House /> },
  { key: "developers", label: "Developers", href: "/#developers", icon: <CodeXml /> },
  { key: "pricing", label: "Pricing", href: "/#pricing", icon: <Tag /> },
  { key: "faq", label: "FAQ", href: "/#faq", icon: <CircleHelp /> },
];

/**
 * The 404, in ref E's frame like every other page: the panel on the lime
 * canvas, the landing's top nav, and the way back in the middle. No Privy
 * mounted here.
 */
export default function NotFound() {
  const signIn = (
    <PrimaryButton asChild size="sm" iconRight={<LogIn />}>
      <a href="/login">Sign in</a>
    </PrimaryButton>
  );
  return (
    <AppFrame panelClassName="flex flex-col">
      <TopNav
        brand={<BusinessLogo height={30} />}
        brandHref="/"
        brandLabel="Polaris for Business, home"
        items={NAV}
        linkAs="a"
        contained
        sheetTitle="Polaris for Business"
        actions={signIn}
        compactActions={signIn}
      />
      <main className="grid flex-1 place-items-center px-4 pt-6 pb-20">
        <div className="grid max-w-[520px] justify-items-center gap-6 text-center">
          <p className="ui-figure text-[96px] leading-none font-medium tracking-[-0.06em] text-ui-lime-active sm:text-[120px]">404</p>
          <div className="grid gap-2">
            <h1 className="text-[28px] leading-tight font-medium tracking-[-0.03em]">This page doesn&rsquo;t exist</h1>
            <p className="text-[16px] leading-relaxed text-ui-muted">
              The address may be mistyped, or the page moved. The dashboard now lives at /dashboard.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <PrimaryButton asChild size="md">
              <Link href="/dashboard">Open the dashboard</Link>
            </PrimaryButton>
            <Button asChild variant="outline" size="md">
              <Link href="/">Polaris for Business</Link>
            </Button>
          </div>
        </div>
      </main>
    </AppFrame>
  );
}
