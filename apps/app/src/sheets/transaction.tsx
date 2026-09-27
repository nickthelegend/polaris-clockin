"use client";

import { Button, DetailsList, EmptyState, Money, Sheet, Skeleton } from "@polaris/ui";
import { ExternalLink, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActivityAvatar } from "@/components/avatars";
import { LocalEquivalent } from "@/components/local-equivalent";
import { useOwner } from "@/lib/account/hooks";
import { receiptUrl } from "@/lib/chain";
import { type ActivityItem, getActivity, getContacts, getPlans } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { longDate, time } from "@/lib/dates";
import { signed } from "@/lib/view";
import { RouteSheet } from "@/components/shell/sheet-host";

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  payment: "Paid in full",
  instalment: "Pay in 4 instalment",
  "plan-opened": "Pay in 4",
  subscription: "Subscription",
  "sent-link": "Sent by link",
  sent: "Sent",
  received: "Received",
  claimed: "Received by link",
  refund: "Returned",
  added: "Added money",
};

/** Transaction detail (half): the amount, what it was, and the one road to the receipt. */
export function TransactionSheet({ id }: { id: string }) {
  const router = useRouter();
  const owner = useOwner();
  const activity = useData(() => getActivity(owner), [owner]);
  const plans = useData(() => getPlans(owner), [owner]);
  const contacts = useData(() => getContacts(owner), [owner]);

  if (!activity.value) {
    return (
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 items-center gap-3 pt-4">
        <Skeleton shape="circle" width={56} height={56} />
        <Skeleton width={160} height={36} />
        <Skeleton shape="tile" height={176} className="w-full" />
      </Sheet.Body>
    );
  }

  const item = activity.value.find((a) => a.id === id);
  if (!item) {
    return (
      <Sheet.Body>
        <EmptyState size="sm" icon={<SearchX />} title="This payment isn't here" description="It may belong to another account on this device." />
      </Sheet.Body>
    );
  }

  const plan =
    item.kind === "instalment" || item.kind === "plan-opened"
      ? plans.value?.plans.find((p) => p.merchant.name === item.counterparty.name && p.status === "active") ??
        plans.value?.plans.find((p) => p.merchant.name === item.counterparty.name)
      : undefined;
  const contact = item.counterparty.kind === "person" ? contacts.value?.find((c) => c.name === item.counterparty.name) : undefined;

  return (
    <>
      <Sheet.Body className="flex flex-col [&>*]:shrink-0 items-center gap-2 pt-2 text-center">
        <ActivityAvatar item={item} size="lg" />
        <p className="mt-2 text-[16px] font-medium">{item.title}</p>
        <Money
          value={signed(item)}
          signed
          dim="cents"
          className={`text-[40px] leading-none font-semibold tracking-[-0.035em] ${item.direction === "in" ? "text-ui-up" : ""}`}
        />
        <LocalEquivalent amount={item.amount} className="text-[14px]" />
        <DetailsList
          size="sm"
          className="mt-3 w-full text-left"
          items={[
            { label: "What", value: item.detail },
            { label: "Type", value: KIND_LABEL[item.kind] },
            { label: "When", value: `${longDate(item.at)}, ${time(item.at)}` },
            { label: "Status", value: item.status === "settled" ? "Complete" : "Processing" },
          ]}
        />
      </Sheet.Body>
      <Sheet.Footer>
        <Button asChild variant="outline" size="lg" iconRight={<ExternalLink />}>
          <a href={receiptUrl(item.txHash)} target="_blank" rel="noopener noreferrer">
            View receipt
          </a>
        </Button>
        {plan ? (
          <Button variant="lime" size="lg" onClick={() => router.push(`/plans/${plan.id}`, { scroll: false })}>
            View plan
          </Button>
        ) : contact ? (
          <Button variant="lime" size="lg" onClick={() => router.push(`/send?contact=${contact.id}`, { scroll: false })}>
            Send again
          </Button>
        ) : null}
      </Sheet.Footer>
    </>
  );
}

/** The route: the intercepting page in app/@sheet (over the current tab), or the page itself (cold, over its tab). */
export function TransactionRoute({ id, cold }: { cold?: boolean } & { id: string }) {
  return (
    <RouteSheet label="Transaction" cold={cold} fallback="/activity">
      <TransactionSheet id={id} />
    </RouteSheet>
  );
}
