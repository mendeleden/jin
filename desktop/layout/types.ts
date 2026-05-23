export type DesktopLayoutBreakpoint = "desktop";

export interface DesktopSurfaceLayout<TPanelId extends string = string> {
  breakpoint: DesktopLayoutBreakpoint;
  panels: readonly DesktopPanelPlacement<TPanelId>[];
  schema: string;
}

export interface DesktopPanelPlacement<TPanelId extends string = string> {
  h: number;
  panelId: TPanelId;
  w: number;
  x: number;
  y: number;
}
