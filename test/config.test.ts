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
  loadRuntimeConfigGeneration,
  loadStartupConfig,
  normalizeConfig,
  updateConfig,
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

  test("rejects invalid existing config on startup instead of normalizing it live", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          sinks: [
            {
              id: "postgres-team",
              type: "postgres",
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(loadStartupConfig()).rejects.toThrow(
      "config.sinks[0].connectionString must be a non-empty string",
    );
  });

  test("rejects malformed explicit startup sections instead of replacing them", async () => {
    const cases: Array<{
      name: string;
      config: unknown;
      message: string;
    }> = [
      {
        name: "root",
        config: [],
        message: "config root must be an object",
      },
      {
        name: "adapters",
        config: { adapters: [] },
        message: "config.adapters must be an object",
      },
      {
        name: "adapter entry",
        config: { adapters: { cursor: false } },
        message: "config.adapters.cursor must be an object",
      },
      {
        name: "sinks",
        config: { sinks: { bad: true } },
        message: "config.sinks must be an array",
      },
      {
        name: "routes",
        config: { routes: { bad: true } },
        message: "config.routes must be an array",
      },
      {
        name: "watch",
        config: { watch: [] },
        message: "config.watch must be an object",
      },
      {
        name: "watch poll",
        config: { watch: { pollIntervalMs: 0 } },
        message: "config.watch.pollIntervalMs must be a positive integer",
      },
    ];

    for (const testCase of cases) {
      const dir = mkdtempSync(join(tmpdir(), `jin-config-test-${testCase.name}-`));
      process.env.JIN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify(testCase.config, null, 2),
      );

      await expect(loadStartupConfig()).rejects.toThrow(testCase.message);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadRuntimeConfigGeneration", () => {
  test("rejects invalid sink generations instead of silently dropping them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          adapters: {},
          sinks: [
            {
              id: "postgres-team",
              type: "postgres",
            },
          ],
          routes: [],
          watch: {
            pollIntervalMs: 10_000,
          },
        },
        null,
        2,
      ),
    );

    await expect(loadRuntimeConfigGeneration()).rejects.toThrow(
      "config.sinks[0].connectionString must be a non-empty string",
    );
  });

  test("rejects invalid route generations instead of normalizing them empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          sinks: [],
          routes: [
            {
              match: "github.com/acme/*",
              sinks: ["postgres-team"],
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(loadRuntimeConfigGeneration()).rejects.toThrow(
      "config.routes[0].match must be an object",
    );
  });
});

describe("updateConfig", () => {
  test("refuses to mutate an invalid existing generation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-config-test-"));
    process.env.JIN_CONFIG_DIR = dir;

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify(
        {
          sinks: [
            {
              id: "postgres-team",
              type: "postgres",
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(
      updateConfig((config) => {
        config.routes.push({
          match: {},
          sinks: ["postgres-team"],
        });
      }),
    ).rejects.toThrow(
      "config.sinks[0].connectionString must be a non-empty string",
    );

    const persisted = JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
    expect(persisted.sinks).toEqual([
      {
        id: "postgres-team",
        type: "postgres",
      },
    ]);
    expect(persisted.routes).toBeUndefined();
  });
});
