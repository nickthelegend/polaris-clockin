"use client";

import { type ReactNode, useState } from "react";
import type { LocalAccount } from "viem";
import {
  type AccountErrorKind,
  authorize,
  createAccount,
  describeAccountError,
  signIn,
  toAccountError,
} from "@/lib/account";
import { useAccountState, useAccountSupport, useInAppBrowser } from "@/lib/account/hooks";
import { RelayError } from "@/lib/relayer";
import { Icon, type IconName } from "./icon";
import { OpenOnPhone } from "./open-on-phone";
import { Button, cx, Skeleton } from "./ui";

type Stage = "idle" | "faceid" | "working";

/**
 * The one control every money action goes through. It knows whether this
 * device has an account and does the right Face ID for it:
 *
 *   no account   "Pay with Face ID" creates the account and runs the action
 *                in the same ceremony; "I already use Polaris" signs in.
 *   account      "Confirm with Face ID" asks Face ID, then runs the action.
 *   can't        "Open Polaris on your phone" with a QR code.
 *
 * The ceremony is the first thing the click handler does, so WebKit's
 * user-gesture rule is always met.
 */
export function FaceIdAction({
  label = "Confirm with Face ID",
  newLabel,
  busyLabel = "Confirming…",
  disabled,
  onAccount,
  hint,
  className,
  variant = "primary",
  icon = "faceId",
}: {
  variant?: "primary" | "quiet" | "danger";
  /** The glyph on the button; `false` for a plain label ("Send money"). */
  icon?: IconName | false;
  label?: string;
  /** For a device with no account yet. Defaults to `label`. */
  newLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onAccount: (account: LocalAccount) => Promise<void>;
  /** A line under the button, e.g. what Face ID does here. */
  hint?: ReactNode;
  className?: string;
}) {
  const state = useAccountState();
  const support = useAccountSupport();
  const inApp = useInAppBrowser();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<{ message: string; kind: AccountErrorKind | "relay" | "other" } | null>(null);

  async function run(getAccount: () => Promise<LocalAccount>) {
    setError(null);
    setStage("faceid");
    let account: LocalAccount;
    try {
      account = await getAccount();
    } catch (e) {
      const err = toAccountError(e);
      setError({ message: describeAccountError(err), kind: err.kind });
      setStage("idle");
      return;
    }
    setStage("working");
    try {
      await onAccount(account);
    } catch (e) {
      setError(
        e instanceof RelayError
          ? { message: e.message, kind: "relay" }
          : { message: "That didn't go through, and nothing was charged. Try again.", kind: "other" },
      );
    } finally {
      setStage("idle");
    }
  }

  if (inApp) return <OpenOnPhone reason="in-app" />;
  if (support.status === "done" && !support.ok) return <OpenOnPhone reason={support.reason} />;
  if (error?.kind === "unsupported" || error?.kind === "host" || error?.kind === "insecure") {
    return <OpenOnPhone reason={error.kind === "unsupported" ? "unsupported" : error.kind} />;
  }

  if (state.status === "unknown" || support.status === "checking") {
    return <Skeleton className={cx("h-[54px] w-full rounded-btn", className)} />;
  }

  const busy = stage !== "idle";
  const busyText = stage === "faceid" ? "Waiting for Face ID…" : busyLabel;
  const isNew = state.status === "none";

  return (
    <div className={className}>
      <Button
        block
        variant={variant}
        icon={icon || undefined}
        disabled={disabled}
        busy={busy}
        onClick={() => void run(isNew ? createAccount : () => authorize())}
      >
        {busy ? busyText : isNew ? (newLabel ?? label) : label}
      </Button>

      {isNew && !busy ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void run(() => signIn())}
          className="press mx-auto mt-2 flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium tracking-[-0.02em] text-fg disabled:opacity-45"
        >
          I already use Polaris
        </button>
      ) : null}

      {hint && !error ? <p className="mt-3 text-center text-[13px] text-muted">{hint}</p> : null}

      {error ? (
        <div role="alert" className="mt-3 flex items-start justify-center gap-2 text-center text-[14px] text-negative">
          <Icon name="info" size={18} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.kind === "cancelled" && state.status === "locked" ? (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium text-fg underline underline-offset-4"
                  onClick={() => void run(() => signIn({ anyAccount: true }))}
                >
                  Use a different account
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
