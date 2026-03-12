import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestEnv, type TestEnv } from "./helpers";
import { writeProgress, readProgress, clearProgress, type IngestProgress } from "../src/progress";

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv();
});

afterEach(() => {
  clearProgress();
  env.cleanup();
});

describe("writeProgress / readProgress", () => {
  test("writes and reads progress", () => {
    const progress: IngestProgress = {
      adapter: "Claude Code",
      current: 5,
      total: 15,
      startedAt: Date.now(),
    };

    writeProgress(progress);
    const read = readProgress();

    expect(read).not.toBeNull();
    expect(read!.adapter).toBe("Claude Code");
    expect(read!.current).toBe(5);
    expect(read!.total).toBe(15);
  });

  test("returns null when no progress file exists", () => {
    expect(readProgress()).toBeNull();
  });

  test("overwrites previous progress", () => {
    writeProgress({ adapter: "Claude Code", current: 1, total: 10, startedAt: Date.now() });
    writeProgress({ adapter: "Claude Code", current: 7, total: 10, startedAt: Date.now() });

    const read = readProgress();
    expect(read!.current).toBe(7);
  });
});

describe("clearProgress", () => {
  test("removes progress file", () => {
    writeProgress({ adapter: "Claude Code", current: 1, total: 10, startedAt: Date.now() });
    expect(readProgress()).not.toBeNull();

    clearProgress();
    expect(readProgress()).toBeNull();
  });

  test("no-ops when file does not exist", () => {
    // Should not throw
    clearProgress();
    expect(readProgress()).toBeNull();
  });
});

describe("staleness check", () => {
  test("ignores progress older than 5 minutes", () => {
    const staleTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    writeProgress({ adapter: "Claude Code", current: 3, total: 10, startedAt: staleTimestamp });

    const read = readProgress();
    expect(read).toBeNull();
  });

  test("returns progress within 5 minutes", () => {
    const recentTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
    writeProgress({ adapter: "Claude Code", current: 3, total: 10, startedAt: recentTimestamp });

    const read = readProgress();
    expect(read).not.toBeNull();
    expect(read!.current).toBe(3);
  });
});

describe("progress file location", () => {
  test("writes to config dir", () => {
    writeProgress({ adapter: "Test", current: 1, total: 1, startedAt: Date.now() });

    const progressPath = join(env.dir, "jin.progress");
    expect(existsSync(progressPath)).toBe(true);

    const content = JSON.parse(readFileSync(progressPath, "utf-8"));
    expect(content.adapter).toBe("Test");
  });
});
