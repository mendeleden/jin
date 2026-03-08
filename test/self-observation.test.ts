/**
 * Test: self-observation filter should exclude jin's own output paths,
 * NOT all Claude Code sessions that happen to be in the same project directory.
 *
 * Bug: If a user runs `jin start` from /home/user/my-app and also uses
 * Claude Code in /home/user/my-app, the cwdSlug filter blocks that
 * conversation from being indexed — even though jin never writes to
 * ~/.claude/projects/ directories.
 */
import { describe, test, expect } from "bun:test";
import { shouldExcludeEvent } from "../src/self-observation";

describe("self-observation filter", () => {
  const jinOutputPaths = {
    logFile: "/home/user/.config/jin/jin.log",
    dbPath: "/home/user/.config/jin/store.db",
    rawDir: "/home/user/.config/jin/raw",
  };

  test("excludes jin log file changes", () => {
    expect(
      shouldExcludeEvent("/home/user/.config/jin/jin.log", jinOutputPaths)
    ).toBe(true);
  });

  test("excludes jin store.db changes", () => {
    expect(
      shouldExcludeEvent("/home/user/.config/jin/store.db", jinOutputPaths)
    ).toBe(true);
  });

  test("excludes jin store.db-wal changes", () => {
    expect(
      shouldExcludeEvent("/home/user/.config/jin/store.db-wal", jinOutputPaths)
    ).toBe(true);
  });

  test("excludes files in jin raw directory", () => {
    expect(
      shouldExcludeEvent(
        "/home/user/.config/jin/raw/claude-code/abc123.jsonl",
        jinOutputPaths
      )
    ).toBe(true);
  });

  test("DOES NOT exclude Claude Code sessions in the same project as jin cwd", () => {
    // This is the bug: user runs jin from /home/user/my-app,
    // Claude Code session for that project lives at:
    //   ~/.claude/projects/-home-user-my-app/session-id.jsonl
    // The old cwdSlug filter would exclude this. It should NOT be excluded.
    expect(
      shouldExcludeEvent(
        "/home/user/.claude/projects/-home-user-my-app/abc123.jsonl",
        jinOutputPaths
      )
    ).toBe(false);
  });

  test("DOES NOT exclude Claude Code sessions in other projects", () => {
    expect(
      shouldExcludeEvent(
        "/home/user/.claude/projects/-home-user-other-project/def456.jsonl",
        jinOutputPaths
      )
    ).toBe(false);
  });

  test("DOES NOT exclude gemini-cli session files", () => {
    expect(
      shouldExcludeEvent(
        "/home/user/.gemini/tmp/my-app/chats/session-xyz.json",
        jinOutputPaths
      )
    ).toBe(false);
  });

  test("excludes jin benchmark output", () => {
    expect(
      shouldExcludeEvent(
        "/home/user/.config/jin/benchmarks/latest.json",
        jinOutputPaths
      )
    ).toBe(true);
  });

  test("excludes jin pid file", () => {
    expect(
      shouldExcludeEvent("/home/user/.config/jin/jin.pid", jinOutputPaths)
    ).toBe(true);
  });
});
