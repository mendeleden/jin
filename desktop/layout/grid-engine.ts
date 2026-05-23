import {
  cloneLayout,
  getAllCollisions,
  getCompactor,
  getLayoutItem,
  moveElement,
  withLayoutItem,
  type CompactType,
  type Layout,
  type LayoutItem,
  type ResizeHandleAxis,
} from "react-grid-layout/core";

export interface DesktopGridPanelLayout<TPanelId extends string = string> {
  panelId: TPanelId;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

export interface DesktopGridEngineOptions {
  columns: number;
  compactType?: CompactType;
  preventCollision?: boolean;
  allowOverlap?: boolean;
}

export function moveDesktopGridPanel<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  panelId: TPanelId,
  position: { x: number; y: number },
  options: DesktopGridEngineOptions,
): DesktopGridPanelLayout<TPanelId>[] {
  const rglLayout = createMutableRglLayout(layout, options.columns);
  const item = getLayoutItem(rglLayout, panelId);

  if (!item) {
    return layout.map(copyDesktopGridPanel);
  }

  const movedLayout = moveElement(
    rglLayout,
    item,
    position.x,
    position.y,
    true,
    options.preventCollision ?? false,
    compactTypeFor(options),
    options.columns,
    options.allowOverlap ?? false,
  );

  return toDesktopLayout(
    compactLayout(movedLayout, options),
  ) as DesktopGridPanelLayout<TPanelId>[];
}

export function resizeDesktopGridPanel<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  panelId: TPanelId,
  size: { w: number; h: number },
  options: DesktopGridEngineOptions & { handle?: ResizeHandleAxis },
): DesktopGridPanelLayout<TPanelId>[] {
  const rglLayout = createMutableRglLayout(layout, options.columns);
  const handle = options.handle ?? "se";
  let nextX: number | undefined;
  let nextY: number | undefined;
  let shouldMoveItem = false;

  const [resizedLayout, resizedItem] = withLayoutItem(
    rglLayout,
    panelId,
    (item) => {
      let nextW = clampGridValue(
        size.w,
        item.minW ?? 1,
        Math.min(item.maxW ?? options.columns, options.columns),
      );
      let nextH = clampGridValue(size.h, item.minH ?? 1, item.maxH ?? Infinity);

      nextX = item.x;
      nextY = item.y;

      if (handle.includes("w")) {
        nextX = Math.max(0, item.x + (item.w - nextW));
        if (nextX === item.x && nextW > item.w) {
          nextW = item.w;
        }
        shouldMoveItem = true;
      }

      if (handle.includes("n")) {
        nextY = Math.max(0, item.y + (item.h - nextH));
        if (nextY === item.y && nextH > item.h) {
          nextH = item.h;
        }
        shouldMoveItem = true;
      }

      if ((options.preventCollision ?? false) && !(options.allowOverlap ?? false)) {
        const collisions = getAllCollisions(rglLayout, {
          ...item,
          x: nextX,
          y: nextY,
          w: nextW,
          h: nextH,
        }).filter((candidate) => candidate.i !== item.i);

        if (collisions.length > 0) {
          nextX = item.x;
          nextY = item.y;
          nextW = item.w;
          nextH = item.h;
          shouldMoveItem = false;
        }
      }

      item.w = nextW;
      item.h = nextH;
      return item;
    },
  );

  if (!resizedItem) {
    return layout.map(copyDesktopGridPanel);
  }

  const finalLayout =
    shouldMoveItem && nextX !== undefined && nextY !== undefined
      ? moveElement(
          resizedLayout,
          resizedItem,
          nextX,
          nextY,
          true,
          options.preventCollision ?? false,
          compactTypeFor(options),
          options.columns,
          options.allowOverlap ?? false,
        )
      : resizedLayout;

  return toDesktopLayout(
    compactLayout(finalLayout, options),
  ) as DesktopGridPanelLayout<TPanelId>[];
}

function createMutableRglLayout<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  columns: number,
): LayoutItem[] {
  const rglLayout = layout.map((item) => {
    const minW = Math.min(item.minW ?? 1, columns);
    const maxW = Math.max(minW, Math.min(item.maxW ?? columns, columns));
    const minH = item.minH ?? 1;
    const maxH = Math.max(minH, item.maxH ?? Infinity);
    const w = clampGridValue(item.w, minW, maxW);
    const h = clampGridValue(item.h, minH, maxH);

    return {
      i: item.panelId,
      x: clampGridValue(item.x, 0, columns - w),
      y: clampGridValue(item.y, 0, Infinity),
      w,
      h,
      minW: item.minW,
      minH: item.minH,
      maxW: item.maxW,
      maxH: item.maxH,
      static: item.static,
    };
  });

  return cloneLayout(rglLayout);
}

function compactLayout(layout: Layout, options: DesktopGridEngineOptions): Layout {
  return getCompactor(
    compactTypeFor(options),
    options.allowOverlap ?? false,
    options.preventCollision ?? false,
  ).compact(layout, options.columns);
}

function toDesktopLayout(layout: Layout): DesktopGridPanelLayout[] {
  return layout.map((item) => ({
    panelId: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    ...(item.minW === undefined ? {} : { minW: item.minW }),
    ...(item.minH === undefined ? {} : { minH: item.minH }),
    ...(item.maxW === undefined ? {} : { maxW: item.maxW }),
    ...(item.maxH === undefined ? {} : { maxH: item.maxH }),
    ...(item.static === true ? { static: true } : {}),
  }));
}

function copyDesktopGridPanel<TPanelId extends string>(
  item: DesktopGridPanelLayout<TPanelId>,
): DesktopGridPanelLayout<TPanelId> {
  return { ...item };
}

function compactTypeFor(options: DesktopGridEngineOptions): CompactType {
  return options.compactType === undefined ? "vertical" : options.compactType;
}

function clampGridValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}
