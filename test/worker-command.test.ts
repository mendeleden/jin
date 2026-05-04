import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createExperimentWorkerResolver,
  selectWorkerCommand,
} from "../src/pipeline/worker-command";

afterEach(() => {
  delete process.env.JIN_EXPERIMENT_CLAUDE_CODE_WORKER;
  delete process.env.JIN_EXPERIMENT_CLAUDE_CODE_GO_BINARY;
  delete process.env.JIN_EXPERIMENT_CODEX_WORKER;
  delete process.env.JIN_EXPERIMENT_CODEX_GO_BINARY;
});

test("worker command selector keeps the default TS worker when no experiment flag is set", () => {
  const defaultCommand = ["bun", "src/index.ts", "__worker"];
  const resolved = selectWorkerCommand(
    {
      command: defaultCommand,
      resolveCommand: createExperimentWorkerResolver(),
    },
    {
      adapterId: "claude-code",
      operation: "loadConversation",
    },
  );

  expect(resolved).toEqual(defaultCommand);
});

test("worker command selector routes only claude-code loadConversation to the Go worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "jin-go-worker-test-"));
  const bin = join(dir, "go-parser-bin");
  writeFileSync(bin, "");
  process.env.JIN_EXPERIMENT_CLAUDE_CODE_WORKER = "go";
  process.env.JIN_EXPERIMENT_CLAUDE_CODE_GO_BINARY = bin;

  const defaultCommand = ["bun", "src/index.ts", "__worker"];
  const config = {
    command: defaultCommand,
    resolveCommand: createExperimentWorkerResolver(),
  };

  expect(
    selectWorkerCommand(config, {
      adapterId: "claude-code",
      operation: "loadConversation",
    }),
  ).toEqual([bin, "worker"]);
  expect(
    selectWorkerCommand(config, {
      adapterId: "claude-code",
      operation: "findChanged",
    }),
  ).toEqual(defaultCommand);
  expect(
    selectWorkerCommand(config, {
      adapterId: "codex",
      operation: "loadConversation",
    }),
  ).toEqual(defaultCommand);

  rmSync(dir, { recursive: true, force: true });
});

test("worker command selector routes only codex loadConversation to the Go worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "jin-go-worker-test-"));
  const bin = join(dir, "go-parser-bin");
  writeFileSync(bin, "");
  process.env.JIN_EXPERIMENT_CODEX_WORKER = "go";
  process.env.JIN_EXPERIMENT_CODEX_GO_BINARY = bin;

  const defaultCommand = ["bun", "src/index.ts", "__worker"];
  const config = {
    command: defaultCommand,
    resolveCommand: createExperimentWorkerResolver(),
  };

  expect(
    selectWorkerCommand(config, {
      adapterId: "codex",
      operation: "loadConversation",
    }),
  ).toEqual([bin, "worker"]);
  expect(
    selectWorkerCommand(config, {
      adapterId: "codex",
      operation: "findChanged",
    }),
  ).toEqual(defaultCommand);
  expect(
    selectWorkerCommand(config, {
      adapterId: "claude-code",
      operation: "loadConversation",
    }),
  ).toEqual(defaultCommand);

  rmSync(dir, { recursive: true, force: true });
});

test("worker command selector falls back to the TS worker when the Go binary is missing", () => {
  process.env.JIN_EXPERIMENT_CLAUDE_CODE_WORKER = "go";
  process.env.JIN_EXPERIMENT_CLAUDE_CODE_GO_BINARY = join(
    tmpdir(),
    "jin-missing-go-worker-bin",
  );

  const defaultCommand = ["bun", "src/index.ts", "__worker"];
  const resolved = selectWorkerCommand(
    {
      command: defaultCommand,
      resolveCommand: createExperimentWorkerResolver(),
    },
    {
      adapterId: "claude-code",
      operation: "loadConversation",
    },
  );

  expect(resolved).toEqual(defaultCommand);
});
