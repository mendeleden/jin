import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { createTestEnv, type TestEnv } from "./helpers";
import { readIngestActivity } from "../src/daemon/ingest-activity";

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv();
});

afterEach(() => {
  env.cleanup();
});

function writeDebugLog(lines: object[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(env.dir, "debug.jsonl"), content);
}

describe("readIngestActivity", () => {
  test("returns null when debug.jsonl does not exist", () => {
    expect(readIngestActivity()).toBeNull();
  });

  test("identifies the active adapter from work:start without work:end", () => {
    writeDebugLog([
      { event: "work:start", kind: "ingest-adapter", adapterId: "claude-code", hint: "startup-scan", queueItems: ["ingest-adapter:codex"] },
    ]);

    const activity = readIngestActivity();
    expect(activity).not.toBeNull();
    expect(activity!.active?.adapter).toBe("claude-code");
    expect(activity!.coldStart).toBe(true);
  });

  test("ignores adapters with matching work:end", () => {
    writeDebugLog([
      { event: "work:start", kind: "ingest-adapter", adapterId: "claude-code", hint: "startup-scan" },
      { event: "work:end", kind: "ingest-adapter", adapterId: "claude-code" },
    ]);

    expect(readIngestActivity()!.active).toBeNull();
  });

  test("derives processed/total/current from latest ingest:batch", () => {
    writeDebugLog([
      { event: "work:start", kind: "ingest-adapter", adapterId: "claude-code", hint: "startup-scan" },
      {
        event: "ingest:batch",
        adapterId: "claude-code",
        processedRefs: 9,
        totalRefs: 244,
        batchSourcePaths: ["/home/u/.claude/projects/foo/x.jsonl"],
      },
      {
        event: "ingest:batch",
        adapterId: "claude-code",
        processedRefs: 12,
        totalRefs: 244,
        batchSourcePaths: ["/home/u/.claude/projects/foo/y.jsonl"],
      },
    ]);

    const activity = readIngestActivity();
    expect(activity!.active?.processedRefs).toBe(12);
    expect(activity!.active?.totalRefs).toBe(244);
    expect(activity!.active?.currentSourcePath).toBe("/home/u/.claude/projects/foo/y.jsonl");
  });

  test("reports queued adapters minus the active one", () => {
    writeDebugLog([
      { event: "work:start", kind: "ingest-adapter", adapterId: "claude-code", hint: "startup-scan" },
      { event: "queue:queued", queueItems: ["ingest-adapter:claude-code", "ingest-adapter:codex", "ingest-adapter:gemini-cli"] },
    ]);

    const activity = readIngestActivity();
    expect(activity!.queued).toEqual(["codex", "gemini-cli"]);
  });

  test("coldStart is false for non-startup hints", () => {
    writeDebugLog([
      { event: "work:start", kind: "ingest-adapter", adapterId: "claude-code", hint: "watcher" },
    ]);

    expect(readIngestActivity()!.coldStart).toBe(false);
  });
});
