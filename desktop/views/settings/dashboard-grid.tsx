import type { ReactNode } from "react";
import { EditableDashboardGrid } from "../../layout/editable-dashboard-grid";
import type { DesktopGridPanelLayout } from "../../layout/grid-engine";
import { desktopGridPanelPlacementClassName } from "../../layout/grid-placement";
import {
  DEFAULT_SETTINGS_PANEL_LAYOUT,
  SETTINGS_GRID_COLUMNS,
  SETTINGS_GRID_ROWS,
  SETTINGS_GRID_STACK_BREAKPOINT_PX,
  SETTINGS_LAYOUT_SCHEMA_VERSION,
  SETTINGS_PANEL_DEFINITION_BY_ID,
  normalizeSettingsPanelLayout,
  type SettingsPanelId,
  type SettingsPanelLayout,
} from "./layout";

export interface SettingsDashboardGridItem {
  children: ReactNode;
  panelId: SettingsPanelId;
}

export function SettingsDashboardGrid({
  editable = false,
  items,
  layout = DEFAULT_SETTINGS_PANEL_LAYOUT,
  onLayoutChange,
}: {
  editable?: boolean;
  items: readonly SettingsDashboardGridItem[];
  layout?: readonly SettingsPanelLayout[];
  onLayoutChange?(layout: readonly SettingsPanelLayout[]): void;
}) {
  const normalizedLayout = normalizeSettingsPanelLayout(layout);

  return (
    <EditableDashboardGrid
      columns={SETTINGS_GRID_COLUMNS}
      editable={editable}
      items={items.map((item) => ({
        ...item,
        title: SETTINGS_PANEL_DEFINITION_BY_ID[item.panelId].title,
      }))}
      layout={withSettingsPanelConstraints(normalizedLayout)}
      normalizeLayout={normalizeEditableSettingsLayout}
      onLayoutChange={(nextLayout) =>
        onLayoutChange?.(stripSettingsPanelConstraints(nextLayout))
      }
      panelClassName={settingsPanelClassName}
      rows={SETTINGS_GRID_ROWS}
      schema={SETTINGS_LAYOUT_SCHEMA_VERSION}
      surface="settings"
    />
  );
}

function withSettingsPanelConstraints(
  layout: readonly SettingsPanelLayout[],
): DesktopGridPanelLayout<SettingsPanelId>[] {
  return normalizeSettingsPanelLayout(layout).map((panelLayout) => {
    const definition = SETTINGS_PANEL_DEFINITION_BY_ID[panelLayout.panelId];
    return {
      ...panelLayout,
      minH: definition.minH,
      minW: definition.minW,
    };
  });
}

function normalizeEditableSettingsLayout(
  layout: readonly DesktopGridPanelLayout<SettingsPanelId>[],
): DesktopGridPanelLayout<SettingsPanelId>[] {
  return withSettingsPanelConstraints(stripSettingsPanelConstraints(layout));
}

function stripSettingsPanelConstraints(
  layout: readonly DesktopGridPanelLayout<SettingsPanelId>[],
): SettingsPanelLayout[] {
  return normalizeSettingsPanelLayout(
    layout.map((panelLayout) => ({
      h: panelLayout.h,
      panelId: panelLayout.panelId,
      w: panelLayout.w,
      x: panelLayout.x,
      y: panelLayout.y,
    })),
  );
}

function settingsPanelClassName(panelLayout: SettingsPanelLayout): string {
  return desktopGridPanelPlacementClassName(panelLayout, {
    columns: SETTINGS_GRID_COLUMNS,
    rows: SETTINGS_GRID_ROWS,
    stackBelowPx: SETTINGS_GRID_STACK_BREAKPOINT_PX,
  });
}
