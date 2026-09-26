"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./icon";

/**
 * A bottom sheet on the native <dialog>: focus is trapped, Esc and a tap on
 * the scrim close it, and the page behind is inert.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the scrim.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hairline" aria-hidden />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-display text-[22px] font-semibold tracking-[-0.03em]">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[15px] text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-pill text-fg"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}
