import type { ReactNode } from "react";
import { cx } from "./classnames";

export interface SegmentedControlOption<TValue extends number | string> {
  disabled?: boolean;
  label: string;
  title?: string;
  value: TValue;
}

export function SegmentedControl<TValue extends number | string>({
  ariaLabel,
  buttonClassName,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  buttonClassName?: string;
  className?: string;
  onChange(value: TValue): void;
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cx(
        "inline-flex min-h-[34px] overflow-hidden rounded-[var(--radius-control)] border border-[rgba(210,224,255,0.12)] bg-[rgba(13,19,29,0.82)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
      role="group"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-pressed={selected}
            className={cx(
              "relative cursor-pointer border-0 border-l border-[rgba(210,224,255,0.08)] bg-transparent px-2 py-[5px] text-[0.76rem] font-semibold text-[rgba(164,175,196,0.72)] transition-[background-color,color,box-shadow] first:border-l-0 hover:text-[var(--text-soft)] disabled:cursor-default disabled:opacity-45",
              buttonClassName,
              selected &&
                "z-[1] bg-[linear-gradient(180deg,rgba(58,75,101,0.98),rgba(43,60,84,0.98))] font-bold text-[#f6f8fd] shadow-[inset_0_1px_0_rgba(255,255,255,0.075)] hover:text-[#f6f8fd]",
            )}
            data-selected={selected ? "true" : undefined}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={option.title}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
