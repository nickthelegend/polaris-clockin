"use client";

import { ArrowUpRight, QrCode as QrIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DownloadQrButton, QrCode } from "@/components/qr";
import {
  Button,
  ChoiceCard,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  InlineMessage,
  PageHeader,
  Pill,
  Segmented,
  Select,
  Skeleton,
  Status,
  TextInput,
  cx,
} from "@/components/ui";
import { DataError, type LinkStatus, type LinkUsage, type PayMode, type PaymentLink } from "@/lib/data";
import { formatDate, MODE_LABEL, money, parseAmount, payInFourQuote } from "@/lib/data/format";
import { useDashboardData, useQuery } from "@/lib/session";

const EXPIRY: { value: string; label: string; hours: number | null }[] = [
  { value: "never", label: "Never", hours: null },
  { value: "24h", label: "In 24 hours", hours: 24 },
  { value: "7d", label: "In 7 days", hours: 24 * 7 },
  { value: "30d", label: "In 30 days", hours: 24 * 30 },
  { value: "90d", label: "In 90 days", hours: 24 * 90 },
];

const STATUS: Record<LinkStatus, { tone: "neutral" | "muted"; label: string }> = {
  active: { tone: "neutral", label: "Active" },
  used: { tone: "muted", label: "Used" },
  expired: { tone: "muted", label: "Expired" },
};

function displayUrl(url: string) {
  return url.replace(/^https:\/\//, "");
}

export function LinksView() {
  const { data: links, error, loading, reload, mutate } = useQuery((d) => d.listLinks());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = links?.find((l) => l.id === selectedId) ?? null;

  function onCreated(link: PaymentLink) {
    mutate((current) => [link, ...(current ?? [])]);
    setSelectedId(link.id);
  }

  return (
    <>
      <PageHeader
        title="Payment links"
        description="One link takes a payment in full, in four instalments or on a subscription. Share it anywhere, or print the QR code at the counter."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="grid gap-4 xl:sticky xl:top-6">
          <CreateLinkPanel onCreated={onCreated} />
        </div>

        <div className="grid min-w-0 gap-4">
          {selected ? <SharePanel key={selected.id} link={selected} onClose={() => setSelectedId(null)} /> : null}

          <section aria-labelledby="links-title" className="panel min-w-0 p-2 sm:p-3">
            <div className="flex items-baseline justify-between px-3 pt-3 pb-3 sm:px-4">
              <h2 id="links-title" className="section-title">
                Your links
              </h2>
              {links ? <span className="figure text-[13px] text-muted">{links.length} links</span> : null}
            </div>

            {error && !links ? (
              <div className="p-2">
                <ErrorState message={error} onRetry={reload} />
              </div>
            ) : loading || !links ? (
              <LinksSkeleton />
            ) : links.length === 0 ? (
              <EmptyState title="No links yet">
                Create one on the left. It works the moment it exists: send it in a chat, put it on an invoice, or print
                the QR code.
              </EmptyState>
            ) : (
              <LinksTable links={links} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/* ── Create ─────────────────────────────────────────────────────────────── */

function CreateLinkPanel({ onCreated }: { onCreated: (link: PaymentLink) => void }) {
  const data = useDashboardData();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [modes, setModes] = useState<PayMode[]>(["now", "later"]);
  const [usage, setUsage] = useState<LinkUsage>("reusable");
  const [expiry, setExpiry] = useState("never");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cents = parseAmount(amount);
  const quote = cents ? payInFourQuote(cents) : null;

  const amountError = !touched ? null : !amount.trim() ? "Enter an amount." : cents === null ? "Enter an amount like 200 or 200.50." : cents < 100 ? "The smallest link is $1.00." : cents > 100_000_000 ? "The largest link is $1,000,000.00." : modes.includes("later") && cents < 2_000 ? "Pay in 4 needs at least $20.00." : null;
  const descriptionError = touched && !description.trim() ? "Say what the buyer is paying for." : null;
  const modesError = touched && modes.length === 0 ? "Choose at least one way to pay." : null;

  function toggle(mode: PayMode, on: boolean) {
    setModes((current) => (on ? [...new Set([...current, mode])] : current.filter((m) => m !== mode)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    setDone(null);
    const valid =
      cents !== null && cents >= 100 && cents <= 100_000_000 && description.trim() && modes.length > 0 && !(modes.includes("later") && cents < 2_000);
    if (!valid) return;

    setBusy(true);
    try {
      const link = await data.createLink({
        amountCents: cents,
        description: description.trim(),
        modes,
        usage,
        expiresInHours: EXPIRY.find((x) => x.value === expiry)?.hours ?? null,
      });
      onCreated(link);
      setDone(`Created “${link.description}”. Share it from the panel alongside.`);
      setAmount("");
      setDescription("");
      setTouched(false);
    } catch (err) {
      setServerError(err instanceof DataError ? err.message : "We couldn't create the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="create-title" className="panel p-5 sm:p-6">
      <h2 id="create-title" className="section-title">
        New link
      </h2>

      <form onSubmit={submit} noValidate className="mt-5 grid gap-5">
        <Field label="Amount" htmlFor="link-amount" error={amountError}>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] text-muted">
              $
            </span>
            <TextInput
              id="link-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="200.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              invalid={Boolean(amountError)}
              aria-describedby={amountError ? "link-amount-error" : undefined}
              className="figure pl-7 text-[16px]"
            />
          </div>
        </Field>

        <Field label="Description" htmlFor="link-description" error={descriptionError} hint="Buyers see this on the checkout and their receipt.">
          <TextInput
            id="link-description"
            maxLength={120}
            placeholder="Brand identity package"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            invalid={Boolean(descriptionError)}
            aria-describedby={descriptionError ? "link-description-error" : "link-description-hint"}
          />
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[13px] font-medium">Ways to pay</legend>
          <ChoiceCard
            id="mode-now"
            checked={modes.includes("now")}
            onChange={(on) => toggle("now", on)}
            title="Pay now"
            detail="In full. Settles to your balance in under a second."
          />
          <ChoiceCard
            id="mode-later"
            checked={modes.includes("later")}
            onChange={(on) => toggle("later", on)}
            title="Pay in 4"
            detail={
              quote ? (
                <>
                  The buyer pays <span className="figure text-text">4 × {money(quote.each)}</span> over four weeks. You
                  get <span className="figure text-text">{money(cents ?? 0)}</span> today.
                </>
              ) : (
                "Four weekly instalments for the buyer. You're paid in full today."
              )
            }
          />
          <ChoiceCard
            id="mode-subscribe"
            checked={modes.includes("subscribe")}
            onChange={(on) => toggle("subscribe", on)}
            title="Subscribe"
            detail="Charged monthly until the buyer cancels. A missed month is skipped, never doubled."
          />
          {modesError ? <InlineMessage tone="error">{modesError}</InlineMessage> : null}
        </fieldset>

        <Segmented<LinkUsage>
          label="Use"
          name="link-usage"
          value={usage}
          onChange={setUsage}
          options={[
            { value: "reusable", label: "Reusable" },
            { value: "single", label: "Single use" },
          ]}
        />

        <Field label="Expires" htmlFor="link-expiry">
          <Select id="link-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 pt-1">
          <Button type="submit" size="lg" loading={busy}>
            Create link
          </Button>
          {serverError ? <InlineMessage tone="error">{serverError}</InlineMessage> : null}
          {done ? <InlineMessage tone="success">{done}</InlineMessage> : null}
        </div>
      </form>
    </section>
  );
}

/* ── Share ──────────────────────────────────────────────────────────────── */

function SharePanel({ link, onClose }: { link: PaymentLink; onClose: () => void }) {
  const quote = link.modes.includes("later") ? payInFourQuote(link.amountCents) : null;
  const ref = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Bring the panel to the reader: "Share" is pressed in a table further down.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={ref}
      aria-labelledby="share-title"
      className="panel arrive grid gap-6 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-6"
    >
      <div className="justify-self-center sm:justify-self-start">
        <div className="rounded-[20px] bg-white p-2 ring-1 ring-line">
          <QrCode value={link.url} label={`QR code for ${displayUrl(link.url)}`} size={176} />
        </div>
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 id="share-title" ref={headingRef} tabIndex={-1} className="section-title truncate outline-none">
              {link.description}
            </h2>
            <p className="figure text-[15px] text-muted">
              {money(link.amountCents)}
              {quote ? <> · or 4 × {money(quote.each)}</> : null}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="grid gap-2">
          <p className="text-[12.5px] text-muted">Link</p>
          <div className="flex min-w-0 items-center gap-2 rounded-[14px] bg-field p-1.5 pl-3.5 ring-1 ring-inset ring-line-strong">
            <span className="machine min-w-0 flex-1 truncate text-[13.5px]" title={link.url}>
              {link.url}
            </span>
            <CopyButton value={link.url} label="Copy link" variant="primary" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {link.modes.map((m) => (
            <Pill key={m}>{MODE_LABEL[m]}</Pill>
          ))}
          <Pill>{link.usage === "single" ? "Single use" : "Reusable"}</Pill>
          <Pill>{link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : "Never expires"}</Pill>
        </div>

        <div className="flex flex-wrap gap-2">
          <DownloadQrButton value={link.url} filename={`polaris-link-${link.id}.svg`} />
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-text no-underline hover:bg-pill"
          >
            Open checkout <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── List ───────────────────────────────────────────────────────────────── */

function LinksTable({
  links,
  selectedId,
  onSelect,
}: {
  links: PaymentLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {/* Wide screens: a ledger. */}
      <div className="hidden md:block">
        <table className="ledger">
          <caption className="sr-only">Payment links</caption>
          <thead>
            <tr>
              <th scope="col">Link</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col">Ways to pay</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Paid
              </th>
              <th scope="col">
                <span className="sr-only">Share</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id} className={cx(selectedId === link.id && "bg-[color-mix(in_oklab,var(--text)_4%,transparent)]")}>
                <td className="max-w-[18rem]">
                  <span className="block truncate font-medium">{link.description}</span>
                  <span className="machine block truncate text-[12px] text-muted">{displayUrl(link.url)}</span>
                </td>
                <td className="num font-medium">{money(link.amountCents)}</td>
                <td>
                  <span className="text-[13px] text-muted">{link.modes.map((m) => MODE_LABEL[m]).join(" · ")}</span>
                  <span className="block text-[12px] text-faint">{link.usage === "single" ? "Single use" : "Reusable"}</span>
                </td>
                <td>
                  <Status tone={STATUS[link.status].tone}>{STATUS[link.status].label}</Status>
                </td>
                <td className="num">
                  <span className="block">{link.paymentsCount}</span>
                  <span className="block text-[12px] text-muted">{money(link.collectedCents)}</span>
                </td>
                <td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSelect(link.id)}
                    icon={<QrIcon className="size-3.5" aria-hidden />}
                    aria-label={`Share ${link.description}`}
                  >
                    Share
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one row per link. */}
      <ul className="grid md:hidden">
        {links.map((link) => (
          <li key={link.id} className="grid gap-2 border-b border-line px-3 py-4 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{link.description}</span>
                <span className="machine block truncate text-[12px] text-muted">{displayUrl(link.url)}</span>
              </span>
              <span className="figure shrink-0 font-medium">{money(link.amountCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Status tone={STATUS[link.status].tone}>{STATUS[link.status].label}</Status>
                <span className="figure text-[12.5px] text-muted">
                  {link.paymentsCount} paid · {link.modes.map((m) => MODE_LABEL[m]).join(" · ")}
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => onSelect(link.id)} aria-label={`Share ${link.description}`}>
                Share
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function LinksSkeleton() {
  return (
    <div className="grid gap-0 px-3 pb-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center justify-between border-b border-line py-4 last:border-0">
          <Skeleton width="40%" />
          <Skeleton width="12%" />
        </div>
      ))}
    </div>
  );
}
