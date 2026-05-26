import type { DesktopGridPanelLayout } from "./grid-engine";
import { cx } from "../ui/classnames";

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

const STACK_BREAKPOINT_CLASSES = {
  1220: "max-[1220px]:col-start-1 max-[1220px]:col-span-full max-[1220px]:row-auto",
} as const;

export function desktopGridPanelPlacementClassName<TPanelId extends string>(
  panelLayout: DesktopGridPanelLayout<TPanelId>,
  {
    columns,
    rows,
    stackBelowPx,
  }: {
    columns: number;
    rows: number;
    stackBelowPx?: keyof typeof STACK_BREAKPOINT_CLASSES;
  },
): string {
  return cx(
    stackBelowPx ? STACK_BREAKPOINT_CLASSES[stackBelowPx] : undefined,
    gridXClass(panelLayout.x, columns),
    gridYClass(panelLayout.y, rows),
    gridWClass(panelLayout.w, columns),
    gridHClass(panelLayout.h, rows),
  );
}

function gridXClass(value: number, columns: number): string {
  return GRID_X_CLASSES[clampGridValue(value, 0, columns - 1)] ?? GRID_X_CLASSES[0];
}

function gridYClass(value: number, rows: number): string {
  return GRID_Y_CLASSES[clampGridValue(value, 0, rows)] ?? GRID_Y_CLASSES[0];
}

function gridWClass(value: number, columns: number): string {
  return GRID_W_CLASSES[clampGridValue(value, 1, columns) - 1] ?? GRID_W_CLASSES[0];
}

function gridHClass(value: number, rows: number): string {
  return GRID_H_CLASSES[clampGridValue(value, 1, rows) - 1] ?? GRID_H_CLASSES[0];
}

function clampGridValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
