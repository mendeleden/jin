export const SETTINGS_LAYOUT_SCHEMA_VERSION = "settings-grid-v1";
export const SETTINGS_GRID_COLUMNS = 12;
export const SETTINGS_GRID_ROWS = 8;
export const SETTINGS_GRID_STACK_BREAKPOINT_PX = 1220;

export const SETTINGS_PANEL_IDS = [
  "theme",
  "refresh",
  "runtime",
  "paths",
] as const;

export type SettingsPanelId = (typeof SETTINGS_PANEL_IDS)[number];

export interface SettingsPanelGridPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SettingsPanelDefinition {
  defaultLayout: SettingsPanelGridPlacement;
  id: SettingsPanelId;
  minH: number;
  minW: number;
  title: string;
}

export type SettingsPanelLayout = SettingsPanelGridPlacement & {
  panelId: SettingsPanelId;
};

export const SETTINGS_PANEL_DEFINITION_BY_ID = {
  theme: {
    id: "theme",
    title: "Theme",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 0, y: 0, w: 6, h: 3 },
  },
  refresh: {
    id: "refresh",
    title: "Shell refresh",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 6, y: 0, w: 6, h: 3 },
  },
  runtime: {
    id: "runtime",
    title: "Daemon status",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 0, y: 3, w: 6, h: 3 },
  },
  paths: {
    id: "paths",
    title: "Local files",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 6, y: 3, w: 6, h: 3 },
  },
} satisfies Record<SettingsPanelId, SettingsPanelDefinition>;

export const SETTINGS_PANEL_DEFINITIONS: readonly SettingsPanelDefinition[] =
  SETTINGS_PANEL_IDS.map((panelId) => SETTINGS_PANEL_DEFINITION_BY_ID[panelId]);

export const DEFAULT_SETTINGS_PANEL_LAYOUT: readonly SettingsPanelLayout[] =
  SETTINGS_PANEL_DEFINITIONS.map((definition) => ({
    panelId: definition.id,
    ...definition.defaultLayout,
  }));

export function normalizeSettingsPanelLayout(
  layout: readonly SettingsPanelLayout[] = DEFAULT_SETTINGS_PANEL_LAYOUT,
): SettingsPanelLayout[] {
  const layoutByPanel = new Map(layout.map((item) => [item.panelId, item]));

  const normalizedLayout = SETTINGS_PANEL_DEFINITIONS.map((definition) => {
    const candidate = layoutByPanel.get(definition.id) ?? {
      panelId: definition.id,
      ...definition.defaultLayout,
    };
    const w = clampGridValue(candidate.w, definition.minW, SETTINGS_GRID_COLUMNS);
    const h = clampGridValue(candidate.h, definition.minH, SETTINGS_GRID_ROWS);
    const x = clampGridValue(candidate.x, 0, SETTINGS_GRID_COLUMNS - w);
    const y = clampGridValue(candidate.y, 0, SETTINGS_GRID_ROWS - h);

    return {
      panelId: definition.id,
      x,
      y,
      w,
      h,
    };
  });

  if (!isSettingsPanelLayoutUsable(normalizedLayout)) {
    return DEFAULT_SETTINGS_PANEL_LAYOUT.map((item) => ({ ...item }));
  }

  return normalizedLayout;
}

export function isSettingsPanelLayoutUsable(
  layout: readonly SettingsPanelLayout[],
): boolean {
  return layout.every((item) => isSettingsPanelWithinBoard(item)) &&
    !layout.some((item, index) =>
      layout
        .slice(index + 1)
        .some((candidate) => settingsPanelsOverlap(item, candidate)),
    );
}

function isSettingsPanelWithinBoard(item: SettingsPanelLayout): boolean {
  return (
    item.x >= 0 &&
    item.y >= 0 &&
    item.w >= 1 &&
    item.h >= 1 &&
    item.x + item.w <= SETTINGS_GRID_COLUMNS &&
    item.y + item.h <= SETTINGS_GRID_ROWS
  );
}

function settingsPanelsOverlap(
  left: SettingsPanelLayout,
  right: SettingsPanelLayout,
): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function clampGridValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
