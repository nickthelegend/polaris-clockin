import { cn } from "@/lib/cn";

/**
 * The Polaris mark: a four-point north star with a longer lower ray.
 */
export function PolarisMark({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fill="currentColor"
        d="M16 1.5c.7 6.3 2.4 9.7 12.5 12-9.9 2.3-11.7 5.9-12.5 17-.8-11.1-2.6-14.7-12.5-17 10.1-2.3 11.8-5.7 12.5-12Z"
      />
      <circle cx="26.5" cy="5.5" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** Mark plus wordmark, for the footer and anywhere static. */
export function PolarisLogo({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <PolarisMark size={size} />
      <span className="font-semibold tracking-[-0.04em]">Polaris</span>
    </span>
  );
}
