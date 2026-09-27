"use client";

import {
  BalanceSummaryCard,
  CardStack,
  DataTable,
  DeltaChip,
  DollarCoin,
  FigureRow,
  KeyValueGrid,
  Money,
  Skeleton,
  StatusPill,
  TableName,
} from "@polaris/ui";
import { ArrowDownToLine, ArrowUpFromLine, CreditCard, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type AccountView, useAccounts } from "@/components/accounts";
import { useOwner } from "@/lib/account/hooks";
import { getActivity, getProfile } from "@/lib/data";
import { useData } from "@/lib/data/hooks";
import { monthYear } from "@/lib/dates";
import { usd } from "@/lib/money";
import { balanceChange, n } from "@/lib/view";
import { PageCoin, PageGrid, PageHead, SectionTitle, SideNote, withSample } from "./bits";

const ABOUT: Record<AccountView["id"], string> = {
  dollar: "Get paid, pay in full, send",
  later: "What Pay in 4 can use",
  boost: "Locked to raise your line",
};

/**
 * Cards from 1024px: your three accounts in ref E's table with their details,
 * and ref D's card stack beside them with the dollar account.
 */
export function CardsDesktop() {
  const router = useRouter();
  const owner = useOwner();
  const profile = useData(() => getProfile(owner), [owner]);
  const activity = useData(() => getActivity(owner), [owner]);
  const { accounts, selected, balance, credit } = useAccounts();
  const open = (href: string) => router.push(href, { scroll: false });
  const dollar = accounts.find((a) => a.id === "dollar");
  const delta = balance && activity.value ? balanceChange(balance.available, activity.value) : undefined;

  return (
    <>
      <PageHead title="Cards" coins={[<PageCoin key="c" tone="lime"><CreditCard /></PageCoin>, <DollarCoin key="d" size={50} />]} />
      <PageGrid
        main={
          <>
            <FigureRow
              caption="All your accounts"
              value={balance && credit ? <Money value={n(balance.available) + n(credit.available)} /> : undefined}
              deltaLabel={credit ? `${usd(credit.available)} of it is Pay later` : undefined}
              deltaTitle="Your dollar account plus what your Pay later line can spend"
              badge={withSample()}
            />
            <SectionTitle className="mt-10">Accounts</SectionTitle>
            <DataTable
              className="mt-3"
              caption="Your accounts"
              loading={!accounts.length}
              loadingRows={3}
              rows={accounts}
              rowKey={(a) => a.id}
              onRowClick={(a) => open(`/accounts?account=${a.id}`)}
              columns={[
                {
                  key: "account",
                  header: "Account",
                  render: (a) => (
                    <TableName
                      icon={
                        <span className="grid size-8 place-items-center rounded-full" style={{ background: a.tint }}>
                          {a.mark}
                        </span>
                      }
                      title={a.title}
                      sub={`**** ${a.last4}`}
                    />
                  ),
                },
                { key: "what", header: "For", hideBelow: "xl", render: (a) => <span className="text-ui-muted">{ABOUT[a.id]}</span> },
                { key: "balance", header: "Balance", render: (a) => <span className="ui-figure">{usd(BigInt(Math.round(a.balance * 1e6)))}</span> },
                {
                  key: "home",
                  header: "Home",
                  align: "right",
                  render: (a) =>
                    a.id === selected?.id ? (
                      <StatusPill tone="lime">On Home</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Hidden</StatusPill>
                    ),
                },
              ]}
            />
            <SectionTitle className="mt-10">Details</SectionTitle>
            <KeyValueGrid
              className="mt-4"
              columns={3}
              items={[
                { label: "Holder", value: profile.value?.name ?? "…" },
                { label: "Account", value: dollar ? `**** ${dollar.last4}` : "…" },
                { label: "Currency", value: "US dollars" },
                { label: "Pay later limit", value: credit ? usd(credit.limit, { trim: true }) : "…" },
                { label: "Interest", value: credit ? `${credit.aprBps / 100}% a year` : "…" },
                { label: "Since", value: profile.value ? monthYear(profile.value.memberSince) : "…" },
              ]}
            />
          </>
        }
        side={
          <>
            {balance && profile.value && dollar ? (
              <CardStack
                name={profile.value.name}
                last4={dollar.last4}
                meta="USD"
                balance={dollar.balance}
                decimals={2}
                deltaLabel="Today"
                delta={delta}
                actions={[
                  { label: "Add money", icon: <Plus />, tone: "outline", onClick: () => open("/add") },
                  { label: "Send", icon: <ArrowUpFromLine />, tone: "mint", onClick: () => open("/send") },
                  { label: "Receive", icon: <ArrowDownToLine />, tone: "honey", onClick: () => open("/receive") },
                ]}
              />
            ) : (
              <Skeleton shape="card" height={264} />
            )}
            {balance && credit ? (
              <BalanceSummaryCard
                className="mt-1"
                label="Dollar account"
                value={<Money value={n(balance.available)} />}
                badge={withSample(<DeltaChip value={delta ?? null} suffix="today" variant="strong" />)}
                stats={[
                  { label: "Pay later", value: usd(credit.available) },
                  { label: "Boost", value: "$0.00" },
                  { label: "Fees", value: "None" },
                ]}
              />
            ) : (
              <Skeleton shape="card" height={170} />
            )}
            <SideNote>Choose which account Home shows: open one from the table and pick Show on Home.</SideNote>
          </>
        }
      />
    </>
  );
}
