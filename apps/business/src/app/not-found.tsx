import Link from "next/link";

import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[520px] content-center gap-5 px-4">
      <Wordmark size={24} />
      <h1 className="page-title">This page doesn&rsquo;t exist</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        The address may be mistyped, or the page moved. Everything in the dashboard is reachable from Home.
      </p>
      <p>
        <Link
          href="/"
          className="press inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-on-ink no-underline"
        >
          Go to Home
        </Link>
      </p>
    </main>
  );
}
