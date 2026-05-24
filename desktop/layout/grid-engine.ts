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
  rows?: number;
}

export function moveDesktopGridPanel<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  panelId: TPanelId,
  position: { x: number; y: number },
  options: DesktopGridEngineOptions,
): DesktopGridPanelLayout<TPanelId>[] {
  const rglLayout = createMutableRglLayout(layout, options);
  const item = getLayoutItem(rglLayout, panelId);

  if (!item) {
    return layout.map(copyDesktopGridPanel);
  }

  const movedLayout = moveMutableGridPanel(
    cloneLayout(rglLayout),
    panelId,
    position,
    options,
  );
  const validLayout = validLayoutOrNull(movedLayout, options);

  if (validLayout) {
    return toDesktopLayout(validLayout) as DesktopGridPanelLayout<TPanelId>[];
  }

  const boundedLayout = findValidMoveLayout(rglLayout, item, position, options);
  return toDesktopLayout(
    boundedLayout ?? compactLayout(rglLayout, options),
  ) as DesktopGridPanelLayout<TPanelId>[];
}

export function resizeDesktopGridPanel<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  panelId: TPanelId,
  size: { w: number; h: number },
  options: DesktopGridEngineOptions & { handle?: ResizeHandleAxis },
): DesktopGridPanelLayout<TPanelId>[] {
  const rglLayout = createMutableRglLayout(layout, options);
  const item = getLayoutItem(rglLayout, panelId);

  if (!item) {
    return layout.map(copyDesktopGridPanel);
  }

  const requestedSize = clampResizeSize(item, size, options);
  const resizedLayout = resizeMutableGridPanel(
    cloneLayout(rglLayout),
    panelId,
    requestedSize,
    options,
  );
  const validLayout = validLayoutOrNull(resizedLayout, options);

  if (validLayout) {
    return toDesktopLayout(validLayout) as DesktopGridPanelLayout<TPanelId>[];
  }

  const boundedLayout = findValidResizeLayout(
    rglLayout,
    item,
    requestedSize,
    options,
  );
  return toDesktopLayout(
    boundedLayout ?? compactLayout(rglLayout, options),
  ) as DesktopGridPanelLayout<TPanelId>[];
}

function moveMutableGridPanel<TPanelId extends string>(
  layout: Layout,
  panelId: TPanelId,
  position: { x: number; y: number },
  options: DesktopGridEngineOptions,
): Layout {
  const item = getLayoutItem(layout, panelId);
  if (!item) {
    return layout;
  }

  return compactLayout(
    moveElement(
      layout,
      item,
      position.x,
      position.y,
      true,
      options.preventCollision ?? false,
      compactTypeFor(options),
      options.columns,
      options.allowOverlap ?? false,
    ),
    options,
  );
}

function resizeMutableGridPanel<TPanelId extends string>(
  layout: Layout,
  panelId: TPanelId,
  size: { w: number; h: number },
  options: DesktopGridEngineOptions & { handle?: ResizeHandleAxis },
): Layout {
  const handle = options.handle ?? "se";
  let nextX: number | undefined;
  let nextY: number | undefined;
  let shouldMoveItem = false;

  const [resizedLayout, resizedItem] = withLayoutItem(
    layout,
    panelId,
    (item) => {
      let nextW = size.w;
      let nextH = size.h;

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
        const collisions = getAllCollisions(layout, {
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
    return layout;
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

  return compactLayout(finalLayout, options);
}

function createMutableRglLayout<TPanelId extends string>(
  layout: readonly DesktopGridPanelLayout<TPanelId>[],
  options: DesktopGridEngineOptions,
): LayoutItem[] {
  const rglLayout = layout.map((item) => {
    const minW = Math.min(item.minW ?? 1, options.columns);
    const maxW = Math.max(
      minW,
      Math.min(item.maxW ?? options.columns, options.columns),
    );
    const minH = item.minH ?? 1;
    const maxH = Math.max(
      minH,
      Math.min(item.maxH ?? options.rows ?? Infinity, options.rows ?? Infinity),
    );
    const w = clampGridValue(item.w, minW, maxW);
    const h = clampGridValue(item.h, minH, maxH);
    const maxY = options.rows === undefined ? Infinity : options.rows - h;

    return {
      i: item.panelId,
      x: clampGridValue(item.x, 0, options.columns - w),
      y: clampGridValue(item.y, 0, maxY),
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

function findValidMoveLayout(
  startLayout: Layout,
  startItem: LayoutItem,
  targetPosition: { x: number; y: number },
  options: DesktopGridEngineOptions,
): Layout | null {
  const deltaX = targetPosition.x - startItem.x;
  const deltaY = targetPosition.y - startItem.y;
  const maxSteps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  const visited = new Set<string>();

  for (let step = maxSteps - 1; step >= 0; step -= 1) {
    const position = {
      x: startItem.x + Math.round((deltaX * step) / maxSteps),
      y: startItem.y + Math.round((deltaY * step) / maxSteps),
    };
    const key = `${position.x}:${position.y}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const candidate = moveMutableGridPanel(
      cloneLayout(startLayout),
      startItem.i,
      position,
      options,
    );
    const valid = validLayoutOrNull(candidate, options);
    if (valid) {
      return valid;
    }
  }

  return null;
}

function findValidResizeLayout(
  startLayout: Layout,
  startItem: LayoutItem,
  targetSize: { w: number; h: number },
  options: DesktopGridEngineOptions & { handle?: ResizeHandleAxis },
): Layout | null {
  const deltaW = targetSize.w - startItem.w;
  const deltaH = targetSize.h - startItem.h;
  const maxSteps = Math.max(Math.abs(deltaW), Math.abs(deltaH));
  const visited = new Set<string>();

  for (let step = maxSteps - 1; step >= 0; step -= 1) {
    const size = {
      w: startItem.w + Math.round((deltaW * step) / maxSteps),
      h: startItem.h + Math.round((deltaH * step) / maxSteps),
    };
    const key = `${size.w}:${size.h}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const candidate = resizeMutableGridPanel(
      cloneLayout(startLayout),
      startItem.i,
      clampResizeSize(startItem, size, options),
      options,
    );
    const valid = validLayoutOrNull(candidate, options);
    if (valid) {
      return valid;
    }
  }

  return null;
}

function clampResizeSize(
  item: LayoutItem,
  size: { w: number; h: number },
  options: DesktopGridEngineOptions,
): { w: number; h: number } {
  const maxH = Math.min(
    item.maxH ?? options.rows ?? Infinity,
    options.rows ?? Infinity,
  );

  return {
    h: clampGridValue(size.h, item.minH ?? 1, maxH),
    w: clampGridValue(
      size.w,
      item.minW ?? 1,
      Math.min(item.maxW ?? options.columns, options.columns),
    ),
  };
}

function validLayoutOrNull(
  layout: Layout,
  options: DesktopGridEngineOptions,
): Layout | null {
  return isGridLayoutValid(layout, options) ? layout : null;
}

function isGridLayoutValid(
  layout: Layout,
  options: DesktopGridEngineOptions,
): boolean {
  return layout.every((item) => isGridItemWithinBounds(item, options)) &&
    !hasGridCollisions(layout, options);
}

function isGridItemWithinBounds(
  item: LayoutItem,
  options: DesktopGridEngineOptions,
): boolean {
  if (
    item.x < 0 ||
    item.y < 0 ||
    item.w < 1 ||
    item.h < 1 ||
    item.x + item.w > options.columns
  ) {
    return false;
  }

  return options.rows === undefined || item.y + item.h <= options.rows;
}

function hasGridCollisions(
  layout: Layout,
  options: DesktopGridEngineOptions,
): boolean {
  if (options.allowOverlap === true) {
    return false;
  }

  return layout.some((item) =>
    getAllCollisions(layout, item).some((candidate) => candidate.i !== item.i),
  );
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
