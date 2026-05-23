import type { ReactNode } from "react";
import { cx } from "../../ui/classnames";
import {
  DEFAULT_HOME_PANEL_LAYOUT,
  HOME_GRID_COLUMNS,
  HOME_GRID_ROWS,
  HOME_LAYOUT_SCHEMA_VERSION,
  HOME_PANEL_DEFINITION_BY_ID,
  normalizeHomePanelLayout,
  type HomePanelId,
  type HomePanelLayout,
} from "./layout";

const GRID_X_CLASSES = [
  "col-start-1",
  "col-start-2",
  "col-start-3",
  "col-start-4",
  "col-start-5",
  "col-start-6",
  "col-start-7",
  "col-start-8",
  "col-start-9",
  "col-start-10",
  "col-start-11",
  "col-start-12",
] as const;

const GRID_Y_CLASSES = [
  "row-start-1",
  "row-start-2",
  "row-start-3",
  "row-start-4",
  "row-start-5",
  "row-start-6",
  "row-start-7",
  "row-start-8",
  "row-start-9",
  "row-start-10",
  "row-start-11",
  "row-start-12",
  "row-start-13",
] as const;

const GRID_W_CLASSES = [
  "col-span-1",
  "col-span-2",
  "col-span-3",
  "col-span-4",
  "col-span-5",
  "col-span-6",
  "col-span-7",
  "col-span-8",
  "col-span-9",
  "col-span-10",
  "col-span-11",
  "col-span-12",
] as const;

const GRID_H_CLASSES = [
  "row-span-1",
  "row-span-2",
  "row-span-3",
  "row-span-4",
  "row-span-5",
  "row-span-6",
  "row-span-7",
  "row-span-8",
  "row-span-9",
  "row-span-10",
  "row-span-11",
  "row-span-12",
] as const;

export interface DashboardGridItem {
  panelId: HomePanelId;
  children: ReactNode;
}

export function DashboardGrid({
  items,
  layout = DEFAULT_HOME_PANEL_LAYOUT,
}: {
  items: readonly DashboardGridItem[];
  layout?: readonly HomePanelLayout[];
}) {
  const normalizedLayout = normalizeHomePanelLayout(layout);
  const itemsByPanel = new Map(items.map((item) => [item.panelId, item]));

  return (
    <section
      className="grid min-h-0 flex-1 auto-rows-[80px] grid-cols-12 content-start gap-3 overflow-auto pb-0.5"
      data-dashboard-grid="home"
      data-layout-columns={String(HOME_GRID_COLUMNS)}
      data-layout-schema={HOME_LAYOUT_SCHEMA_VERSION}
    >
      {normalizedLayout.map((panelLayout) => {
        const item = itemsByPanel.get(panelLayout.panelId);
        if (!item) {
          return null;
        }

        const definition = HOME_PANEL_DEFINITION_BY_ID[panelLayout.panelId];
        const className = cx(
          "min-w-0 max-[1220px]:col-start-1 max-[1220px]:col-span-full max-[1220px]:row-auto",
          gridXClass(panelLayout.x),
          gridYClass(panelLayout.y),
          gridWClass(panelLayout.w),
          gridHClass(panelLayout.h),
        );

        return (
          <div
            className={className}
            data-layout-h={String(panelLayout.h)}
            data-layout-w={String(panelLayout.w)}
            data-layout-x={String(panelLayout.x)}
            data-layout-y={String(panelLayout.y)}
            data-panel-id={panelLayout.panelId}
            data-panel-title={definition.title}
            key={panelLayout.panelId}
          >
            {item.children}
          </div>
        );
      })}
    </section>
  );
}

function gridXClass(value: number): string {
  return GRID_X_CLASSES[clampGridValue(value, 0, HOME_GRID_COLUMNS - 1)] ?? GRID_X_CLASSES[0];
}

function gridYClass(value: number): string {
  return GRID_Y_CLASSES[clampGridValue(value, 0, HOME_GRID_ROWS)] ?? GRID_Y_CLASSES[0];
}

function gridWClass(value: number): string {
  return GRID_W_CLASSES[clampGridValue(value, 1, HOME_GRID_COLUMNS) - 1] ?? GRID_W_CLASSES[0];
}

function gridHClass(value: number): string {
  return GRID_H_CLASSES[clampGridValue(value, 1, HOME_GRID_ROWS) - 1] ?? GRID_H_CLASSES[0];
}

function clampGridValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
