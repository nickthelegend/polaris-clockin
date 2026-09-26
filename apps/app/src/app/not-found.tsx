import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-[64px] leading-none font-bold tracking-[-0.05em]">404</p>
      <h1 className="mt-4 text-[20px] font-medium">This link doesn&apos;t go anywhere</h1>
      <p className="mt-2 max-w-[30ch] text-[15px] text-muted">
        It may have expired, or part of it went missing. Ask whoever sent it for a new one.
      </p>
      <Link
        href="/"
        className="press mt-8 inline-flex h-14 items-center rounded-btn bg-cta px-8 text-[16px] font-medium text-on-cta"
      >
        Go to Polaris
      </Link>
    </main>
  );
}
