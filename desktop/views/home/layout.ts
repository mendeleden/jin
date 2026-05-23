export const HOME_LAYOUT_SCHEMA_VERSION = "home-grid-v1";
export const HOME_GRID_COLUMNS = 12;
export const HOME_GRID_ROWS = 12;

export const HOME_PANEL_IDS = ["usage", "projects", "harnesses"] as const;

export type HomePanelId = (typeof HOME_PANEL_IDS)[number];

export interface PanelGridPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HomePanelDefinition {
  id: HomePanelId;
  title: string;
  minW: number;
  minH: number;
  defaultLayout: PanelGridPlacement;
}

export type HomePanelLayout = PanelGridPlacement & {
  panelId: HomePanelId;
};

export type HomePanelWidth = "narrow" | "standard" | "wide";
export type HomePanelHeight = "short" | "standard" | "tall";
export type HomePanelDensity = "compact" | "standard" | "expanded";

export interface HomePanelLayoutContext {
  density: HomePanelDensity;
  height: HomePanelHeight;
  layout: HomePanelLayout;
  width: HomePanelWidth;
}

export const HOME_PANEL_DEFINITION_BY_ID = {
  usage: {
    id: "usage",
    title: "Token & Cost Observatory",
    minW: 6,
    minH: 4,
    defaultLayout: { x: 0, y: 0, w: 12, h: 5 },
  },
  projects: {
    id: "projects",
    title: "Project Stacks",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 0, y: 5, w: 7, h: 3 },
  },
  harnesses: {
    id: "harnesses",
    title: "Harness Timeline",
    minW: 4,
    minH: 3,
    defaultLayout: { x: 7, y: 5, w: 5, h: 3 },
  },
} satisfies Record<HomePanelId, HomePanelDefinition>;

export const HOME_PANEL_DEFINITIONS: readonly HomePanelDefinition[] =
  HOME_PANEL_IDS.map((panelId) => HOME_PANEL_DEFINITION_BY_ID[panelId]);

export const DEFAULT_HOME_PANEL_LAYOUT: readonly HomePanelLayout[] =
  HOME_PANEL_DEFINITIONS.map((definition) => ({
    panelId: definition.id,
    ...definition.defaultLayout,
  }));

export function getHomePanelLayout(panelId: HomePanelId): HomePanelLayout {
  const definition = HOME_PANEL_DEFINITION_BY_ID[panelId];
  return {
    panelId,
    ...definition.defaultLayout,
  };
}

export function getHomePanelLayoutContext(
  layout: HomePanelLayout,
): HomePanelLayoutContext {
  const width = getHomePanelWidth(layout.w);
  const height = getHomePanelHeight(layout.h);

  return {
    density: getHomePanelDensity(layout, width, height),
    height,
    layout,
    width,
  };
}

export function normalizeHomePanelLayout(
  layout: readonly HomePanelLayout[] = DEFAULT_HOME_PANEL_LAYOUT,
): HomePanelLayout[] {
  const layoutByPanel = new Map(layout.map((item) => [item.panelId, item]));

  return HOME_PANEL_DEFINITIONS.map((definition) => {
    const candidate = layoutByPanel.get(definition.id) ?? {
      panelId: definition.id,
      ...definition.defaultLayout,
    };
    const w = clampGridValue(candidate.w, definition.minW, HOME_GRID_COLUMNS);
    const h = clampGridValue(candidate.h, definition.minH, HOME_GRID_ROWS);
    const x = clampGridValue(candidate.x, 0, HOME_GRID_COLUMNS - w);
    const y = clampGridValue(candidate.y, 0, HOME_GRID_ROWS - h);

    return {
      panelId: definition.id,
      x,
      y,
      w,
      h,
    };
  });
}

function getHomePanelWidth(width: number): HomePanelWidth {
  if (width <= 5) {
    return "narrow";
  }
  if (width >= 9) {
    return "wide";
  }
  return "standard";
}

function getHomePanelHeight(height: number): HomePanelHeight {
  if (height <= 3) {
    return "short";
  }
  if (height >= 6) {
    return "tall";
  }
  return "standard";
}

function getHomePanelDensity(
  layout: HomePanelLayout,
  width: HomePanelWidth,
  height: HomePanelHeight,
): HomePanelDensity {
  if (height === "short" || width === "narrow") {
    return "compact";
  }
  if (height === "tall" && layout.w >= 8) {
    return "expanded";
  }
  return "standard";
}

function clampGridValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
