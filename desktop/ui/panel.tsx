import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./classnames";

type PanelSpan = "none" | "default" | "span" | "wide";

const PANEL_BASE =
  "rounded-[var(--radius-panel)] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] p-3 shadow-[var(--shadow)]";

const PANEL_SPAN_CLASS: Record<PanelSpan, string> = {
  none: "",
  default: "col-span-4 max-[1220px]:col-span-full",
  span: "col-span-8 max-[1220px]:col-span-full",
  wide: "col-span-full",
};

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: "article" | "aside" | "section";
  span?: PanelSpan;
}

export function Panel({
  as: Element = "section",
  className,
  span = "default",
  ...props
}: PanelProps) {
  return (
    <Element
      className={cx(PANEL_BASE, PANEL_SPAN_CLASS[span], className)}
      {...props}
    />
  );
}

export function PanelHeader({
  actions,
  children,
  className,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-2.5 flex min-w-0 items-start justify-between gap-3", className)}>
      <div>{children}</div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--accent)]">
      {children}
    </span>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-[3px] mb-0 text-[0.95rem] tracking-normal [overflow-wrap:anywhere]">
      {children}
    </h2>
  );
}

export function PanelMeta({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap text-[0.8rem] text-[var(--text-dim)]">{children}</span>;
}
