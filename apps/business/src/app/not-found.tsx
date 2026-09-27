import { Button, Logo } from "@polaris/ui";
import Link from "next/link";

export const metadata = { title: "Page not found" };

/** The 404: dark, the team's wordmark, a way back. No Privy mounted here. */
export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div aria-hidden className="glow-lime pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2" />
      <div className="relative grid max-w-[520px] justify-items-center gap-6 text-center">
        <Link href="/" aria-label="Polaris for Business">
          <Logo height={36} />
        </Link>
        <p className="ui-figure text-[88px] leading-none font-bold tracking-[-0.05em] text-ui-text/90">404</p>
        <div className="grid gap-2">
          <h1 className="text-[28px] leading-tight font-medium tracking-[-0.03em]">This page doesn&rsquo;t exist</h1>
          <p className="text-[16px] leading-relaxed text-ui-muted">
            The address may be mistyped, or the page moved. The dashboard now lives at /dashboard.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="lime" size="md">
            <Link href="/dashboard">Open the dashboard</Link>
          </Button>
          <Button asChild variant="outline" size="md">
            <Link href="/">Polaris for Business</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
