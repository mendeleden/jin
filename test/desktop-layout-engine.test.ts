import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  moveDesktopGridPanel,
  resizeDesktopGridPanel,
  type DesktopGridPanelLayout,
} from "../desktop/layout/grid-engine";
import { applyDesktopGridInteractionDelta } from "../desktop/layout/grid-interaction";
import { parseStoredDesktopLayouts } from "../desktop/layout/layout-storage";
import { normalizeStoredHomeLayout } from "../desktop/layout/preferences";
import {
  isHomePanelLayoutUsable,
  normalizeHomePanelLayout,
} from "../desktop/views/home/layout";

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

  test("respects a fixed row budget when resize would overflow neighbors", () => {
    const next = resizeDesktopGridPanel(
      DEFAULT_LAYOUT,
      "usage",
      { w: 12, h: 12 },
      { columns: 12, rows: 12 },
    );

    expect(panel(next, "usage")).toMatchObject({ h: 9, x: 0, y: 0 });
    expect(panel(next, "projects")).toMatchObject({ x: 0, y: 9, h: 3 });
    expect(panel(next, "harnesses")).toMatchObject({ x: 7, y: 9, h: 3 });
    expect(layoutFitsRows(next, 12)).toBe(true);
    expect(layoutHasOverlaps(next)).toBe(false);
  });

  test("pointer move gestures can return to their start layout", () => {
    const interaction = {
      mode: "move" as const,
      panelId: "harnesses" as const,
      startLayout: DEFAULT_LAYOUT,
      startPanel: panel(DEFAULT_LAYOUT, "harnesses"),
    };

    const moved = applyDesktopGridInteractionDelta(interaction, {
      columns: 12,
      deltaX: -7,
      deltaY: 0,
      rows: 12,
    });
    const restored = applyDesktopGridInteractionDelta(interaction, {
      columns: 12,
      deltaX: 0,
      deltaY: 0,
      rows: 12,
    });

    expect(panel(moved, "harnesses")).toMatchObject({ x: 0, y: 5 });
    expect(restored).toEqual(DEFAULT_LAYOUT);
  });

  test("pointer resize gestures can return to their start layout", () => {
    const interaction = {
      mode: "resize" as const,
      panelId: "projects" as const,
      startLayout: DEFAULT_LAYOUT,
      startPanel: panel(DEFAULT_LAYOUT, "projects"),
    };

    const resized = applyDesktopGridInteractionDelta(interaction, {
      columns: 12,
      deltaX: 2,
      deltaY: 1,
      rows: 12,
    });
    const restored = applyDesktopGridInteractionDelta(interaction, {
      columns: 12,
      deltaX: 0,
      deltaY: 0,
      rows: 12,
    });

    expect(panel(resized, "projects")).toMatchObject({ h: 4, w: 9 });
    expect(restored).toEqual(DEFAULT_LAYOUT);
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

  test("layout preference parsing falls back from invalid stored data", () => {
    expect(parseStoredDesktopLayouts("{")).toEqual({});
    expect(parseStoredDesktopLayouts("[]")).toEqual({});

    const stored = parseStoredDesktopLayouts(
      JSON.stringify({
        home: {
          schema: "home-grid-v1",
          panels: [{ panelId: "usage", x: 99, y: 99, w: 2, h: 1 }],
        },
      }),
    );
    const normalized = normalizeStoredHomeLayout(stored.home?.panels);

    expect(panel(normalized, "usage")).toMatchObject({
      h: 4,
      panelId: "usage",
      w: 6,
      x: 6,
      y: 8,
    });
    expect(panel(normalized, "projects")).toMatchObject({
      panelId: "projects",
      x: 0,
      y: 5,
    });
  });

  test("home layout normalization rejects overlap created by row clamping", () => {
    const overflowed = normalizeHomePanelLayout([
      { panelId: "usage", x: 0, y: 0, w: 12, h: 12 },
      { panelId: "projects", x: 0, y: 12, w: 7, h: 3 },
      { panelId: "harnesses", x: 7, y: 12, w: 5, h: 3 },
    ]);

    expect(overflowed).toEqual(DEFAULT_LAYOUT.map(({ minH, minW, ...item }) => item));
    expect(isHomePanelLayoutUsable(overflowed)).toBe(true);
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

function layoutFitsRows(
  layout: readonly DesktopGridPanelLayout<PanelId>[],
  rows: number,
): boolean {
  return layout.every((item) => item.y >= 0 && item.y + item.h <= rows);
}

function layoutHasOverlaps(
  layout: readonly DesktopGridPanelLayout<PanelId>[],
): boolean {
  return layout.some((item, index) =>
    layout.slice(index + 1).some((candidate) => panelsOverlap(item, candidate)),
  );
}

function panelsOverlap(
  left: DesktopGridPanelLayout<PanelId>,
  right: DesktopGridPanelLayout<PanelId>,
): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}
