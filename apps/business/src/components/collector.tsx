"use client";

import { useEffect, useState } from "react";

import type { CollectorStatus } from "@/lib/data/types";
import { formatAgo } from "@/lib/data/format";
import { cx } from "./ui";

const LABEL: Record<CollectorStatus["state"], string> = {
  running: "Collections running",
  degraded: "Collections delayed",
  stopped: "Collections stopped",
};

/**
 * Whether anything is collecting right now. A merchant's question is not "is
 * the API up" but "is the money being chased", and silence is the failure
 * that costs most, so a stopped collector is loud here.
 */
export function CollectorStrip({ collector }: { collector: CollectorStatus }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const tone =
    collector.state === "running" ? "text-lime-text" : collector.state === "degraded" ? "text-warn-text" : "text-danger-text";
  const dot = collector.state === "running" ? "bg-lime lamp-live" : collector.state === "degraded" ? "bg-warn" : "bg-danger";

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" role="status">
      <span className={cx("inline-flex items-center gap-2 font-medium", tone)}>
        <span aria-hidden className={cx("size-[7px] rounded-full", dot)} />
        {LABEL[collector.state]}
      </span>
      {collector.lastPassAt ? (
        <span className="text-muted">last pass {formatAgo(collector.lastPassAt, now)}</span>
      ) : null}
      <span className="text-muted">{collector.runner === "cre" ? "on Chainlink CRE" : "on the fallback keeper"}</span>
    </p>
  );
}
