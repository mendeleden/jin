import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const DESKTOP_REFRESH_INTERVAL_STORAGE_KEY =
  "jin.desktop.refreshIntervalMs";

export const DESKTOP_REFRESH_INTERVAL_OPTIONS = [
  { value: 10_000, label: "10s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "1m" },
  { value: 300_000, label: "5m" },
] as const;

export type DesktopRefreshIntervalMs =
  (typeof DESKTOP_REFRESH_INTERVAL_OPTIONS)[number]["value"];

export const DEFAULT_DESKTOP_REFRESH_INTERVAL_MS: DesktopRefreshIntervalMs =
  30_000;

export interface DesktopPreferences {
  refreshIntervalMs: DesktopRefreshIntervalMs;
  setRefreshIntervalMs(value: DesktopRefreshIntervalMs): void;
}

const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  refreshIntervalMs: DEFAULT_DESKTOP_REFRESH_INTERVAL_MS,
  setRefreshIntervalMs() {},
};

const DesktopPreferencesContext = createContext<DesktopPreferences>(
  DEFAULT_DESKTOP_PREFERENCES,
);

export function DesktopPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [refreshIntervalMs, setRefreshIntervalState] =
    useState<DesktopRefreshIntervalMs>(() => readStoredRefreshInterval());

  const setRefreshIntervalMs = useCallback(
    (value: DesktopRefreshIntervalMs) => {
      const nextValue = normalizeDesktopRefreshInterval(value);
      setRefreshIntervalState(nextValue);
      writeStoredRefreshInterval(nextValue);
    },
    [],
  );

  const value = useMemo(
    () => ({
      refreshIntervalMs,
      setRefreshIntervalMs,
    }),
    [refreshIntervalMs, setRefreshIntervalMs],
  );

  return (
    <DesktopPreferencesContext.Provider value={value}>
      {children}
    </DesktopPreferencesContext.Provider>
  );
}

export function useDesktopPreferences(): DesktopPreferences {
  return useContext(DesktopPreferencesContext);
}

export function formatDesktopRefreshInterval(
  intervalMs: DesktopRefreshIntervalMs,
): string {
  if (intervalMs < 60_000) {
    return `${intervalMs / 1_000}s`;
  }
  return `${intervalMs / 60_000}m`;
}

function readStoredRefreshInterval(): DesktopRefreshIntervalMs {
  if (typeof window === "undefined") {
    return DEFAULT_DESKTOP_REFRESH_INTERVAL_MS;
  }

  try {
    return normalizeDesktopRefreshInterval(
      window.localStorage.getItem(DESKTOP_REFRESH_INTERVAL_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_DESKTOP_REFRESH_INTERVAL_MS;
  }
}

function writeStoredRefreshInterval(value: DesktopRefreshIntervalMs): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      DESKTOP_REFRESH_INTERVAL_STORAGE_KEY,
      String(value),
    );
  } catch {
    // localStorage can be unavailable in hardened renderer contexts.
  }
}

function normalizeDesktopRefreshInterval(
  value: DesktopRefreshIntervalMs | string | null,
): DesktopRefreshIntervalMs {
  const numericValue = typeof value === "number" ? value : Number(value);
  const match = DESKTOP_REFRESH_INTERVAL_OPTIONS.find(
    (option) => option.value === numericValue,
  );
  return match?.value ?? DEFAULT_DESKTOP_REFRESH_INTERVAL_MS;
}
