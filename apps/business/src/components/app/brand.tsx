import { Badge, Logo, LogoMark, cn } from "@polaris/ui";

/**
 * "Polaris for Business": the team's wordmark (packages/brand, an image, never
 * typeset) and the lime "Business" chip.
 */
export function BusinessLogo({ height = 30, className }: { height?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo height={height} alt="Polaris" />
      <Badge tone="lime" size={height < 28 ? "sm" : "md"} className="font-semibold">
        Business
      </Badge>
    </span>
  );
}

/** The star alone, for the icon rail and tight spots. */
export function BusinessMark({ size = 30 }: { size?: number }) {
  return <LogoMark size={size} title="Polaris for Business" />;
}
