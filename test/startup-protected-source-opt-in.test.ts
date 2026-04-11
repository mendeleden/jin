import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import {
  protectedSourceStartupNotices,
  startupProbeBlocked,
} from "../src/adapters/registry";

describe("startup protected-source opt-in policy", () => {
  test("default config marks protected-source adapters as opt-in", () => {
    const config = defaultConfig();

    expect(config.adapters.cursor.allowProtectedSource).toBe(false);
    expect(config.adapters.kiro.allowProtectedSource).toBe(false);
    expect(config.adapters.opencode.allowProtectedSource).toBe(false);
    expect(config.adapters.warp.allowProtectedSource).toBe(false);
  });

  test("startup policy is explicit by OS and path class", () => {
    const config = defaultConfig();

    const mac = protectedSourceStartupNotices(config.adapters, "darwin");
    expect(mac.find((notice) => notice.adapterId === "cursor")).toEqual(
      expect.objectContaining({
        mode: "mixed-default",
      }),
    );
    expect(mac.find((notice) => notice.adapterId === "cursor")?.summary).toContain(
      "Application Support",
    );
    expect(mac.find((notice) => notice.adapterId === "warp")?.summary).toContain(
      "Group Containers",
    );

    const linux = protectedSourceStartupNotices(config.adapters, "linux");
    expect(linux.find((notice) => notice.adapterId === "opencode")?.summary).toContain(
      ".local/share/opencode/storage",
    );
    expect(linux.find((notice) => notice.adapterId === "warp")?.summary).toContain(
      ".local/state/warp-terminal/warp.sqlite",
    );

    const windows = protectedSourceStartupNotices(config.adapters, "win32");
    expect(windows.find((notice) => notice.adapterId === "cursor")?.summary).toContain(
      "%APPDATA%",
    );
    expect(windows.find((notice) => notice.adapterId === "warp")?.summary).toContain(
      "%LOCALAPPDATA%",
    );
  });

  test("opt-in-only adapters stay blocked until the config explicitly opts in", () => {
    const config = defaultConfig();

    expect(startupProbeBlocked("kiro", config.adapters)).toBe(true);
    expect(startupProbeBlocked("opencode", config.adapters)).toBe(true);
    expect(startupProbeBlocked("warp", config.adapters)).toBe(true);
    expect(startupProbeBlocked("cursor", config.adapters)).toBe(false);

    config.adapters.kiro = { enabled: true, allowProtectedSource: true };
    config.adapters.opencode = {
      enabled: true,
      dataDir: "/tmp/opencode-storage",
    };

    expect(startupProbeBlocked("kiro", config.adapters)).toBe(false);
    expect(startupProbeBlocked("opencode", config.adapters)).toBe(false);
  });
});
