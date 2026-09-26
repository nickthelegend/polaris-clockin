"use client";

import { ChevronRight, KeyRound, Send, TriangleAlert, Webhook } from "lucide-react";
import { useState } from "react";

import {
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  InlineMessage,
  PageHeader,
  Skeleton,
  Status,
  TextInput,
  cx,
} from "@/components/ui";
import {
  DataError,
  WEBHOOK_EVENTS,
  type ApiKey,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
  type WebhooksState,
} from "@/lib/data";
import { formatAgo, formatDate, formatDateTime } from "@/lib/data/format";
import { useDashboardData, useQuery } from "@/lib/session";

function message(err: unknown, fallback: string) {
  return err instanceof DataError || err instanceof Error ? err.message : fallback;
}

export function DevelopersView() {
  return (
    <>
      <PageHeader
        title="Developers"
        description="Take payments from your own site or app: create a checkout session on your server, send the buyer to it, and hear back by webhook. Everything here is test mode on Monad testnet."
      />
      <div className="grid gap-4">
        <ApiKeysPanel />
        <SnippetPanel />
        <WebhooksPanel />
      </div>
    </>
  );
}

/* ── A secret, shown once ───────────────────────────────────────────────── */

function RevealOnce({ title, secret, onDone, children }: { title: string; secret: string; onDone: () => void; children: React.ReactNode }) {
  return (
    <div role="status" className="arrive grid gap-3 rounded-[18px] bg-key p-4 ring-1 ring-inset ring-line-strong">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <TriangleAlert className="size-4 text-warn-text" aria-hidden />
        {title}
      </p>
      <p className="text-[13px] leading-relaxed text-muted">{children}</p>
      <div className="flex min-w-0 items-center gap-2 rounded-[14px] bg-field p-1.5 pl-3.5 ring-1 ring-inset ring-line-strong">
        <code className="machine min-w-0 flex-1 truncate text-[13px]" title={secret}>
          {secret}
        </code>
        <CopyButton value={secret} label="Copy" variant="primary" />
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={onDone}>
          I&rsquo;ve saved it
        </Button>
      </div>
    </div>
  );
}

/* ── API keys ───────────────────────────────────────────────────────────── */

function ApiKeysPanel() {
  const data = useDashboardData();
  const { data: keys, error, loading, reload, mutate } = useQuery((d) => d.listApiKeys());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; name: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name the key after where it will live, like “Production server”.");
      return;
    }
    setBusy(true);
    try {
      const created = await data.createApiKey({ name: name.trim() });
      mutate((current) => [created.key, ...(current ?? [])]);
      setRevealed({ secret: created.secret, name: created.key.name });
      setName("");
    } catch (err) {
      setFormError(message(err, "We couldn't create the key. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="keys-title" className="panel min-w-0 p-5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-end">
        <div className="grid gap-1">
          <h2 id="keys-title" className="section-title flex items-center gap-2">
            <KeyRound className="size-[18px]" aria-hidden />
            API keys
          </h2>
          <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
            The publishable key (<span className="machine text-text">pk_test_…</span>) is safe in a browser. The secret key
            (<span className="machine text-text">sk_test_…</span>) creates checkout sessions from your server; we show it
            once and keep only a hash.
          </p>
        </div>
        <form onSubmit={create} noValidate className="grid gap-2">
          <label htmlFor="key-name" className="text-[13px] font-medium">
            New key
          </label>
          <div className="flex gap-2">
            <TextInput
              id="key-name"
              placeholder="Production server"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              invalid={Boolean(formError)}
              aria-describedby={formError ? "key-name-error" : undefined}
            />
            <Button type="submit" loading={busy} className="h-11">
              Create
            </Button>
          </div>
          {formError ? (
            <p id="key-name-error" role="alert" className="text-[12.5px] text-danger-text">
              {formError}
            </p>
          ) : null}
        </form>
      </div>

      {revealed ? (
        <div className="mt-5">
          <RevealOnce title={`Copy the secret key for “${revealed.name}” now`} secret={revealed.secret} onDone={() => setRevealed(null)}>
            This is the only time it&rsquo;s shown. We store a hash of it, so if you lose it, create a new key.
          </RevealOnce>
        </div>
      ) : null}

      <div className="-mx-2 mt-5 overflow-x-auto sm:-mx-3">
        {error && !keys ? (
          <div className="px-2">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : loading || !keys ? (
          <div className="grid gap-3 px-4 py-2">
            <Skeleton width="60%" />
            <Skeleton width="45%" />
          </div>
        ) : keys.length === 0 ? (
          <EmptyState title="No keys yet">
            Create one above, then set it as <span className="machine text-text">POLARIS_SECRET_KEY</span> on your server.
          </EmptyState>
        ) : (
          <table className="ledger min-w-[760px]">
            <caption className="sr-only">API keys</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Publishable key</th>
                <th scope="col">Secret key</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <KeyRow key={key.id} apiKey={key} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  return (
    <tr>
      <td className="font-medium">{apiKey.name}</td>
      <td>
        <span className="flex items-center gap-1.5">
          <code className="machine max-w-[15rem] truncate text-[12.5px]" title={apiKey.publishableKey}>
            {apiKey.publishableKey}
          </code>
          <CopyButton value={apiKey.publishableKey} label={`Copy publishable key for ${apiKey.name}`} iconOnly variant="ghost" />
        </span>
      </td>
      <td>
        <code className="machine text-[12.5px] text-muted">{apiKey.secretHint}</code>
      </td>
      <td className="figure whitespace-nowrap text-muted">{formatDate(apiKey.createdAt, true)}</td>
      <td className="whitespace-nowrap text-muted">{apiKey.lastUsedAt ? formatAgo(apiKey.lastUsedAt) : "Never"}</td>
    </tr>
  );
}

/* ── The ten-line integration ───────────────────────────────────────────── */

const SNIPPET = `import { Polaris } from "polarispay-sdk";
const polaris = new Polaris(process.env.POLARIS_SECRET_KEY!);
export async function POST(req: Request) {
  const order = await req.json();
  const session = await polaris.checkout.sessions.create(
    { amount: order.total, description: order.title, modes: ["now", "later"], successUrl: "https://your.shop/thanks" },
    { idempotencyKey: order.id },
  );
  return Response.redirect(session.url, 303);
}`;

function SnippetPanel() {
  const lines = SNIPPET.split("\n");
  return (
    <section aria-labelledby="snippet-title" className="panel min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="snippet-title" className="section-title">
            Take a payment in ten lines
          </h2>
          <p className="max-w-[64ch] text-[13.5px] leading-relaxed text-muted">
            A server route that creates a checkout session and redirects the buyer to it. The buyer chooses to pay in full
            or in four; either way you&rsquo;re paid in full, and the idempotency key makes a retried order safe.
          </p>
        </div>
        <CopyButton value={SNIPPET} label="Copy code" />
      </div>

      <figure className="mt-5 overflow-hidden rounded-[18px] bg-[var(--rail)]">
        <figcaption className="flex items-center justify-between border-b border-[var(--rail-line)] px-4 py-2.5 text-[12px] text-[var(--rail-muted)]">
          <span className="machine">app/api/checkout/route.ts</span>
          <span>TypeScript</span>
        </figcaption>
        <pre className="overflow-x-auto py-4 text-[13px] leading-[1.75] text-[var(--rail-text)]">
          <code className="machine grid">
            {lines.map((line, i) => (
              <span key={i} className="grid grid-cols-[3rem_1fr]">
                <span aria-hidden className="figure pr-4 text-right text-[var(--rail-muted)] opacity-60 select-none">
                  {i + 1}
                </span>
                <span className="pr-6 whitespace-pre">{line}</span>
              </span>
            ))}
          </code>
        </pre>
      </figure>
      <p className="mt-3 text-[12.5px] text-muted">
        <span className="machine">polarispay-sdk</span> 0.3 ships this API with Monad presets. Checkout sessions from the
        API arrive with the gateway.
      </p>
    </section>
  );
}

/* ── Webhooks ───────────────────────────────────────────────────────────── */

const DEFAULT_EVENTS: WebhookEventType[] = ["payment.succeeded", "plan.opened", "installment.failed", "payout.paid"];

function WebhooksPanel() {
  const data = useDashboardData();
  const { data: state, error, loading, reload, mutate } = useQuery((d) => d.listWebhooks());
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>(DEFAULT_EVENTS);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; url: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!/^https?:\/\//i.test(url.trim())) {
      setFormError("Enter the full endpoint URL, starting with https://.");
      return;
    }
    if (events.length === 0) {
      setFormError("Choose at least one event.");
      return;
    }
    setBusy(true);
    try {
      const created = await data.createWebhook({ url: url.trim(), events });
      mutate((s) => (s ? { ...s, endpoints: [...s.endpoints, created.endpoint] } : s));
      setRevealed({ secret: created.secret, url: created.endpoint.url });
      setUrl("");
    } catch (err) {
      setFormError(message(err, "We couldn't add the endpoint. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function onDelivered(delivery: WebhookDelivery) {
    mutate((s: WebhooksState | undefined) => (s ? { ...s, deliveries: [delivery, ...s.deliveries] } : s));
  }

  return (
    <section aria-labelledby="hooks-title" className="panel min-w-0 p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 id="hooks-title" className="section-title flex items-center gap-2">
          <Webhook className="size-[18px]" aria-hidden />
          Webhooks
        </h2>
        <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-muted">
          We POST each event to your endpoint with a <span className="machine text-text">polaris-signature</span> header:
          an HMAC-SHA256 of <span className="machine text-text">timestamp.body</span> under the endpoint&rsquo;s signing
          secret. Delivery is at least once, so key on <span className="machine text-text">eventId</span>.
        </p>
      </div>

      <form onSubmit={add} noValidate className="mt-5 grid gap-4 rounded-[18px] bg-key p-4">
        <Field label="Endpoint URL" htmlFor="hook-url" error={formError}>
          <TextInput
            id="hook-url"
            type="url"
            placeholder="https://your.shop/webhooks/polaris"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            invalid={Boolean(formError)}
            aria-describedby={formError ? "hook-url-error" : undefined}
            className="machine"
          />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Events</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_EVENTS.map((event) => {
              const on = events.includes(event);
              return (
                <label
                  key={event}
                  className={cx(
                    "press inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] ring-1 ring-inset",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                    on ? "bg-ink text-on-ink ring-transparent" : "bg-field text-muted ring-line-strong hover:text-text",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={(e) =>
                      setEvents((current) =>
                        e.target.checked ? WEBHOOK_EVENTS.filter((x) => x === event || current.includes(x)) : current.filter((x) => x !== event),
                      )
                    }
                  />
                  <span className="machine">{event}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div>
          <Button type="submit" loading={busy}>
            Add endpoint
          </Button>
        </div>
      </form>

      {revealed ? (
        <div className="mt-4">
          <RevealOnce title="Copy this endpoint's signing secret now" secret={revealed.secret} onDone={() => setRevealed(null)}>
            Your receiver verifies every delivery with it. It&rsquo;s shown once, for{" "}
            <span className="machine text-text">{revealed.url}</span>.
          </RevealOnce>
        </div>
      ) : null}

      <div className="mt-6">
        {error && !state ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading || !state ? (
          <Skeleton width="50%" />
        ) : state.endpoints.length === 0 ? (
          <EmptyState title="No endpoints yet">
            Add one above to hear about payments, plans and payouts as they happen. Send it a test event before going live.
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {state.endpoints.map((endpoint) => (
              <EndpointRow key={endpoint.id} endpoint={endpoint} onDelivered={onDelivered} />
            ))}
          </ul>
        )}
      </div>

      {state && state.endpoints.length > 0 ? <DeliveryLog deliveries={state.deliveries} /> : null}
    </section>
  );
}

function EndpointRow({ endpoint, onDelivered }: { endpoint: WebhookEndpoint; onDelivered: (d: WebhookDelivery) => void }) {
  const data = useDashboardData();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function sendTest() {
    setBusy(true);
    setResult(null);
    try {
      const delivery = await data.sendTestEvent(endpoint.id);
      onDelivered(delivery);
      setResult({ tone: "success", text: "Signed a test payment.succeeded event. It's in the delivery log below." });
    } catch (err) {
      setResult({ tone: "error", text: message(err, "We couldn't send the test event.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 rounded-[16px] p-4 ring-1 ring-inset ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <code className="machine truncate text-[13.5px] text-text" title={endpoint.url}>
            {endpoint.url}
          </code>
          <p className="text-[12.5px] text-muted">
            {endpoint.events.length} {endpoint.events.length === 1 ? "event" : "events"} · secret{" "}
            <span className="machine">{endpoint.secretHint}</span> · added {formatDate(endpoint.createdAt)}
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={busy} onClick={sendTest} icon={<Send className="size-3.5" aria-hidden />}>
          Send test event
        </Button>
      </div>
      {result ? <InlineMessage tone={result.tone}>{result.text}</InlineMessage> : null}
    </li>
  );
}

function DeliveryLog({ deliveries }: { deliveries: WebhookDelivery[] }) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Delivery log</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Test events are signed exactly as live ones will be, and logged here with the request we&rsquo;d send. Sending
        them to your endpoint starts with live events.
      </p>
      {deliveries.length === 0 ? (
        <p className="py-8 text-center text-[13.5px] text-muted">Nothing delivered yet. Send a test event to an endpoint.</p>
      ) : (
        <ul className="mt-3 grid">
          {deliveries.map((d) => (
            <li key={d.id} className="border-b border-line last:border-0">
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-1 py-3 hover:bg-[color-mix(in_oklab,var(--text)_2.5%,transparent)] [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden />
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="machine text-[13px] text-text">{d.event}</span>
                    <span className="machine truncate text-[12px] text-muted">{d.url}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {d.simulated ? (
                      <Status tone="muted">Signed, not sent</Status>
                    ) : d.status && d.status < 300 ? (
                      <Status tone="neutral">{d.status}</Status>
                    ) : (
                      <Status tone="danger">{d.status ?? "No response"}</Status>
                    )}
                    <span className="figure hidden text-[12.5px] text-muted sm:inline">{formatDateTime(d.createdAt)}</span>
                  </span>
                </summary>
                <div className="grid gap-3 pb-4 pl-7">
                  <div className="grid gap-1">
                    <p className="text-[12px] text-muted">Headers</p>
                    <pre className="machine overflow-x-auto rounded-[12px] bg-key p-3 text-[12px] leading-relaxed">
                      {Object.entries(d.request.headers)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("\n")}
                    </pre>
                  </div>
                  <div className="grid gap-1">
                    <p className="text-[12px] text-muted">Body</p>
                    <pre className="machine overflow-x-auto rounded-[12px] bg-key p-3 text-[12px] leading-relaxed">
                      {JSON.stringify(JSON.parse(d.request.body), null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
