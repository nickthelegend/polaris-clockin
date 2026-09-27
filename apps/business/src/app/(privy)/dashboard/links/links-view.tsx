"use client";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  CopyButton,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Menu,
  Money,
  Notice,
  SegmentedControl,
  Select,
  Skeleton,
  Tab,
  TabList,
  Tabs,
  toast,
  type BadgeTone,
} from "@polaris/ui";
import { ArrowUpRight, Ban, Copy, Link2, MoreHorizontal, Plus, Share2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { DataModeNotice, LoadError, SampleBadge, StaleNotice } from "@/components/dashboard/common";
import { DownloadQrButton, QrCode } from "@/components/qr";
import { DashboardHeader } from "@/components/shell/dashboard-shell";
import { DataError, errorMessage } from "@/lib/data";
import { formatDate, MODE_LABEL, money, parseAmount, payInFourQuote } from "@/lib/data/format";
import type { LinkStatus, LinkUsage, PayMode, PaymentLink } from "@/lib/data/types";
import { useDashboardData, useQuery, useReadiness, useSample, type QueryState } from "@/lib/session";

const STATUS: Record<LinkStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: "lime", label: "Active" },
  used: { tone: "neutral", label: "Used" },
  expired: { tone: "neutral", label: "Expired" },
  inactive: { tone: "neutral", label: "Off" },
};

type Filter = "all" | "active" | "closed";

export function LinksView() {
  const links = useQuery((d) => d.listLinks());
  // Links are the merchant's own, never the viewer's sample preview; they are
  // only sample in the mock session or on a server with no chain.
  const { reason } = useSample();
  const sample = reason === "mock" || reason === "server";
  const blocker = useReadiness().links;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [sharing, setSharing] = useState<PaymentLink | null>(null);
  const [turningOff, setTurningOff] = useState<PaymentLink | null>(null);

  // `?new=1` (from the overview's "New link") opens the dialog once, then leaves the URL.
  useEffect(() => {
    if (params.get("new") === "1") router.replace(pathname, { scroll: false });
  }, [params, pathname, router]);

  const list = links.data;
  const counts = useMemo(
    () => ({ all: list?.length ?? 0, active: list?.filter((l) => l.status === "active").length ?? 0 }),
    [list],
  );
  const filtered = (list ?? []).filter((l) => (filter === "all" ? true : filter === "active" ? l.status === "active" : l.status !== "active"));

  return (
    <>
      <DashboardHeader
        title="Payment links"
        description="One link, three ways to pay: in full, in four payments on Polaris credit, or by subscription."
        actions={
          <Button variant="lime" size="md" icon={<Plus />} onClick={() => setCreating(true)}>
            New link
          </Button>
        }
      />
      <StaleNotice queries={[links as QueryState<unknown>]} />
      {sample ? <DataModeNotice empty={false} /> : null}
      {blocker ? (
        <Notice id="links-pending" tone="info" className="mb-5" title="Buyers can't open links yet">
          {blocker} You can create links now; sharing, copying and QR codes switch on then.
        </Notice>
      ) : null}

      <Card padding="none" className="min-w-0">
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} variant="pill">
            <TabList aria-label="Filter links">
              <Tab value="all" count={counts.all}>
                All
              </Tab>
              <Tab value="active" count={counts.active}>
                Active
              </Tab>
              <Tab value="closed" count={counts.all - counts.active}>
                Closed
              </Tab>
            </TabList>
          </Tabs>
        </div>

        {links.error && !list ? (
          <LoadError query={links as QueryState<unknown>} title="We couldn't load your links" />
        ) : !list ? (
          <div className="grid gap-2 p-4 sm:p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} shape="row" height={84} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Link2 />}
            title={list.length ? "Nothing here" : "No payment links yet"}
            description={
              list.length
                ? "No links match this filter."
                : "Create one for an invoice, a product or a service. Buyers choose how to pay; you're paid in full."
            }
            action={
              list.length ? null : (
                <Button variant="lime" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                  New link
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:p-4">
            {filtered.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                sample={sample}
                live={!blocker}
                onShare={() => setSharing(link)}
                onTurnOff={() => setTurningOff(link)}
              />
            ))}
          </ul>
        )}
      </Card>

      <NewLinkDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(link) => {
          links.mutate((current) => [link, ...(current ?? [])]);
          setFilter("all");
        }}
      />
      <ShareDialog link={blocker ? null : sharing} sample={sample} onClose={() => setSharing(null)} />
      <TurnOffDialog
        link={turningOff}
        onClose={() => setTurningOff(null)}
        onDone={(link) => links.mutate((current) => current?.map((l) => (l.id === link.id ? link : l)))}
      />
    </>
  );
}

function LinkRow({
  link,
  sample,
  live,
  onShare,
  onTurnOff,
}: {
  link: PaymentLink;
  sample: boolean;
  live: boolean;
  onShare: () => void;
  onTurnOff: () => void;
}) {
  const status = STATUS[link.status];
  const active = link.status === "active";
  return (
    <li className="flex flex-col gap-4 rounded-ui-row bg-ui-surface-2 p-4 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Avatar name={link.description} size="md" decorative />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[16px] font-medium">{link.description}</span>
            {sample ? <SampleBadge /> : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {link.modes.map((m) => (
              <Badge key={m} tone="neutral">
                {MODE_LABEL[m]}
              </Badge>
            ))}
            <span className="text-[13px] text-ui-muted">
              · {link.usage === "single" ? "Single use" : "Reusable"}
              {link.expiresAt ? ` · until ${formatDate(link.expiresAt)}` : ""}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <div className="text-left sm:text-right">
          <Money value={link.amountCents / 100} className="text-[17px] font-medium" />
          <p className="text-[13px] text-ui-muted">
            {link.paymentsCount} paid · {money(link.collectedCents)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton
            label={live ? `Share “${link.description}”` : "Sharing opens once buyers can open links"}
            icon={<Share2 />}
            tone="surface"
            size="md"
            className="bg-ui-surface-3"
            onClick={onShare}
            disabled={!live || !active}
            aria-describedby={live ? undefined : "links-pending"}
          />
          <Menu
            label={`More for “${link.description}”`}
            align="end"
            width={260}
            trigger={
              <span className="grid size-11 place-items-center rounded-full bg-ui-surface-3 text-ui-text">
                <MoreHorizontal aria-hidden size={20} strokeWidth={1.75} />
              </span>
            }
          >
            <Menu.Item
              icon={<Copy />}
              disabled={!live || !active}
              description={live ? undefined : "Once buyers can open links"}
              onSelect={() => void navigator.clipboard.writeText(link.url).then(() => toast({ title: "Link copied", tone: "success" }))}
            >
              Copy link
            </Menu.Item>
            <Menu.Item icon={<Ban />} tone="danger" disabled={!active} onSelect={onTurnOff} description={active ? "It stops taking payments" : "Already closed"}>
              Turn off
            </Menu.Item>
          </Menu>
        </div>
      </div>
    </li>
  );
}

/* ── New link ───────────────────────────────────────────────────────────── */

const EXPIRY = [
  { value: "never", label: "Never", hours: null },
  { value: "24h", label: "In 24 hours", hours: 24 },
  { value: "7d", label: "In 7 days", hours: 24 * 7 },
  { value: "30d", label: "In 30 days", hours: 24 * 30 },
] as const;

type ExpiryKey = (typeof EXPIRY)[number]["value"];
type Errors = Partial<Record<"description" | "amountCents" | "modes" | "usage" | "expiresInHours" | "form", string>>;

function NewLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (link: PaymentLink) => void;
}) {
  const data = useDashboardData();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [modes, setModes] = useState<PayMode[]>(["now", "later"]);
  const [usage, setUsage] = useState<LinkUsage>("reusable");
  const [expiry, setExpiry] = useState<ExpiryKey>("never");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const cents = parseAmount(amount);
  const quote = cents && cents >= 20_00 ? payInFourQuote(cents) : null;

  const reset = () => {
    setDescription("");
    setAmount("");
    setModes(["now", "later"]);
    setUsage("reusable");
    setExpiry("never");
    setErrors({});
  };

  const toggle = (m: PayMode) => setModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!description.trim()) next.description = "Say what the buyer is paying for.";
    if (cents === null) next.amountCents = "Enter an amount, like 200 or 49.50.";
    if (!modes.length) next.modes = "Choose at least one way to pay.";
    if (modes.includes("later") && cents !== null && cents < 20_00) next.modes = "Pay in 4 needs at least $20.00.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const link = await data.createLink({
        description: description.trim(),
        amountCents: cents!,
        modes,
        usage,
        expiresInHours: EXPIRY.find((x) => x.value === expiry)!.hours,
      });
      onCreated(link);
      toast({
        title: "Link saved",
        description: "Share it from its row: a link, a QR code, or the checkout itself.",
        tone: "success",
      });
      onOpenChange(false);
      reset();
    } catch (err) {
      const field = err instanceof DataError ? err.field : undefined;
      setErrors({ [field && field in { description: 1, amountCents: 1, modes: 1, usage: 1, expiresInHours: 1 } ? field : "form"]: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New payment link" description="Buyers choose how to pay; you're paid in full either way.">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <Dialog.Body className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Input
            label="What it's for"
            placeholder="Brand identity package"
            maxLength={120}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errors.description}
            hint="Buyers see this on the checkout and the receipt."
          />
          <Input
            label="Amount"
            placeholder="200.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amountCents}
            trailing="USD"
            hint={quote ? `Pay in 4: 4 × ${money(quote.each)}, paid by the buyer. You get ${money(cents!)} today.` : undefined}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[14px] font-medium">Ways to pay</legend>
            <div className="flex flex-wrap gap-2">
              {(["now", "later", "subscribe"] as const).map((m) => (
                <Chip key={m} variant="solid" selected={modes.includes(m)} onClick={() => toggle(m)}>
                  {MODE_LABEL[m]}
                </Chip>
              ))}
            </div>
            {errors.modes ? (
              <p role="alert" className="text-[13px] text-ui-down">
                {errors.modes}
              </p>
            ) : (
              <p className="text-[13px] text-ui-muted">Subscribe charges the amount every month until the buyer cancels.</p>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <span className="text-[14px] font-medium" id="usage-label">
                Use
              </span>
              <SegmentedControl<LinkUsage>
                aria-labelledby="usage-label"
                block
                value={usage}
                onValueChange={setUsage}
                options={[
                  { value: "reusable", label: "Reusable" },
                  { value: "single", label: "Single use" },
                ]}
              />
            </div>
            <Select<ExpiryKey>
              label="Expires"
              variant="filled"
              value={expiry}
              onValueChange={setExpiry}
              options={EXPIRY.map((x) => ({ value: x.value, label: x.label }))}
            />
          </div>
          {errors.form ? (
            <Notice tone="down" size="sm" role="alert">
              {errors.form}
            </Notice>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="lime" loading={busy} icon={<Plus />}>
            Create link
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

/* ── Share (only once buyers can open links) ─────────────────────────────── */

function ShareDialog({ link, sample, onClose }: { link: PaymentLink | null; sample: boolean; onClose: () => void }) {
  const [last, setLast] = useState(link);
  if (link && link !== last) setLast(link);
  const l = link ?? last;
  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()} size="sm" title="Share link" description={l?.description}>
      {l ? (
        <Dialog.Body className="grid justify-items-center gap-5">
          {sample ? (
            <Notice tone="warn" size="sm" className="w-full">
              A sample link: it shows how sharing works, but it opens no checkout.
            </Notice>
          ) : null}
          <QrCode value={l.url} label={`QR code for ${l.description}`} size={200} />
          <div className="flex w-full min-w-0 items-center gap-2 rounded-ui-field bg-ui-surface-2 p-1.5 pl-4">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{l.url}</code>
            <CopyButton value={l.url} label="link" variant="button" buttonVariant="lime" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <DownloadQrButton value={l.url} filename={`polaris-${l.id}.svg`} />
            <Button asChild variant="outline" size="sm" icon={<ArrowUpRight />}>
              <a href={l.url} target="_blank" rel="noreferrer">
                Open checkout
              </a>
            </Button>
          </div>
        </Dialog.Body>
      ) : null}
    </Dialog>
  );
}

/* ── Turn off ───────────────────────────────────────────────────────────── */

function TurnOffDialog({ link, onClose, onDone }: { link: PaymentLink | null; onClose: () => void; onDone: (l: PaymentLink) => void }) {
  const data = useDashboardData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(link);
  if (link && link !== last) setLast(link);
  const l = link ?? last;

  const confirm = async () => {
    if (!l) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await data.deactivateLink(l.id);
      onDone(updated);
      toast({ title: "Link turned off", tone: "success" });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()} size="sm" title="Turn off this link?" description={l?.description}>
      <Dialog.Body className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <p className="text-[15px] leading-relaxed text-ui-muted">
          Buyers who open it will see it no longer takes payments. Payments already made, and Pay in 4 plans still collecting,
          aren&rsquo;t affected. This can&rsquo;t be undone; you can create a new link instead.
        </p>
        {error ? (
          <Notice tone="down" size="sm" role="alert">
            {error}
          </Notice>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Keep it on
        </Button>
        <Button variant="white" loading={busy} icon={<Ban />} onClick={confirm} className="bg-ui-down text-white hover:bg-ui-down/90">
          Turn off
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

