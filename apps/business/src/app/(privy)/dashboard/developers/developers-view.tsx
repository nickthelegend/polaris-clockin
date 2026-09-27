"use client";

import {
  Badge,
  Button,
  Chip,
  CodeBlock,
  CopyButton,
  DetailsList,
  Dialog,
  Drawer,
  EmptyState,
  Input,
  Menu,
  Notice,
  Skeleton,
  Toggle,
  toast,
} from "@polaris/ui";
import { KeyRound, MoreHorizontal, Pencil, Plus, Send, Store, Trash2, TriangleAlert, Webhook } from "lucide-react";
import { useState } from "react";

import { SampleBadge, LoadError, Panel, StaleNotice, useNow } from "@/components/dashboard/common";
import { DemoShopButton } from "@/components/landing/demo-shop";
import { developers as sdk } from "@/components/landing/content";
import { DashboardHeader } from "@/components/shell/dashboard-shell";
import { DEV_MOCK_SAMPLE } from "@/lib/auth-context";
import { DataError, errorMessage, WEBHOOK_EVENTS, type ApiKey, type WebhookDelivery, type WebhookEndpoint, type WebhookEventType } from "@/lib/data";
import { SERVER_DEMO_DATA } from "@/lib/data/demo";
import { formatAgo, formatDate, formatDateTime } from "@/lib/data/format";
import { CHECKOUT_API_LIVE } from "@/lib/features";
import { useDashboardData, useQuery, type QueryState } from "@/lib/session";

const KEYS_BLOCKER = "API keys authenticate the checkout-session API, which isn't served yet. Creating keys opens with it.";

export function DevelopersView() {
  // Keys and webhooks are the merchant's own; sample only in the mock session or on a demo server.
  const sample = DEV_MOCK_SAMPLE || SERVER_DEMO_DATA;
  return (
    <>
      <DashboardHeader
        title="Developers"
        description="Take payments from your own site or app: create a checkout session on your server, send the buyer to it, and hear back by signed webhook. Everything is test mode on Monad testnet."
        actions={<DemoShopButton label="See the demo shop" icon={<Store />} variant="outline" size="md" />}
      />
      <div className="grid gap-4">
        <ApiKeysPanel sample={sample} />
        <WebhooksPanel sample={sample} />
        <Panel title="Ten lines of code" subtitle="The integration, with polarispay-sdk">
          {!CHECKOUT_API_LIVE ? (
            <Notice tone="info" size="sm" className="mt-4">
              A preview of polarispay-sdk 0.3, which ships with the checkout API. The copy button appears when it runs against
              this dashboard.
            </Notice>
          ) : null}
          <CodeBlock
            className="mt-4"
            aria-label="SDK example"
            note={CHECKOUT_API_LIVE ? undefined : sdk.note}
            copyable={CHECKOUT_API_LIVE}
            defaultKey="node"
            samples={sdk.samples.map((s) => ({ ...s }))}
          />
        </Panel>
      </div>
    </>
  );
}

/* ── A secret, shown once ───────────────────────────────────────────────── */

function RevealOnce({ title, secret, children }: { title: string; secret: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-2 text-[15px] font-medium">
        <TriangleAlert aria-hidden size={17} strokeWidth={1.75} className="text-ui-warn" />
        {title}
      </p>
      <p className="text-[14px] leading-relaxed text-ui-muted">{children}</p>
      <div className="flex min-w-0 items-center gap-2 rounded-ui-field bg-ui-surface-2 p-1.5 pl-4">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]" title={secret}>
          {secret}
        </code>
        <CopyButton value={secret} label="secret" variant="button" buttonVariant="lime" />
      </div>
    </div>
  );
}

/* ── API keys ───────────────────────────────────────────────────────────── */

function ApiKeysPanel({ sample }: { sample: boolean }) {
  const keys = useQuery((d) => d.listApiKeys());
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const list = keys.data;

  return (
    <Panel
      title="API keys"
      sample={sample}
      subtitle="pk_test_… is safe in a browser. sk_test_… stays on your server; we show it once and keep only a hash."
      action={
        <Button
          variant="lime"
          size="sm"
          icon={<Plus />}
          onClick={() => setCreating(true)}
          disabled={!CHECKOUT_API_LIVE}
          aria-describedby={CHECKOUT_API_LIVE ? undefined : "keys-blocked"}
        >
          {CHECKOUT_API_LIVE ? "Create key" : "Available with the checkout API"}
        </Button>
      }
    >
      <StaleNotice queries={[keys as QueryState<unknown>]} />
      {!CHECKOUT_API_LIVE ? (
        <p id="keys-blocked" className="mt-3 text-[13px] text-ui-muted">
          {KEYS_BLOCKER}
        </p>
      ) : null}
      {keys.error && !list ? (
        <LoadError query={keys as QueryState<unknown>} title="We couldn't load your keys" />
      ) : !list ? (
        <Skeleton shape="row" height={72} className="mt-5" />
      ) : list.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<KeyRound />}
          title="No keys yet"
          description={CHECKOUT_API_LIVE ? "Create one, then set it as POLARIS_SECRET_KEY on your server." : "Keys arrive with the checkout API."}
        />
      ) : (
        <ul className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2">
          {list.map((k) => (
            <li key={k.id} className="grid gap-3 rounded-ui-row bg-ui-surface-2 p-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center md:px-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[15px] font-medium">
                  {k.name}
                  {sample ? <SampleBadge /> : null}
                </p>
                <p className="text-[13px] text-ui-muted">Created {formatDate(k.createdAt, true)}</p>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <code className="min-w-0 truncate font-mono text-[13px]" title={k.publishableKey}>
                  {k.publishableKey}
                </code>
                <CopyButton value={k.publishableKey} label="publishable key" tone="ghost" />
              </div>
              <div className="min-w-0 text-[13px]">
                <code className="font-mono">{k.secretHint}</code>
                <p className="text-ui-muted">{k.lastUsedAt ? `Used ${formatDate(k.lastUsedAt)}` : "Never used"}</p>
              </div>
              <Button variant="outline" size="sm" icon={<Trash2 />} onClick={() => setRevoking(k)} className="justify-self-start">
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={(k) => keys.mutate((cur) => [k, ...(cur ?? [])])} />
      <RevokeDialog apiKey={revoking} onClose={() => setRevoking(null)} onDone={(id) => keys.mutate((cur) => cur?.filter((k) => k.id !== id))} />
    </Panel>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (k: ApiKey) => void }) {
  const data = useDashboardData();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setTimeout(() => {
        setSecret(null);
        setName("");
        setError(null);
      }, 250);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name it after where it will live, like “Production server”.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await data.createApiKey({ name: name.trim() });
      onCreated(created.key);
      setSecret({ value: created.secret, name: created.key.name });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close} size="sm" title={secret ? "Copy your secret key" : "New API key"} dismissible={!busy}>
      {secret ? (
        <>
          <Dialog.Body>
            <RevealOnce title={`The secret key for “${secret.name}”`} secret={secret.value}>
              This is the only time it&rsquo;s shown. We store a hash of it, so if you lose it, revoke it and create another.
            </RevealOnce>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="lime" onClick={() => close(false)}>
              I&rsquo;ve saved it
            </Button>
          </Dialog.Footer>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <Dialog.Body>
            <Input label="Name" placeholder="Production server" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} autoFocus />
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="lime" loading={busy}>
              Create key
            </Button>
          </Dialog.Footer>
        </form>
      )}
    </Dialog>
  );
}

function RevokeDialog({ apiKey, onClose, onDone }: { apiKey: ApiKey | null; onClose: () => void; onDone: (id: string) => void }) {
  const data = useDashboardData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(apiKey);
  if (apiKey && apiKey !== last) setLast(apiKey);
  const k = apiKey ?? last;
  const confirm = async () => {
    if (!k) return;
    setBusy(true);
    setError(null);
    try {
      await data.revokeApiKey(k.id);
      onDone(k.id);
      toast({ title: "Key revoked", description: `${k.name} stopped working.`, tone: "success" });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={apiKey !== null} onOpenChange={(o) => !o && onClose()} size="sm" title="Revoke this key?" description={k?.name}>
      <Dialog.Body className="grid gap-4">
        <p className="text-[15px] leading-relaxed text-ui-muted">
          Anything still using {k?.secretHint} stops working at once. This can&rsquo;t be undone.
        </p>
        {error ? (
          <Notice tone="down" size="sm" role="alert">
            {error}
          </Notice>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Keep it
        </Button>
        <Button variant="white" className="bg-ui-down text-white hover:bg-ui-down/90" loading={busy} icon={<Trash2 />} onClick={confirm}>
          Revoke key
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

/* ── Webhooks ───────────────────────────────────────────────────────────── */

function WebhooksPanel({ sample }: { sample: boolean }) {
  const data = useDashboardData();
  const hooks = useQuery((d) => d.listWebhooks());
  const [editing, setEditing] = useState<WebhookEndpoint | "new" | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const [delivery, setDelivery] = useState<WebhookDelivery | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const now = useNow(30_000);
  const state = hooks.data;

  const sendTest = async (endpoint: WebhookEndpoint) => {
    setTesting(endpoint.id);
    try {
      const d = await data.sendTestEvent(endpoint.id);
      hooks.mutate((s) => (s ? { ...s, deliveries: [d, ...s.deliveries] } : s));
      toast({ title: "Test event signed and logged", description: "Open it in the delivery log to see the exact request.", tone: "success" });
    } catch (err) {
      toast({ title: "The test event didn't go through", description: errorMessage(err), tone: "error" });
    } finally {
      setTesting(null);
    }
  };

  const setEnabled = async (endpoint: WebhookEndpoint, enabled: boolean) => {
    try {
      const updated = await data.updateWebhook(endpoint.id, { enabled });
      hooks.mutate((s) => (s ? { ...s, endpoints: s.endpoints.map((e) => (e.id === updated.id ? updated : e)) } : s));
    } catch (err) {
      toast({ title: "We couldn't change that endpoint", description: errorMessage(err), tone: "error" });
    }
  };

  return (
    <Panel
      title="Webhooks"
      sample={sample}
      subtitle="Signed with HMAC (polaris-signature), one secret per endpoint"
      action={
        <Button variant="lime" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
          Add endpoint
        </Button>
      }
    >
      <StaleNotice queries={[hooks as QueryState<unknown>]} />
      <Notice tone="info" size="sm" className="mt-4">
        Test events are signed exactly as live ones will be and logged below. They aren&rsquo;t sent over the network yet: live
        delivery arrives with the indexer, behind a guard that refuses private and internal addresses. Endpoints are kept in
        this server&rsquo;s memory for now, so a restart clears them.
      </Notice>
      {hooks.error && !state ? (
        <LoadError query={hooks as QueryState<unknown>} title="We couldn't load your webhooks" />
      ) : !state ? (
        <Skeleton shape="row" height={72} className="mt-5" />
      ) : state.endpoints.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Webhook />}
          title="No endpoints yet"
          description="Add your server's HTTPS URL to hear about payments, plans and payouts."
          action={
            <Button variant="lime" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
              Add endpoint
            </Button>
          }
        />
      ) : (
        <ul className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2">
          {state.endpoints.map((e) => (
            <li key={e.id} className="flex flex-col gap-3 rounded-ui-row bg-ui-surface-2 p-4 md:flex-row md:items-center md:px-5">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                  <code className="truncate font-mono text-[14px]">{e.url}</code>
                  {sample ? <SampleBadge /> : null}
                </p>
                <p className="mt-1 text-[13px] text-ui-muted">
                  {e.events.length} {e.events.length === 1 ? "event" : "events"} · secret {e.secretHint} · added {formatDate(e.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle aria-label={`Deliveries to ${e.url}`} size="sm" checked={e.enabled !== false} onCheckedChange={(on) => void setEnabled(e, on)} />
                <Button variant="outline" size="sm" icon={<Send />} loading={testing === e.id} disabled={e.enabled === false} onClick={() => void sendTest(e)}>
                  Send test event
                </Button>
                <Menu
                  label={`More for ${e.url}`}
                  align="end"
                  width={220}
                  trigger={
                    <span className="grid size-10 place-items-center rounded-full bg-ui-surface-3">
                      <MoreHorizontal aria-hidden size={18} strokeWidth={1.75} />
                    </span>
                  }
                >
                  <Menu.Item icon={<Pencil />} onSelect={() => setEditing(e)}>
                    Edit
                  </Menu.Item>
                  <Menu.Item icon={<Trash2 />} tone="danger" onSelect={() => setDeleting(e)}>
                    Delete
                  </Menu.Item>
                </Menu>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state && state.deliveries.length ? (
        <div className="mt-6">
          <h3 className="text-[16px] font-medium">Delivery log</h3>
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {state.deliveries.slice(0, 10).map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setDelivery(d)}
                  className="flex w-full items-center gap-3 rounded-ui-row bg-ui-surface-2 px-4 py-3 text-left transition-colors hover:bg-ui-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
                >
                  <Badge tone={d.simulated ? "info" : d.status && d.status < 300 ? "up" : "down"}>
                    {d.simulated ? "Signed, not sent" : d.status ? `HTTP ${d.status}` : "No response"}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">{d.event}</span>
                    <span className="block truncate text-[12px] text-ui-muted">{d.url}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ui-muted">{formatAgo(d.createdAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <EndpointDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(endpoint, isNew) =>
          hooks.mutate((s) =>
            s ? { ...s, endpoints: isNew ? [...s.endpoints, endpoint] : s.endpoints.map((x) => (x.id === endpoint.id ? endpoint : x)) } : s,
          )
        }
      />
      <DeleteEndpointDialog
        endpoint={deleting}
        onClose={() => setDeleting(null)}
        onDone={(id) => hooks.mutate((s) => (s ? { ...s, endpoints: s.endpoints.filter((x) => x.id !== id) } : s))}
      />
      <DeliveryDrawer delivery={delivery} onClose={() => setDelivery(null)} />
    </Panel>
  );
}

function EndpointDialog({
  target,
  onClose,
  onSaved,
}: {
  target: WebhookEndpoint | "new" | null;
  onClose: () => void;
  onSaved: (e: WebhookEndpoint, isNew: boolean) => void;
}) {
  const data = useDashboardData();
  const [seen, setSeen] = useState<typeof target>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>(["payment.succeeded", "plan.opened"]);
  const [errors, setErrors] = useState<{ url?: string; events?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  // Load the endpoint being edited (or blank for a new one) when the dialog opens.
  if (target !== seen) {
    setSeen(target);
    if (target) {
      setUrl(target === "new" ? "" : target.url);
      setEvents(target === "new" ? ["payment.succeeded", "plan.opened"] : target.events);
      setErrors({});
      setSecret(null);
    }
  }
  const isNew = target === "new";

  const toggle = (ev: WebhookEventType) => setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^https:\/\/\S+$/i.test(url.trim())) next.url = "Enter your endpoint's full URL, starting with https://.";
    if (!events.length) next.events = "Choose at least one event.";
    setErrors(next);
    if (Object.keys(next).length || !target) return;
    setBusy(true);
    try {
      if (target === "new") {
        const created = await data.createWebhook({ url: url.trim(), events });
        onSaved(created.endpoint, true);
        setSecret(created.secret);
      } else {
        const updated = await data.updateWebhook(target.id, { url: url.trim(), events });
        onSaved(updated, false);
        toast({ title: "Endpoint saved", tone: "success" });
        onClose();
      }
    } catch (err) {
      const field = err instanceof DataError ? err.field : undefined;
      setErrors(field === "url" ? { url: errorMessage(err) } : field === "events" ? { events: errorMessage(err) } : { form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={secret ? "Copy the signing secret" : isNew ? "Add a webhook endpoint" : "Edit endpoint"}
      description={secret ? undefined : "We sign every delivery; verify it with polarispay-sdk's webhooks.verify."}
      dismissible={!busy}
    >
      {secret ? (
        <>
          <Dialog.Body>
            <RevealOnce title="Your endpoint's signing secret" secret={secret}>
              Shown once. Set it as POLARIS_WEBHOOK_SECRET where you verify deliveries.
            </RevealOnce>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="lime" onClick={onClose}>
              I&rsquo;ve saved it
            </Button>
          </Dialog.Footer>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <Dialog.Body className="grid gap-5">
            <Input
              label="Endpoint URL"
              placeholder="https://your.shop/api/polaris/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              error={errors.url}
              className="font-mono text-[14px]"
              spellCheck={false}
              hint="Public HTTPS on port 443. Private and internal addresses are refused."
            />
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-[14px] font-medium">Events</legend>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <Chip key={ev} size="sm" variant="solid" selected={events.includes(ev)} onClick={() => toggle(ev)} className="font-mono text-[12px]">
                    {ev}
                  </Chip>
                ))}
              </div>
              {errors.events ? (
                <p role="alert" className="text-[13px] text-ui-down">
                  {errors.events}
                </p>
              ) : null}
            </fieldset>
            {errors.form ? (
              <Notice tone="down" size="sm" role="alert">
                {errors.form}
              </Notice>
            ) : null}
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="lime" loading={busy}>
              {isNew ? "Add endpoint" : "Save"}
            </Button>
          </Dialog.Footer>
        </form>
      )}
    </Dialog>
  );
}

function DeleteEndpointDialog({ endpoint, onClose, onDone }: { endpoint: WebhookEndpoint | null; onClose: () => void; onDone: (id: string) => void }) {
  const data = useDashboardData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(endpoint);
  if (endpoint && endpoint !== last) setLast(endpoint);
  const e = endpoint ?? last;
  const confirm = async () => {
    if (!e) return;
    setBusy(true);
    setError(null);
    try {
      await data.deleteWebhook(e.id);
      onDone(e.id);
      toast({ title: "Endpoint deleted", tone: "success" });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={endpoint !== null} onOpenChange={(o) => !o && onClose()} size="sm" title="Delete this endpoint?" description={e?.url}>
      <Dialog.Body className="grid gap-4">
        <p className="text-[15px] leading-relaxed text-ui-muted">
          Nothing more is signed or sent for it. Its delivery log stays. To pause it instead, switch it off.
        </p>
        {error ? (
          <Notice tone="down" size="sm" role="alert">
            {error}
          </Notice>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Keep it
        </Button>
        <Button variant="white" className="bg-ui-down text-white hover:bg-ui-down/90" loading={busy} icon={<Trash2 />} onClick={confirm}>
          Delete endpoint
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

function DeliveryDrawer({ delivery, onClose }: { delivery: WebhookDelivery | null; onClose: () => void }) {
  const [last, setLast] = useState(delivery);
  if (delivery && delivery !== last) setLast(delivery);
  const d = delivery ?? last;
  let body = d?.request.body ?? "";
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {}
  return (
    <Drawer open={delivery !== null} onOpenChange={(o) => !o && onClose()} size="lg" title="Delivery" description={d?.id}>
      {d ? (
        <Drawer.Body className="grid content-start gap-4">
          <DetailsList
            size="sm"
            items={[
              { label: "Event", value: <code className="font-mono text-[13px]">{d.event}</code> },
              { label: "Endpoint", value: <span className="font-mono text-[13px] break-all">{d.url}</span> },
              { label: "Result", value: d.simulated ? "Signed and logged, not sent" : d.status ? `HTTP ${d.status}` : "No response" },
              { label: "When", value: formatDateTime(d.createdAt) },
            ]}
          />
          <CodeBlock
            copyable
            showLineNumbers={false}
            samples={[
              {
                key: "headers",
                label: "Headers",
                code: Object.entries(d.request.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n"),
              },
              { key: "body", label: "Body", code: body, language: "json" },
            ]}
          />
        </Drawer.Body>
      ) : null}
    </Drawer>
  );
}
