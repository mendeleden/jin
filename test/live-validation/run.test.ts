import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { resolveClaudeProjectsDir } from "../../scripts/live-validation/run";

const TEMP_ROOTS: string[] = [];
const CODEX_FIXTURE = join(
  process.cwd(),
  "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl",
);
const CLAUDE_FIXTURE = join(
  process.cwd(),
  "test/fixtures/claude-code/00c4c4e7.jsonl",
);

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    const root = TEMP_ROOTS.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("resolveClaudeProjectsDir prefers a populated ~/.claude/projects over an empty ~/.config fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "jin-live-validation-home-"));
  TEMP_ROOTS.push(root);

  const home = join(root, "home");
  const preferred = join(home, ".claude", "projects");
  const emptyFallback = join(home, ".config", "claude", "projects");
  mkdirSync(preferred, { recursive: true });
  mkdirSync(emptyFallback, { recursive: true });
  writeFileSync(join(preferred, "session.jsonl"), "{}\n", "utf8");

  expect(resolveClaudeProjectsDir(undefined, { homeDir: home })).toBe(
    resolve(preferred),
  );
});

test("live validation harness emits reconciliation artifacts for codex and claude fixture overrides", async () => {
  const root = mkdtempSync(join(tmpdir(), "jin-live-validation-test-"));
  TEMP_ROOTS.push(root);

  const outputDir = join(root, "out");
  const codexHome = join(root, "codex-home");
  const claudeProjectsDir = join(root, "claude-projects");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(codexHome, "sessions", "2026", "02", "21"), {
    recursive: true,
  });
  mkdirSync(claudeProjectsDir, { recursive: true });

  cpSync(
    CODEX_FIXTURE,
    join(codexHome, "sessions", "2026", "02", "21", "fixture.jsonl"),
  );
  cpSync(CLAUDE_FIXTURE, join(claudeProjectsDir, "fixture.jsonl"));

  const proc = Bun.spawn({
    cmd: [
      "bun",
      "scripts/live-validation/run.ts",
      "--adapters=codex,claude-code",
      `--output-dir=${outputDir}`,
      `--codex-home=${codexHome}`,
      `--claude-projects-dir=${claudeProjectsDir}`,
    ],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);

  const report = JSON.parse(stdout) as {
    storePath: string;
    artifacts: {
      configPath: string;
      reportPath: string;
      reconciliationPath: string;
    };
    summary: {
      ok: boolean;
      totalStoreConversations: number;
      totalStoreMessages: number;
    };
    adapters: Array<{
      adapterId: string;
      refsDiscovered: number;
      bundlesLoaded: number;
      storeConversations: number;
      issueCount: number;
      errors: string[];
    }>;
  };

  expect(report.summary.ok).toBe(true);
  expect(report.summary.totalStoreConversations).toBeGreaterThan(0);
  expect(report.summary.totalStoreMessages).toBeGreaterThan(0);
  expect(existsSync(report.storePath)).toBe(true);
  expect(existsSync(report.artifacts.configPath)).toBe(true);
  expect(existsSync(report.artifacts.reportPath)).toBe(true);
  expect(existsSync(report.artifacts.reconciliationPath)).toBe(true);

  expect(report.adapters.map((adapter) => adapter.adapterId).sort()).toEqual([
    "claude-code",
    "codex",
  ]);
  expect(report.adapters.every((adapter) => adapter.refsDiscovered > 0)).toBe(
    true,
  );
  expect(report.adapters.every((adapter) => adapter.bundlesLoaded > 0)).toBe(
    true,
  );
  expect(
    report.adapters.every(
      (adapter) =>
        adapter.storeConversations > 0 &&
        adapter.issueCount === 0 &&
        adapter.errors.length === 0,
    ),
  ).toBe(true);

  const persistedReport = JSON.parse(
    readFileSync(report.artifacts.reportPath, "utf8"),
  ) as { summary: { ok: boolean } };
  expect(persistedReport.summary.ok).toBe(true);
});

async function readStream(stream: ReadableStream | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}
