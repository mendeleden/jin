import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEMP_DIRS: string[] = [];

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("jin help no longer advertises removed UI and v1 bridge commands", async () => {
  const result = await runCli(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("conversations [--adapter=X]");
  expect(result.stdout).toContain("desktop [--yes|--update|--rollback]");
  expect(result.stdout).not.toContain(" ui ");
  expect(result.stdout).not.toContain(" init ");
  expect(result.stdout).not.toContain(" team-config ");
  expect(result.stdout).not.toContain(" sessions ");
  expect(result.stdout).not.toContain("write-debug-jsonl");
});

test("jin help for connect/start/stop no longer shows removed compatibility flags", async () => {
  const connect = await runCli(["help", "connect"]);
  const start = await runCli(["help", "start"]);
  const stop = await runCli(["help", "stop"]);

  expect(connect.stdout).not.toContain("--postgres");
  expect(connect.stdout).not.toContain("--s3");
  expect(connect.stdout).not.toContain("--webhook");
  expect(start.stdout).not.toContain("--ui");
  expect(start.stdout).not.toContain("--all");
  expect(start.stdout).not.toContain("--port");
  expect(start.stdout).not.toContain("write-debug-jsonl");
  expect(stop.stdout).not.toContain("--ui");
});

test("jin help for config mutations advertises --restart, not --yes", async () => {
  const connect = await runCli(["help", "connect"]);
  const disconnect = await runCli(["help", "disconnect"]);
  const sink = await runCli(["help", "sink"]);
  const route = await runCli(["help", "route"]);

  expect(connect.stdout).toContain("--restart");
  expect(connect.stdout).not.toContain("--yes");
  expect(disconnect.stdout).toContain("--restart");
  expect(disconnect.stdout).not.toContain("--yes");
  expect(sink.stdout).toContain("--restart");
  expect(sink.stdout).not.toContain("--yes");
  expect(route.stdout).toContain("--restart");
  expect(route.stdout).not.toContain("--yes");
});

test("jin help for desktop documents optional install and update flow", async () => {
  const result = await runCli(["help", "desktop"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("optional Jin Desktop app");
  expect(result.stdout).toContain("--yes");
  expect(result.stdout).toContain("--update");
  expect(result.stdout).toContain("--rollback");
});

test("removed command aliases fail with migration guidance", async () => {
  const init = await runCli(["init"]);
  const sessions = await runCli(["sessions"]);
  const teamConfig = await runCli(["team-config"]);
  const ui = await runCli(["ui"]);

  expect(init.exitCode).toBe(1);
  expect(init.stderr).toContain("`jin init` was removed");
  expect(sessions.stderr).toContain("`jin sessions` was removed");
  expect(teamConfig.stderr).toContain("`jin team-config` was removed");
  expect(ui.stderr).toContain("`jin ui` was removed");
});

test("removed compatibility flags fail with actionable errors", async () => {
  const start = await runCli(["start", "--ui"]);
  const restart = await runCli(["restart", "--all"]);
  const stop = await runCli(["stop", "--ui"]);
  const connect = await runCli(["connect", "alpha", '--postgres=postgresql://localhost:5432/jin']);

  expect(start.exitCode).toBe(1);
  expect(start.stderr).toContain("dashboard flags");
  expect(restart.stderr).toContain("dashboard flags");
  expect(stop.stderr).toContain("`jin stop --ui` was removed");
  expect(connect.stderr).toContain("no longer creates sinks directly");
});

async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const configDir = mkdtempSync(join(tmpdir(), "jin-cli-cleanup-"));
  TEMP_DIRS.push(configDir);

  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIN_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
