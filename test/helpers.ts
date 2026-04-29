import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Store } from "../src/store";
import type { Session } from "../src/adapters/types";
import type { Sink } from "../src/sinks/types";

// ── Sample Data ──────────────────────────────────────────────────────────

export const SAMPLE_PROJECTS = [
  {
    id: "proj-alpha-001",
    name: "alpha",
    directory: "/home/dev/projects/alpha",
    gitRemote: "https://github.com/org/alpha.git",
    gitBranch: "main",
    language: "TypeScript",
  },
  {
    id: "proj-beta-0002",
    name: "beta",
    directory: "/home/dev/projects/beta",
    gitRemote: "git@github.com:org/beta.git",
    gitBranch: "develop",
    language: "Python",
  },
  {
    id: "proj-gamma-003",
    name: "gamma",
    directory: "/home/dev/projects/gamma",
    gitRemote: "https://github.com/org/gamma",
    gitBranch: "main",
    language: "Go",
  },
  // Worktree scenario: same remote as alpha, different directory and project name
  {
    id: "proj-alpha-wt1",
    name: "alpha-feature",
    directory: "/home/dev/worktrees/alpha-feature",
    gitRemote: "https://github.com/org/alpha.git",
    gitBranch: "feature/new-ui",
    language: "TypeScript",
  },
];

export const SAMPLE_SESSIONS: Session[] = [
  makeSession("session-001", {
    name: "fix login bug",
    adapterId: "claude-code",
    adapterName: "Claude Code",
    metadata: { cwd: "/home/dev/projects/alpha" },
  }),
  makeSession("session-002", {
    name: "refactor API",
    adapterId: "cursor",
    adapterName: "Cursor",
    metadata: { cwd: "/home/dev/projects/beta" },
  }),
];

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a minimal Session object with sensible defaults. */
export function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: overrides.name ?? "test session",
    adapterId: overrides.adapterId ?? "claude-code",
    adapterName: overrides.adapterName ?? "Claude Code",
    createdAt: overrides.createdAt ?? "2026-01-15T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-15T11:00:00Z",
    durationMs: overrides.durationMs ?? 3600000,
    isActive: overrides.isActive ?? false,
    totalTokens: overrides.totalTokens ?? 50000,
    estCost: overrides.estCost ?? 0.75,
    messageCount: overrides.messageCount ?? 20,
    sourcePath: overrides.sourcePath ?? "",
    isSubAgent: overrides.isSubAgent ?? false,
    parentSessionId: overrides.parentSessionId ?? "",
    isCompacted: overrides.isCompacted ?? false,
    metadata: overrides.metadata ?? {},
  };
}

/** Create a minimal fake Sink. */
export function createFakeSink(overrides: {
  id?: string;
  name?: string;
  healthOk?: boolean;
  healthError?: string;
} = {}): Sink {
  return {
    id: overrides.id ?? "fake-0",
    name: overrides.name ?? "fake",
    healthCheck: async () => ({
      ok: overrides.healthOk ?? true,
      ...(overrides.healthError ? { error: overrides.healthError } : {}),
    }),
    push: async () => ({ pushed: 0, failed: 0, errors: [] }),
    close: async () => {},
  };
}

// ── Test Environment ─────────────────────────────────────────────────────

export interface TestEnv {
  dir: string;
  store: Store;
  cleanup: () => void;
}

/**
 * Create an isolated test environment.
 * Sets JIN_CONFIG_DIR so all config/store operations use the temp dir.
 */
export function createTestEnv(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), "jin-test-"));
  process.env.JIN_CONFIG_DIR = dir;

  const dbPath = join(dir, "store.db");
  const store = new Store(dbPath);

  return {
    dir,
    store,
    cleanup: () => {
      store.close();
      delete process.env.JIN_CONFIG_DIR;
      removeDirWithRetry(dir);
    },
  };
}

export function removeDirWithRetry(dir: string): void {
  const delays = [50, 100, 200, 400, 800];
  for (let i = 0; i < delays.length; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i < delays.length - 1) {
        Bun.sleepSync(delays[i]);
      }
    }
  }
}

/**
 * Seed the store with sample projects and sessions, linking them.
 */
export function seedStore(store: Store): void {
  for (const proj of SAMPLE_PROJECTS) {
    store.upsertProject(proj);
  }
  for (let i = 0; i < SAMPLE_SESSIONS.length; i++) {
    const session = SAMPLE_SESSIONS[i];
    store.upsertSession(session);
    // Link first session to first project, second to second
    store.linkSessionToProject(session.id, SAMPLE_PROJECTS[i].id);
  }
  store.refreshProjectStats();
}

/**
 * Write a config JSON to the test environment's config dir.
 */
export async function writeTestConfig(dir: string, config: any): Promise<void> {
  await Bun.write(join(dir, "config.json"), JSON.stringify(config, null, 2));
}

/**
 * Read the config JSON from the test environment.
 */
export async function readTestConfig(dir: string): Promise<any> {
  const cfgPath = join(dir, "config.json");
  if (!existsSync(cfgPath)) return null;
  return JSON.parse(await Bun.file(cfgPath).text());
}

// ── Console Capture ──────────────────────────────────────────────────────

export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: any[]) => errors.push(args.map(String).join(" "));

  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

// ── Process Exit Mock ────────────────────────────────────────────────────

export class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

export function mockProcessExit() {
  const origExit = process.exit;
  process.exit = ((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never;

  return {
    restore: () => {
      process.exit = origExit;
    },
  };
}
