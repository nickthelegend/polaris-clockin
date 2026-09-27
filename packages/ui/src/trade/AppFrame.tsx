import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../lib/cn";
import type { Theme } from "../primitives/Card";

export type AppFrameProps = HTMLAttributes<HTMLDivElement> & {
  /** Classes for the dark panel itself. */
  panelClassName?: string;
  /** Fill the viewport (a page root). Off for a framed preview inside a page. */
  fullHeight?: boolean;
  /** Scope the frame to a theme; it inherits the page's otherwise. */
  theme?: Theme;
  /**
   * Where the panel starts floating. `xl` (1280px) for an app; `always` for
   * a preview that should float at any width (the gallery, a hero visual).
   */
  floatFrom?: "xl" | "always";
};

/**
 * Ref E's frame: from 1280px the whole app is a dark rounded panel (#121418,
 * 32px corners, a big soft shadow) floating on the lime canvas with 32px of
 * lime around it; below 1280px the dark app is full bleed.
 *
 * ```tsx
 * <AppFrame>
 *   <TopNav … />
 *   <main>…</main>
 * </AppFrame>
 * ```
 */
export const AppFrame = forwardRef<HTMLDivElement, AppFrameProps>(function AppFrame(
  { panelClassName, fullHeight = true, theme, floatFrom = "xl", className, children, ...props },
  ref,
) {
  const always = floatFrom === "always";
  return (
    <div
      ref={ref}
      data-theme={theme}
      className={cn(
        "min-w-0 font-satoshi text-ui-text",
        always ? "bg-ui-frame p-4 sm:p-6 lg:p-8" : "bg-ui-canvas xl:bg-ui-frame xl:p-8",
        fullHeight && "min-h-dvh",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "relative bg-ui-canvas",
          always ? "rounded-[24px] shadow-ui-frame lg:rounded-ui-frame" : "xl:rounded-ui-frame xl:shadow-ui-frame",
          fullHeight && (always ? "min-h-[calc(100dvh-64px)]" : "min-h-dvh xl:min-h-[calc(100dvh-64px)]"),
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
});
