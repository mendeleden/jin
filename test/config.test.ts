import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  defaultConfig,
  loadStartupConfig,
  normalizeConfig,
} from "../src/config";

afterEach(() => {
  if (process.env.JIN_CONFIG_DIR?.includes("jin-config-test-")) {
    rmSync(process.env.JIN_CONFIG_DIR, { recursive: true, force: true });
  }
  delete process.env.JIN_CONFIG_DIR;
});

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
          teamId: "team-1",
          userId: "user-1",
        },
        {
          id: "s3-archive",
          type: "s3",
          bucket: "jin-archive",
          accessKeyId: "abc",
          secretAccessKey: "def",
          userId: "user-archive",
        },
        {
          id: "webhook-cursor",
          type: "webhook",
          url: "https://example.com/hooks/jin",
          teamId: "team-2",
          userId: "user-2",
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
        teamId: "team-1",
        userId: "user-1",
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
        userId: "user-archive",
      },
      {
        id: "webhook-cursor",
        type: "webhook",
        enabled: true,
        url: "https://example.com/hooks/jin",
        teamId: "team-2",
        userId: "user-2",
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
      debounceMs: 5_000,
    });
    expect(normalized).not.toHaveProperty("defaultSinks");
    expect(normalized).not.toHaveProperty("routeUnmatchedToAll");
    expect(normalized).not.toHaveProperty("store");
    expect(normalized).not.toHaveProperty("team");
  });
});

describe("loadStartupConfig", () => {
  test("persists default config on first-run startup bootstrap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    const config = await loadStartupConfig();

    expect(config).toEqual(defaultConfig());
    expect(existsSync(join(dir, "config.json"))).toBe(true);
  });

  test("materializes missing adapter defaults into an existing config without dropping watch extensions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          adapters: {
            cursor: {
              enabled: true,
            },
          },
          sinks: [],
          routes: [],
          watch: {
            pollIntervalMs: 5_000,
            debounceMs: 500,
          },
        },
        null,
        2,
      ),
    );

    const config = await loadStartupConfig();
    const written = JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));

    expect(config.watch).toEqual({
      pollIntervalMs: 5_000,
      debounceMs: 500,
    });
    expect(written.watch).toEqual({
      pollIntervalMs: 5_000,
      debounceMs: 500,
    });
    expect(written.adapters.cursor).toEqual({
      enabled: true,
      allowProtectedSource: false,
    });
    expect(written.adapters["claude-code"]).toEqual({ enabled: true });
    expect(written.adapters.codex).toEqual({ enabled: true });
  });
});
