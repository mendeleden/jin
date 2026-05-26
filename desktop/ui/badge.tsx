import type { ReactNode } from "react";
import { cx } from "./classnames";

type BadgeTone = "danger" | "default" | "success" | "warning";

const BADGE_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[0.66rem] font-bold uppercase tracking-normal";

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  default: "bg-[var(--field-bg)] text-[var(--text-dim)]",
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
};

export function Badge({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
}) {
  return <span className={cx(BADGE_BASE, BADGE_TONE_CLASS[tone], className)}>{children}</span>;
}

export function StatusBadge({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  return (
    <Badge className={className} tone={statusTone(value)}>
      {value}
    </Badge>
  );
}

function statusTone(value: string): BadgeTone {
  if (value === "running" || value === "healthy") {
    return "success";
  }

  if (value === "degraded" || value === "stopping") {
    return "warning";
  }

  if (value === "stopped" || value === "starting") {
    return "danger";
  }

  return "default";
}
