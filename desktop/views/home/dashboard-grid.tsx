import type { ReactNode } from "react";
import { EditableDashboardGrid } from "../../layout/editable-dashboard-grid";
import type { DesktopGridPanelLayout } from "../../layout/grid-engine";
import { desktopGridPanelPlacementClassName } from "../../layout/grid-placement";
import {
  DEFAULT_HOME_PANEL_LAYOUT,
  HOME_GRID_COLUMNS,
  HOME_GRID_ROWS,
  HOME_GRID_STACK_BREAKPOINT_PX,
  HOME_LAYOUT_SCHEMA_VERSION,
  HOME_PANEL_DEFINITION_BY_ID,
  getHomePanelLayout,
  getHomePanelLayoutContext,
  normalizeHomePanelLayout,
  type HomePanelId,
  type HomePanelLayout,
  type HomePanelLayoutContext,
} from "./layout";

export interface DashboardGridItem {
  panelId: HomePanelId;
  children: ReactNode | ((context: DashboardGridItemContext) => ReactNode);
}

export interface DashboardGridItemContext {
  panel: HomePanelLayoutContext;
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
  const normalizedLayout = normalizeHomePanelLayout(layout);
  const layoutByPanel = new Map(
    normalizedLayout.map((panelLayout) => [panelLayout.panelId, panelLayout]),
  );

  return (
    <EditableDashboardGrid
      columns={HOME_GRID_COLUMNS}
      editable={editable}
      items={items.map((item) => ({
        ...item,
        children: renderDashboardGridItemChildren(
          item.children,
          layoutByPanel.get(item.panelId) ?? getHomePanelLayout(item.panelId),
        ),
        title: HOME_PANEL_DEFINITION_BY_ID[item.panelId].title,
      }))}
      layout={withHomePanelConstraints(normalizedLayout)}
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

function renderDashboardGridItemChildren(
  children: DashboardGridItem["children"],
  layout: HomePanelLayout,
): ReactNode {
  if (typeof children === "function") {
    return children({
      panel: getHomePanelLayoutContext(layout),
    });
  }

  return children;
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
  return desktopGridPanelPlacementClassName(panelLayout, {
    columns: HOME_GRID_COLUMNS,
    rows: HOME_GRID_ROWS,
    stackBelowPx: HOME_GRID_STACK_BREAKPOINT_PX,
  });
}
