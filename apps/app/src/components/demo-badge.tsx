import { DEMO_MODE } from "@/lib/api";
import { DEV_SIGNER } from "@/lib/account";

/**
 * The offline demo says so on every screen: with no Polaris API configured,
 * balances, plans and activity are sample data and nothing reaches a chain
 * (the stub relayer makes up its transaction hashes, which are never linked
 * to the explorer).
 */
export function DemoModeBadge() {
  if (!DEMO_MODE) return null;
  return (
    <div
      className={`column-fixed pointer-events-none ${DEV_SIGNER ? "top-[calc(34px+env(safe-area-inset-top))]" : "top-[calc(10px+env(safe-area-inset-top))]"} z-50 flex justify-center`}
    >
      <p
        role="note"
        className="flex h-5 items-center gap-1.5 rounded-full bg-chip px-2 text-[10px] leading-none font-semibold tracking-[0.01em] text-on-chip"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-[#ffb020]" />
        Demo mode · sample data, nothing is on chain
      </p>
    </div>
  );
}
