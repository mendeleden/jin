import type { ReactNode } from "react";
import { EditableDashboardGrid } from "../../layout/editable-dashboard-grid";
import type { DesktopGridPanelLayout } from "../../layout/grid-engine";
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
  editable = false,
  items,
  layout = DEFAULT_HOME_PANEL_LAYOUT,
  onLayoutChange,
}: {
  editable?: boolean;
  items: readonly DashboardGridItem[];
  layout?: readonly HomePanelLayout[];
  onLayoutChange?(layout: readonly HomePanelLayout[]): void;
}) {
  return (
    <EditableDashboardGrid
      columns={HOME_GRID_COLUMNS}
      editable={editable}
      items={items.map((item) => ({
        ...item,
        title: HOME_PANEL_DEFINITION_BY_ID[item.panelId].title,
      }))}
      layout={withHomePanelConstraints(layout)}
      normalizeLayout={normalizeEditableHomeLayout}
      onLayoutChange={(nextLayout) =>
        onLayoutChange?.(stripHomePanelConstraints(nextLayout))
      }
      panelClassName={homePanelClassName}
      rows={HOME_GRID_ROWS}
      schema={HOME_LAYOUT_SCHEMA_VERSION}
      surface="home"
    />
  );
}

function withHomePanelConstraints(
  layout: readonly HomePanelLayout[],
): DesktopGridPanelLayout<HomePanelId>[] {
  return normalizeHomePanelLayout(layout).map((panelLayout) => {
    const definition = HOME_PANEL_DEFINITION_BY_ID[panelLayout.panelId];
    return {
      ...panelLayout,
      minH: definition.minH,
      minW: definition.minW,
    };
  });
}

function normalizeEditableHomeLayout(
  layout: readonly DesktopGridPanelLayout<HomePanelId>[],
): DesktopGridPanelLayout<HomePanelId>[] {
  return withHomePanelConstraints(stripHomePanelConstraints(layout));
}

function stripHomePanelConstraints(
  layout: readonly DesktopGridPanelLayout<HomePanelId>[],
): HomePanelLayout[] {
  return normalizeHomePanelLayout(
    layout.map((panelLayout) => ({
      h: panelLayout.h,
      panelId: panelLayout.panelId,
      w: panelLayout.w,
      x: panelLayout.x,
      y: panelLayout.y,
    })),
  );
}

function homePanelClassName(panelLayout: HomePanelLayout): string {
  return cx(
    "max-[1220px]:col-start-1 max-[1220px]:col-span-full max-[1220px]:row-auto",
    gridXClass(panelLayout.x),
    gridYClass(panelLayout.y),
    gridWClass(panelLayout.w),
    gridHClass(panelLayout.h),
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
