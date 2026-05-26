import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./classnames";

type TooltipSide = "left" | "right";

const TOOLTIP_OFFSET_PX = 10;
const VIEWPORT_PADDING_PX = 12;
const DEFAULT_TOOLTIP_WIDTH_PX = 280;

interface TooltipPosition {
  left: number;
  side: TooltipSide;
  top: number;
  width: number;
}

export function FloatingTooltip({
  children,
  content,
  id,
  width = DEFAULT_TOOLTIP_WIDTH_PX,
}: {
  children: ReactNode;
  content: ReactNode;
  id?: string;
  width?: number;
}) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (typeof window === "undefined" || !triggerRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = Math.min(
      width,
      Math.max(180, window.innerWidth - VIEWPORT_PADDING_PX * 2),
    );
    const canPlaceRight =
      triggerRect.right + TOOLTIP_OFFSET_PX + tooltipWidth <=
      window.innerWidth - VIEWPORT_PADDING_PX;
    const side: TooltipSide = canPlaceRight ? "right" : "left";
    const preferredLeft =
      side === "right"
        ? triggerRect.right + TOOLTIP_OFFSET_PX
        : triggerRect.left - tooltipWidth - TOOLTIP_OFFSET_PX;

    setPosition({
      left: clamp(
        preferredLeft,
        VIEWPORT_PADDING_PX,
        window.innerWidth - tooltipWidth - VIEWPORT_PADDING_PX,
      ),
      side,
      top: clamp(
        triggerRect.top + triggerRect.height / 2,
        VIEWPORT_PADDING_PX + 18,
        window.innerHeight - VIEWPORT_PADDING_PX - 18,
      ),
      width: tooltipWidth,
    });
  }, [width]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const showTooltip = useCallback(() => {
    setOpen(true);
    updatePosition();
  }, [updatePosition]);

  const hideTooltip = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <span
        className="inline-flex"
        data-floating-tooltip-trigger
        onBlur={hideTooltip}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        ref={triggerRef}
      >
        {children}
      </span>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <span
              className="pointer-events-none fixed z-[10000] rounded-[10px] border border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] px-2.5 py-[9px] text-[0.74rem] leading-[1.4] text-[var(--text-soft)] shadow-[var(--tooltip-shadow)] backdrop-blur-[12px]"
              data-floating-tooltip
              id={tooltipId}
              role="tooltip"
              style={{
                left: position.left,
                top: position.top,
                transform: "translateY(-50%)",
                width: position.width,
              }}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border border-[var(--tooltip-border)] bg-[var(--tooltip-bg)]",
                  position.side === "right"
                    ? "-left-[6px] border-r-0 border-t-0"
                    : "-right-[6px] border-b-0 border-l-0",
                )}
              />
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
