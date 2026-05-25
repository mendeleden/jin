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
  DEFAULT_SETTINGS_PANEL_LAYOUT,
  SETTINGS_LAYOUT_SCHEMA_VERSION,
  SETTINGS_PANEL_IDS,
  normalizeSettingsPanelLayout,
  type SettingsPanelId,
  type SettingsPanelLayout,
} from "../views/settings/layout";
import {
  readStoredDesktopLayouts,
  writeStoredDesktopLayouts,
} from "./layout-storage";

export interface DesktopLayoutPreferences {
  homeLayout: readonly HomePanelLayout[];
  resetHomeLayout(): void;
  resetSettingsLayout(): void;
  setHomeLayout(layout: readonly HomePanelLayout[]): void;
  setSettingsLayout(layout: readonly SettingsPanelLayout[]): void;
  settingsLayout: readonly SettingsPanelLayout[];
}

const DEFAULT_DESKTOP_LAYOUT_PREFERENCES: DesktopLayoutPreferences = {
  homeLayout: DEFAULT_HOME_PANEL_LAYOUT,
  resetHomeLayout() {},
  resetSettingsLayout() {},
  setHomeLayout() {},
  setSettingsLayout() {},
  settingsLayout: DEFAULT_SETTINGS_PANEL_LAYOUT,
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
  const [settingsLayout, setSettingsLayoutState] = useState<
    readonly SettingsPanelLayout[]
  >(() => readStoredSettingsLayout());

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

  const setSettingsLayout = useCallback(
    (layout: readonly SettingsPanelLayout[]) => {
      const nextLayout = normalizeSettingsPanelLayout(layout);
      setSettingsLayoutState(nextLayout);
      writeStoredSettingsLayout(nextLayout);
    },
    [],
  );

  const resetSettingsLayout = useCallback(() => {
    const nextLayout = normalizeSettingsPanelLayout(DEFAULT_SETTINGS_PANEL_LAYOUT);
    setSettingsLayoutState(nextLayout);
    writeStoredSettingsLayout(nextLayout);
  }, []);

  const value = useMemo(
    () => ({
      homeLayout,
      resetHomeLayout,
      resetSettingsLayout,
      setHomeLayout,
      setSettingsLayout,
      settingsLayout,
    }),
    [
      homeLayout,
      resetHomeLayout,
      resetSettingsLayout,
      setHomeLayout,
      setSettingsLayout,
      settingsLayout,
    ],
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

export function normalizeStoredSettingsLayout(
  value: unknown,
): SettingsPanelLayout[] {
  if (!Array.isArray(value)) {
    return normalizeSettingsPanelLayout(DEFAULT_SETTINGS_PANEL_LAYOUT);
  }

  return normalizeSettingsPanelLayout(
    value.flatMap((item): SettingsPanelLayout[] => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const candidate =
        item as Partial<Record<keyof SettingsPanelLayout, unknown>>;
      if (!isSettingsPanelId(candidate.panelId)) {
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

function readStoredSettingsLayout(): SettingsPanelLayout[] {
  const stored = readStoredDesktopLayouts();
  if (stored.settings?.schema !== SETTINGS_LAYOUT_SCHEMA_VERSION) {
    return normalizeSettingsPanelLayout(DEFAULT_SETTINGS_PANEL_LAYOUT);
  }

  return normalizeStoredSettingsLayout(stored.settings.panels);
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

function writeStoredSettingsLayout(layout: readonly SettingsPanelLayout[]): void {
  const stored = readStoredDesktopLayouts();
  writeStoredDesktopLayouts({
    ...stored,
    settings: {
      panels: normalizeSettingsPanelLayout(layout),
      schema: SETTINGS_LAYOUT_SCHEMA_VERSION,
    },
  });
}

function isHomePanelId(value: unknown): value is HomePanelId {
  return typeof value === "string" && HOME_PANEL_IDS.includes(value as HomePanelId);
}

function isSettingsPanelId(value: unknown): value is SettingsPanelId {
  return typeof value === "string" &&
    SETTINGS_PANEL_IDS.includes(value as SettingsPanelId);
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
