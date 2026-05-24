import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./classnames";

type ButtonVariant = "default" | "primary" | "subtle";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-[7px] rounded-[var(--radius-control)] border border-[var(--line)] text-[var(--text)] transition-[border-color,background,transform] duration-150 hover:border-[var(--line-strong)] disabled:pointer-events-none disabled:opacity-55 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:shrink-0";

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "bg-[var(--field-bg)]",
  primary:
    "border-[var(--control-selected-border)] bg-[var(--control-selected-bg)] font-bold text-[var(--control-selected-text)]",
  subtle: "bg-[var(--field-bg)] px-[9px]",
};

const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-2 py-[5px]",
  md: "px-3 py-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      size = "sm",
      type = "button",
      variant = "default",
      ...props
    },
    ref,
  ) => (
    <button
      className={cx(
        BUTTON_BASE,
        BUTTON_SIZE_CLASS[size],
        BUTTON_VARIANT_CLASS[variant],
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = "Button";
