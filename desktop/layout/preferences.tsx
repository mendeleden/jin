import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_HOME_PANEL_LAYOUT,
  HOME_LAYOUT_SCHEMA_VERSION,
  HOME_PANEL_IDS,
  normalizeHomePanelLayout,
  type HomePanelId,
  type HomePanelLayout,
} from "../views/home/layout";
import {
  readStoredDesktopLayouts,
  writeStoredDesktopLayouts,
} from "./layout-storage";

export interface DesktopLayoutPreferences {
  homeLayout: readonly HomePanelLayout[];
  resetHomeLayout(): void;
  setHomeLayout(layout: readonly HomePanelLayout[]): void;
}

const DEFAULT_DESKTOP_LAYOUT_PREFERENCES: DesktopLayoutPreferences = {
  homeLayout: DEFAULT_HOME_PANEL_LAYOUT,
  resetHomeLayout() {},
  setHomeLayout() {},
};

const DesktopLayoutPreferencesContext =
  createContext<DesktopLayoutPreferences>(DEFAULT_DESKTOP_LAYOUT_PREFERENCES);

export function DesktopLayoutPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [homeLayout, setHomeLayoutState] = useState<readonly HomePanelLayout[]>(
    () => readStoredHomeLayout(),
  );

  const setHomeLayout = useCallback((layout: readonly HomePanelLayout[]) => {
    const nextLayout = normalizeHomePanelLayout(layout);
    setHomeLayoutState(nextLayout);
    writeStoredHomeLayout(nextLayout);
  }, []);

  const resetHomeLayout = useCallback(() => {
    const nextLayout = normalizeHomePanelLayout(DEFAULT_HOME_PANEL_LAYOUT);
    setHomeLayoutState(nextLayout);
    writeStoredHomeLayout(nextLayout);
  }, []);

  const value = useMemo(
    () => ({
      homeLayout,
      resetHomeLayout,
      setHomeLayout,
    }),
    [homeLayout, resetHomeLayout, setHomeLayout],
  );

  return (
    <DesktopLayoutPreferencesContext.Provider value={value}>
      {children}
    </DesktopLayoutPreferencesContext.Provider>
  );
}

export function useDesktopLayoutPreferences(): DesktopLayoutPreferences {
  return useContext(DesktopLayoutPreferencesContext);
}

export function normalizeStoredHomeLayout(value: unknown): HomePanelLayout[] {
  if (!Array.isArray(value)) {
    return normalizeHomePanelLayout(DEFAULT_HOME_PANEL_LAYOUT);
  }

  return normalizeHomePanelLayout(
    value.flatMap((item): HomePanelLayout[] => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const candidate = item as Partial<Record<keyof HomePanelLayout, unknown>>;
      if (!isHomePanelId(candidate.panelId)) {
        return [];
      }

      return [
        {
          h: numberOrFallback(candidate.h, 1),
          panelId: candidate.panelId,
          w: numberOrFallback(candidate.w, 1),
          x: numberOrFallback(candidate.x, 0),
          y: numberOrFallback(candidate.y, 0),
        },
      ];
    }),
  );
}

function readStoredHomeLayout(): HomePanelLayout[] {
  const stored = readStoredDesktopLayouts();
  if (stored.home?.schema !== HOME_LAYOUT_SCHEMA_VERSION) {
    return normalizeHomePanelLayout(DEFAULT_HOME_PANEL_LAYOUT);
  }

  return normalizeStoredHomeLayout(stored.home.panels);
}

function writeStoredHomeLayout(layout: readonly HomePanelLayout[]): void {
  const stored = readStoredDesktopLayouts();
  writeStoredDesktopLayouts({
    ...stored,
    home: {
      panels: normalizeHomePanelLayout(layout),
      schema: HOME_LAYOUT_SCHEMA_VERSION,
    },
  });
}

function isHomePanelId(value: unknown): value is HomePanelId {
  return typeof value === "string" && HOME_PANEL_IDS.includes(value as HomePanelId);
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
