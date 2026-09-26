import { Wordmark } from "./brand";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Create a Privy app",
    body: (
      <>
        At <span className="machine">dashboard.privy.io</span>, create an app and turn on the{" "}
        <strong className="font-medium">Email</strong> and <strong className="font-medium">Google</strong> login
        methods. Add this site&rsquo;s origin to the app&rsquo;s allowed domains.
      </>
    ),
  },
  {
    title: "Add its keys to apps/business/.env.local",
    body: (
      <pre className="machine mt-1 overflow-x-auto rounded-[14px] bg-field p-4 text-[12.5px] leading-[1.7] ring-1 ring-inset ring-line">
        {`NEXT_PUBLIC_PRIVY_APP_ID=your-app-id
PRIVY_APP_SECRET=your-app-secret`}
      </pre>
    ),
  },
  {
    title: "Restart the dev server",
    body: (
      <>
        <span className="machine">pnpm --filter @polaris/business dev</span>. Public variables are read at build
        time, so a deployed build needs a rebuild instead.
      </>
    ),
  },
];

/**
 * Shown on every route when NEXT_PUBLIC_PRIVY_APP_ID is unset. The dashboard
 * can't run without sign-in, so this says exactly what to configure rather
 * than failing inside PrivyProvider.
 */
export function SetupScreen() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[1080px] content-center gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
      <div className="grid content-start gap-5">
        <Wordmark size={30} />
        <h1 className="page-title max-w-[16ch] text-[34px]">Connect Privy to open the dashboard</h1>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted">
          Merchants sign in with Privy, by email or Google, and each gets an embedded payout wallet on Monad. This
          build has no Privy app ID yet, so there is nothing to sign in with.
        </p>
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-muted">
          Every other variable is optional. <span className="machine">apps/business/README.md</span> lists them all.
        </p>
      </div>

      <ol className="panel grid gap-0 p-2">
        {STEPS.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-[16px] p-4">
            <span
              aria-hidden
              className="figure grid size-7 place-items-center rounded-full bg-ink text-[13px] font-semibold text-on-ink"
            >
              {i + 1}
            </span>
            <div className="grid min-w-0 gap-1.5">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{step.title}</h2>
              <div className="text-[13.5px] leading-relaxed text-muted">{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
