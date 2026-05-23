export const DESKTOP_LAYOUT_STORAGE_KEY = "jin.desktop.layouts.v1";

export interface StoredDesktopLayouts {
  home?: {
    panels?: unknown;
    schema?: unknown;
  };
}

export function readStoredDesktopLayouts(): StoredDesktopLayouts {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return parseStoredDesktopLayouts(
      window.localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

export function writeStoredDesktopLayouts(layouts: StoredDesktopLayouts): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      DESKTOP_LAYOUT_STORAGE_KEY,
      JSON.stringify(layouts),
    );
  } catch {
    // localStorage can be unavailable in hardened renderer contexts.
  }
}

export function parseStoredDesktopLayouts(
  value: string | null,
): StoredDesktopLayouts {
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as StoredDesktopLayouts;
  } catch {
    return {};
  }
}
