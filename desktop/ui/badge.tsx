import type { ReactNode } from "react";
import { cx } from "./classnames";

type BadgeTone = "danger" | "default" | "success" | "warning";

const BADGE_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[0.66rem] font-bold uppercase tracking-normal";

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-[rgba(255,143,132,0.14)] text-[var(--danger)]",
  default: "bg-white/[0.04] text-[var(--text-dim)]",
  success: "bg-[rgba(137,212,161,0.14)] text-[var(--success)]",
  warning: "bg-[rgba(240,196,109,0.14)] text-[var(--warning)]",
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
