import {
  Maximize2,
  Move,
  type LucideIcon,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cx } from "../ui/classnames";
import {
  moveDesktopGridPanel,
  resizeDesktopGridPanel,
  type DesktopGridPanelLayout,
} from "./grid-engine";
import {
  applyDesktopGridInteractionDelta,
  type DesktopGridInteractionMode,
} from "./grid-interaction";

interface EditableDashboardGridItem<TPanelId extends string> {
  children: ReactNode;
  panelId: TPanelId;
  title: string;
}

interface GridInteraction<TPanelId extends string> {
  mode: DesktopGridInteractionMode;
  panelId: TPanelId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLayout: DesktopGridPanelLayout<TPanelId>[];
  startPanel: DesktopGridPanelLayout<TPanelId>;
  xUnit: number;
  yUnit: number;
}

export function EditableDashboardGrid<TPanelId extends string>({
  className,
  columns,
  editable = false,
  items,
  layout,
  normalizeLayout,
  onLayoutChange,
  panelClassName,
  rows,
  schema,
  surface,
}: {
  className?: string;
  columns: number;
  editable?: boolean;
  items: readonly EditableDashboardGridItem<TPanelId>[];
  layout: readonly DesktopGridPanelLayout<TPanelId>[];
  normalizeLayout(
    layout: readonly DesktopGridPanelLayout<TPanelId>[],
  ): DesktopGridPanelLayout<TPanelId>[];
  onLayoutChange?(layout: readonly DesktopGridPanelLayout<TPanelId>[]): void;
  panelClassName(layout: DesktopGridPanelLayout<TPanelId>): string;
  rows: number;
  schema: string;
  surface: string;
}) {
  const gridRef = useRef<HTMLElement | null>(null);
  const [interaction, setInteraction] =
    useState<GridInteraction<TPanelId> | null>(null);
  const itemsByPanel = useMemo(
    () => new Map(items.map((item) => [item.panelId, item])),
    [items],
  );
  const normalizedLayout = normalizeLayout(layout);

  function applyLayout(nextLayout: readonly DesktopGridPanelLayout<TPanelId>[]) {
    onLayoutChange?.(normalizeLayout(nextLayout));
  }

  function startInteraction(
    event: ReactPointerEvent<HTMLElement>,
    panelLayout: DesktopGridPanelLayout<TPanelId>,
    mode: DesktopGridInteractionMode,
  ) {
    if (!editable) {
      return;
    }

    const gridElement = gridRef.current;
    if (!gridElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const metrics = readGridMetrics(gridElement, columns);
    setInteraction({
      mode,
      panelId: panelLayout.panelId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayout: normalizedLayout.map((item) => ({ ...item })),
      startPanel: { ...panelLayout },
      xUnit: metrics.xUnit,
      yUnit: metrics.yUnit,
    });
  }

  function updateInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const deltaX = Math.round(
      (event.clientX - interaction.startClientX) / interaction.xUnit,
    );
    const deltaY = Math.round(
      (event.clientY - interaction.startClientY) / interaction.yUnit,
    );

    applyLayout(
      applyDesktopGridInteractionDelta(interaction, {
        columns,
        deltaX,
        deltaY,
        rows,
      }),
    );
  }

  function stopInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setInteraction(null);
  }

  function handleMoveKey(
    event: KeyboardEvent<HTMLButtonElement>,
    panelLayout: DesktopGridPanelLayout<TPanelId>,
  ) {
    const delta = arrowKeyDelta(event);
    if (!delta) {
      return;
    }

    event.preventDefault();
    applyLayout(
      moveDesktopGridPanel(
        normalizedLayout,
        panelLayout.panelId,
        {
          x: panelLayout.x + delta.x,
          y: panelLayout.y + delta.y,
        },
        { columns, rows },
      ),
    );
  }

  function handleResizeKey(
    event: KeyboardEvent<HTMLButtonElement>,
    panelLayout: DesktopGridPanelLayout<TPanelId>,
  ) {
    const delta = arrowKeyDelta(event);
    if (!delta) {
      return;
    }

    event.preventDefault();
    applyLayout(
      resizeDesktopGridPanel(
        normalizedLayout,
        panelLayout.panelId,
        {
          h: panelLayout.h + delta.y,
          w: panelLayout.w + delta.x,
        },
        { columns, handle: "se", rows },
      ),
    );
  }

  return (
    <section
      className={cx(
        "grid min-h-0 flex-1 auto-rows-[80px] grid-cols-12 content-start gap-3 overflow-auto pb-0.5",
        editable &&
          "relative rounded-[var(--radius-panel)] outline outline-1 outline-[rgba(137,180,255,0.22)] outline-offset-2",
        className,
      )}
      data-dashboard-grid={surface}
      data-layout-interaction-mode={interaction?.mode ?? "idle"}
      data-layout-columns={String(columns)}
      data-layout-mode={editable ? "edit" : "view"}
      data-layout-rows={String(rows)}
      data-layout-schema={schema}
      ref={gridRef}
    >
      {editable ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[var(--radius-panel)] bg-[linear-gradient(to_right,rgba(137,180,255,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(137,180,255,0.08)_1px,transparent_1px)] bg-[length:8.333%_92px] opacity-55"
          data-layout-edit-grid="true"
        />
      ) : null}
      {normalizedLayout.map((panelLayout) => {
        const item = itemsByPanel.get(panelLayout.panelId);
        if (!item) {
          return null;
        }
        const activeMode =
          interaction?.panelId === panelLayout.panelId ? interaction.mode : "idle";
        const isActive = activeMode !== "idle";

        return (
          <div
            className={cx(
              "min-w-0",
              editable &&
                "relative z-10 rounded-[var(--radius-panel)] outline outline-1 outline-[rgba(137,180,255,0.24)] outline-offset-1 transition-[outline-color,box-shadow,transform]",
              isActive &&
                "outline-[rgba(137,180,255,0.7)] shadow-[0_0_0_1px_rgba(137,180,255,0.22),0_18px_44px_rgba(0,0,0,0.32)]",
              activeMode === "resize" && "cursor-se-resize",
              activeMode === "move" && "cursor-grabbing",
              panelClassName(panelLayout),
            )}
            data-layout-h={String(panelLayout.h)}
            data-layout-active-mode={activeMode}
            data-layout-w={String(panelLayout.w)}
            data-layout-x={String(panelLayout.x)}
            data-layout-y={String(panelLayout.y)}
            data-panel-id={panelLayout.panelId}
            data-panel-title={item.title}
            key={panelLayout.panelId}
          >
            {editable ? (
              <PanelEditControls
                onMoveKeyDown={(event) => handleMoveKey(event, panelLayout)}
                onMovePointerCancel={stopInteraction}
                onMovePointerDown={(event) =>
                  startInteraction(event, panelLayout, "move")
                }
                onMovePointerMove={updateInteraction}
                onMovePointerUp={stopInteraction}
                onResizeKeyDown={(event) => handleResizeKey(event, panelLayout)}
                onResizePointerCancel={stopInteraction}
                onResizePointerDown={(event) =>
                  startInteraction(event, panelLayout, "resize")
                }
                onResizePointerMove={updateInteraction}
                onResizePointerUp={stopInteraction}
                activeMode={activeMode}
                title={item.title}
              />
            ) : null}
            {item.children}
          </div>
        );
      })}
    </section>
  );
}

function PanelEditControls({
  activeMode,
  onMoveKeyDown,
  onMovePointerCancel,
  onMovePointerDown,
  onMovePointerMove,
  onMovePointerUp,
  onResizeKeyDown,
  onResizePointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  title,
}: {
  activeMode: DesktopGridInteractionMode | "idle";
  onMoveKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onMovePointerCancel(event: ReactPointerEvent<HTMLButtonElement>): void;
  onMovePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
  onMovePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void;
  onMovePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void;
  onResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onResizePointerCancel(event: ReactPointerEvent<HTMLButtonElement>): void;
  onResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
  onResizePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void;
  onResizePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void;
  title: string;
}) {
  return (
    <>
      <EditHandleButton
        ariaLabel={`Move ${title}`}
        className="left-2 top-2 cursor-grab active:cursor-grabbing"
        icon={Move}
        isActive={activeMode === "move"}
        label={title}
        onKeyDown={onMoveKeyDown}
        onPointerCancel={onMovePointerCancel}
        onPointerDown={onMovePointerDown}
        onPointerMove={onMovePointerMove}
        onPointerUp={onMovePointerUp}
        testId="move"
      />
      <EditHandleButton
        ariaLabel={`Resize ${title}`}
        className="bottom-2 right-2 cursor-se-resize after:absolute after:bottom-2 after:right-2 after:h-3 after:w-3 after:rounded-br-[5px] after:border-b after:border-r after:border-[rgba(210,224,255,0.58)]"
        icon={Maximize2}
        isActive={activeMode === "resize"}
        onKeyDown={onResizeKeyDown}
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        size="icon"
        testId="resize"
      />
    </>
  );
}

function EditHandleButton({
  ariaLabel,
  className,
  icon: Icon,
  isActive = false,
  label,
  size = "label",
  testId,
  ...props
}: {
  ariaLabel: string;
  className?: string;
  icon: LucideIcon;
  isActive?: boolean;
  label?: string;
  size?: "icon" | "label";
  testId: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={ariaLabel}
      className={cx(
        "absolute z-20 inline-flex max-w-[calc(100%-16px)] touch-none select-none items-center justify-center gap-1.5 rounded-[10px] border border-[rgba(137,180,255,0.28)] bg-[rgba(8,12,19,0.92)] text-[0.72rem] font-semibold text-[var(--text)] shadow-[0_10px_22px_rgba(0,0,0,0.28)] backdrop-blur-[12px] transition-[border-color,background,box-shadow,color,transform] hover:border-[rgba(137,180,255,0.44)] focus-visible:border-[rgba(137,180,255,0.58)] focus-visible:outline-none [&_svg]:h-3.5 [&_svg]:w-3.5",
        size === "icon" ? "h-10 w-10 p-0" : "min-h-9 px-2.5 py-1.5",
        isActive &&
          "border-[rgba(137,180,255,0.7)] bg-[rgba(33,52,82,0.96)] shadow-[0_0_0_1px_rgba(137,180,255,0.28),0_12px_28px_rgba(0,0,0,0.34)]",
        className,
      )}
      data-layout-edit-active={isActive ? "true" : "false"}
      data-layout-edit-handle={testId}
      title={ariaLabel}
      type="button"
      {...props}
    >
      <Icon aria-hidden="true" />
      {label ? <span className="truncate">{label}</span> : null}
    </button>
  );
}

function readGridMetrics(element: HTMLElement, columns: number) {
  const styles = window.getComputedStyle(element);
  const columnGap = pixelValue(styles.columnGap);
  const rowGap = pixelValue(styles.rowGap);
  const rowHeight = pixelValue(styles.gridAutoRows) || 80;
  const rect = element.getBoundingClientRect();
  const columnWidth = Math.max(
    1,
    (rect.width - columnGap * Math.max(0, columns - 1)) / columns,
  );

  return {
    xUnit: columnWidth + columnGap,
    yUnit: rowHeight + rowGap,
  };
}

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrowKeyDelta(event: KeyboardEvent): { x: number; y: number } | null {
  if (event.key === "ArrowLeft") {
    return { x: -1, y: 0 };
  }
  if (event.key === "ArrowRight") {
    return { x: 1, y: 0 };
  }
  if (event.key === "ArrowUp") {
    return { x: 0, y: -1 };
  }
  if (event.key === "ArrowDown") {
    return { x: 0, y: 1 };
  }
  return null;
}
