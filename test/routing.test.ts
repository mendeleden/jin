import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { matchesRoute, sinksForSession } from "../src/routing";
import type { Sink } from "../src/sinks/types";
import type { JinConfig } from "../src/config";
import {
  createTestEnv,
  makeSession,
  createFakeSink,
  SAMPLE_PROJECTS,
  type TestEnv,
} from "./helpers";
import { Store } from "../src/store";

// ── matchesRoute ─────────────────────────────────────────────────────────

describe("matchesRoute", () => {
  const project = {
    id: "p1",
    name: "MyApp",
    directory: "/home/dev/projects/myapp",
    gitRemote: "https://github.com/org/MyApp.git",
  };

  test("exact project name match (case-insensitive)", () => {
    expect(matchesRoute({ project: "myapp" }, project)).toBe(true);
    expect(matchesRoute({ project: "MYAPP" }, project)).toBe(true);
    expect(matchesRoute({ project: "MyApp" }, project)).toBe(true);
  });

  test("exact remote match after normalization", () => {
    expect(
      matchesRoute(
        { remote: "https://github.com/org/MyApp.git" },
        project
      )
    ).toBe(true);
  });

  test("remote .git suffix is stripped for comparison", () => {
    expect(
      matchesRoute(
        { remote: "https://github.com/org/MyApp" },
        project
      )
    ).toBe(true);
  });

  test("remote trailing slash is stripped", () => {
    expect(
      matchesRoute(
        { remote: "https://github.com/org/MyApp/" },
        project
      )
    ).toBe(true);
  });

  test("remote match is case-insensitive", () => {
    expect(
      matchesRoute(
        { remote: "HTTPS://GITHUB.COM/ORG/MYAPP.GIT" },
        project
      )
    ).toBe(true);
  });

  test("directory match is exact and case-insensitive", () => {
    expect(
      matchesRoute(
        { directory: "/home/dev/projects/myapp" },
        project
      )
    ).toBe(true);
    expect(
      matchesRoute(
        { directory: "/HOME/DEV/PROJECTS/MYAPP" },
        project
      )
    ).toBe(true);
  });

  test("no match returns false", () => {
    expect(matchesRoute({ project: "other" }, project)).toBe(false);
    expect(
      matchesRoute(
        { remote: "https://github.com/org/other" },
        project
      )
    ).toBe(false);
    expect(
      matchesRoute(
        { directory: "/home/dev/other" },
        project
      )
    ).toBe(false);
  });
});

// ── sinksForSession ──────────────────────────────────────────────────────

describe("sinksForSession", () => {
  let env: TestEnv;

  const pgSink: Sink = createFakeSink({ id: "postgres-0", name: "pg" });
  const whSink: Sink = createFakeSink({ id: "webhook-0", name: "wh" });
  const allSinks = [pgSink, whSink];

  beforeEach(() => {
    env = createTestEnv();

    // Seed projects and sessions
    for (const proj of SAMPLE_PROJECTS) {
      env.store.upsertProject(proj);
    }

    // Create sessions and link to projects
    const s1 = makeSession("s-alpha");
    env.store.upsertSession(s1);
    env.store.linkSessionToProject("s-alpha", "proj-alpha-001");

    const s2 = makeSession("s-beta");
    env.store.upsertSession(s2);
    env.store.linkSessionToProject("s-beta", "proj-beta-0002");

    const s3 = makeSession("s-unlinked");
    env.store.upsertSession(s3);
    // s3 has no project link

    // Worktree sessions linked to alpha-feature project (same remote as alpha)
    const s4 = makeSession("s-alpha-wt");
    env.store.upsertSession(s4);
    env.store.linkSessionToProject("s-alpha-wt", "proj-alpha-wt1");
  });

  afterEach(() => {
    env.cleanup();
  });

  test("returns matching sinks for routed project", () => {
    const config: JinConfig = {
      adapters: {},
      sinks: [],
      routes: [{ match: { project: "alpha" }, sinks: ["postgres-0"] }],
      store: { dbPath: "", rawDir: "" },
      watch: { debounceMs: 200, pollIntervalMs: 30000 },
    };

    const session = makeSession("s-alpha");
    const result = sinksForSession(session, env.store, config, allSinks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("postgres-0");
  });

  test("returns empty array when no routes match", () => {
    const config: JinConfig = {
      adapters: {},
      sinks: [],
      routes: [{ match: { project: "nonexistent" }, sinks: ["postgres-0"] }],
      store: { dbPath: "", rawDir: "" },
      watch: { debounceMs: 200, pollIntervalMs: 30000 },
    };

    const session = makeSession("s-alpha");
    const result = sinksForSession(session, env.store, config, allSinks);
    expect(result).toHaveLength(0);
  });

  test("returns all sinks when routeUnmatchedToAll is true", () => {
    const config: JinConfig = {
      adapters: {},
      sinks: [],
      routeUnmatchedToAll: true,
      store: { dbPath: "", rawDir: "" },
      watch: { debounceMs: 200, pollIntervalMs: 30000 },
    };

    const session = makeSession("s-unlinked");
    const result = sinksForSession(session, env.store, config, allSinks);
    expect(result).toHaveLength(2);
  });

  test("returns defaultSinks for unmatched sessions", () => {
    const config: JinConfig = {
      adapters: {},
      sinks: [],
      routes: [{ match: { project: "nonexistent" }, sinks: ["postgres-0"] }],
      defaultSinks: ["webhook-0"],
      store: { dbPath: "", rawDir: "" },
      watch: { debounceMs: 200, pollIntervalMs: 30000 },
    };

    const session = makeSession("s-alpha");
    const result = sinksForSession(session, env.store, config, allSinks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("webhook-0");
  });

  test("worktree scenario: same remote, different project names — all match one remote route", () => {
    // Route by remote URL — should match both alpha and alpha-feature
    const config: JinConfig = {
      adapters: {},
      sinks: [],
      routes: [
        {
          match: { remote: "https://github.com/org/alpha.git" },
          sinks: ["postgres-0"],
        },
      ],
      store: { dbPath: "", rawDir: "" },
      watch: { debounceMs: 200, pollIntervalMs: 30000 },
    };

    // Alpha project session
    const alphaResult = sinksForSession(
      makeSession("s-alpha"),
      env.store,
      config,
      allSinks
    );
    expect(alphaResult).toHaveLength(1);
    expect(alphaResult[0].id).toBe("postgres-0");

    // Alpha worktree session (same remote, different project name)
    const wtResult = sinksForSession(
      makeSession("s-alpha-wt"),
      env.store,
      config,
      allSinks
    );
    expect(wtResult).toHaveLength(1);
    expect(wtResult[0].id).toBe("postgres-0");
  });
});
