import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  moveDesktopGridPanel,
  resizeDesktopGridPanel,
  type DesktopGridPanelLayout,
} from "../desktop/layout/grid-engine";

type PanelId = "usage" | "projects" | "harnesses";

const DEFAULT_LAYOUT: readonly DesktopGridPanelLayout<PanelId>[] = [
  { panelId: "usage", x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 },
  { panelId: "projects", x: 0, y: 5, w: 7, h: 3, minW: 4, minH: 3 },
  { panelId: "harnesses", x: 7, y: 5, w: 5, h: 3, minW: 4, minH: 3 },
];

describe("desktop grid engine", () => {
  test("uses react-grid-layout core movement without mutating Jin layout data", () => {
    const before = structuredClone(DEFAULT_LAYOUT);

    const next = moveDesktopGridPanel(
      DEFAULT_LAYOUT,
      "harnesses",
      { x: 0, y: 5 },
      { columns: 12 },
    );

    expect(DEFAULT_LAYOUT).toEqual(before);
    expect(panel(next, "harnesses")).toMatchObject({ x: 0, y: 5 });
    expect(panel(next, "projects").y).toBeGreaterThan(5);
    expect(next.some((item) => "i" in item || "moved" in item)).toBe(false);
    expect(next.some((item) => "static" in item && item.static !== true)).toBe(
      false,
    );
  });

  test("can block collisions when the caller wants fixed slot behavior", () => {
    const next = moveDesktopGridPanel(
      DEFAULT_LAYOUT,
      "harnesses",
      { x: 0, y: 5 },
      { columns: 12, compactType: null, preventCollision: true },
    );

    expect(panel(next, "harnesses")).toMatchObject({ x: 7, y: 5 });
    expect(panel(next, "projects")).toMatchObject({ x: 0, y: 5 });
  });

  test("resizes with min constraints and lets RGL compaction move neighbors", () => {
    const next = resizeDesktopGridPanel(
      DEFAULT_LAYOUT,
      "projects",
      { w: 9, h: 4 },
      { columns: 12 },
    );

    expect(panel(next, "projects")).toMatchObject({ x: 0, y: 5, w: 9, h: 4 });
    expect(panel(next, "harnesses").y).toBeGreaterThan(5);

    const clamped = resizeDesktopGridPanel(
      DEFAULT_LAYOUT,
      "projects",
      { w: 1, h: 1 },
      { columns: 12 },
    );

    expect(panel(clamped, "projects")).toMatchObject({ w: 4, h: 3 });
  });

  test("keeps the RGL dependency behind the core adapter, not the renderer", () => {
    const engineSource = readFileSync(
      new URL("../desktop/layout/grid-engine.ts", import.meta.url),
      "utf8",
    );
    const dashboardGridSource = readFileSync(
      new URL("../desktop/views/home/dashboard-grid.tsx", import.meta.url),
      "utf8",
    );

    expect(engineSource).toContain('from "react-grid-layout/core"');
    expect(engineSource).not.toContain('from "react-grid-layout"');
    expect(engineSource).not.toContain("style={{");
    expect(engineSource).not.toContain("setTransform");
    expect(engineSource).not.toContain("setTopLeft");
    expect(dashboardGridSource).not.toContain("react-grid-layout");
  });
});

function panel(
  layout: readonly DesktopGridPanelLayout<PanelId>[],
  panelId: PanelId,
): DesktopGridPanelLayout<PanelId> {
  const item = layout.find((candidate) => candidate.panelId === panelId);
  if (!item) {
    throw new Error(`Missing panel ${panelId}`);
  }
  return item;
}
