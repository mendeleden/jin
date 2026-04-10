import { describe, expect, test } from "bun:test";
import {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  defaultConfig,
  normalizeConfig,
} from "../src/config";

describe("defaultConfig", () => {
  test("creates a v2 zero-state snapshot", () => {
    const config = defaultConfig();

    expect(config.adapters.cursor?.enabled).toBe(true);
    expect(config.sinks).toEqual([]);
    expect(config.routes).toEqual([]);
    expect(config.watch).toEqual({
      pollIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
    });
    expect(config).not.toHaveProperty("defaultSinks");
    expect(config).not.toHaveProperty("routeUnmatchedToAll");
    expect(config).not.toHaveProperty("store");
    expect(config).not.toHaveProperty("team");
  });
});

describe("normalizeConfig", () => {
  test("applies sink defaults and strips legacy routing fields", () => {
    const normalized = normalizeConfig({
      adapters: {
        cursor: {},
      },
      sinks: [
        {
          id: "postgres-team",
          type: "postgres",
          connectionString: "postgres://jin:test@localhost:5432/jin",
          enabled: false,
        },
        {
          id: "s3-archive",
          type: "s3",
          bucket: "jin-archive",
          accessKeyId: "abc",
          secretAccessKey: "def",
        },
        {
          id: "webhook-cursor",
          type: "webhook",
          url: "https://example.com/hooks/jin",
          headers: {
            Authorization: "Bearer token",
            ignore: 42,
          },
        },
      ],
      routes: [
        {
          match: {
            remote: "github.com/acme/*",
            adapter: "CURSOR",
            branch: "release/*",
            name: "Release *",
            project: "legacy-project",
            directory: "/tmp/legacy",
          },
          sinks: ["postgres-team", "s3-archive", "postgres-team"],
        },
      ],
      defaultSinks: ["postgres-team"],
      routeUnmatchedToAll: true,
      store: { dbPath: "/tmp/store.db", rawDir: "/tmp/raw" },
      team: { teamId: "team-1" },
      watch: {
        pollIntervalMs: 120_000,
        debounceMs: 5_000,
      },
    });

    expect(normalized.adapters).toEqual({
      "claude-code": { enabled: true },
      cursor: { enabled: true, allowProtectedSource: false },
      codex: { enabled: true },
      warp: { enabled: true, allowProtectedSource: false },
      "gemini-cli": { enabled: true },
      kiro: { enabled: true, allowProtectedSource: false },
      amp: { enabled: true },
      opencode: { enabled: true, allowProtectedSource: false },
      pi: { enabled: true },
      piagent: { enabled: true },
    });
    expect(normalized.sinks).toEqual([
      {
        id: "postgres-team",
        type: "postgres",
        enabled: false,
        connectionString: "postgres://jin:test@localhost:5432/jin",
      },
      {
        id: "s3-archive",
        type: "s3",
        enabled: true,
        bucket: "jin-archive",
        region: DEFAULT_S3_REGION,
        accessKeyId: "abc",
        secretAccessKey: "def",
        prefix: DEFAULT_S3_PREFIX,
      },
      {
        id: "webhook-cursor",
        type: "webhook",
        enabled: true,
        url: "https://example.com/hooks/jin",
        headers: {
          Authorization: "Bearer token",
        },
        timeoutMs: DEFAULT_WEBHOOK_TIMEOUT_MS,
      },
    ]);
    expect(normalized.routes).toEqual([
      {
        match: {
          remote: "github.com/acme/*",
          adapter: "CURSOR",
          branch: "release/*",
          name: "Release *",
        },
        sinks: ["postgres-team", "s3-archive"],
      },
    ]);
    expect(normalized.watch).toEqual({
      pollIntervalMs: 120_000,
    });
    expect(normalized).not.toHaveProperty("defaultSinks");
    expect(normalized).not.toHaveProperty("routeUnmatchedToAll");
    expect(normalized).not.toHaveProperty("store");
    expect(normalized).not.toHaveProperty("team");
  });
});
