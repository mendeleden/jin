import type { ReactNode } from "react";
import { cx } from "./classnames";

export function EmptyState({
  children,
  className,
  title,
}: {
  children?: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius-panel)] border border-dashed border-[var(--line)] p-4 text-[var(--text-soft)] [&_p]:m-0 [&_p]:mb-3 [&_p]:leading-[1.55] [&_p:last-child]:mb-0",
        className,
      )}
    >
      <h3 className="m-0 mb-2 text-base">{title}</h3>
      {children}
    </div>
  );
}

export function ListPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={cx("grid gap-2.5", className)}>
      <div className="h-[76px] rounded-xl bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.08),rgba(255,255,255,0.04))]" />
      <div className="h-14 rounded-xl bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.08),rgba(255,255,255,0.04))]" />
      <div className="h-14 rounded-xl bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.08),rgba(255,255,255,0.04))]" />
      <div className="h-14 w-[74%] rounded-xl bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.08),rgba(255,255,255,0.04))]" />
    </div>
  );
}

export function FieldGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid grid-cols-2 gap-2.5 max-[880px]:grid-cols-1", className)}>
      {children}
    </div>
  );
}

export function RuntimeField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--line)] bg-white/[0.03] p-3">
      <span className="text-[0.72rem] uppercase tracking-normal text-[var(--text-dim)]">
        {label}
      </span>
      <strong className="[font-family:var(--mono)] [overflow-wrap:anywhere]">
        {value}
      </strong>
    </div>
  );
}

export function PreformattedText({ value }: { value: string }) {
  return <pre>{value.length > 0 ? value : " "}</pre>;
}
