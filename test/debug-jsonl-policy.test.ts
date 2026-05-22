import { describe, expect, test } from "bun:test";
import { join } from "path";
import { resolveDebugJsonlPath } from "../src/diagnostics/debug-jsonl";

describe("debug JSONL policy", () => {
  test("JIN_DIAGNOSTIC_LOG is a path override, not an enable switch", () => {
    const env = { JIN_DIAGNOSTIC_LOG: "/tmp/custom-debug.jsonl" };

    expect(
      resolveDebugJsonlPath({
        enabled: false,
        configDir: "/tmp/jin-config",
        env,
      }),
    ).toBeUndefined();
  });

  test("explicit opt-in uses the configured override path", () => {
    const env = { JIN_DIAGNOSTIC_LOG: "/tmp/custom-debug.jsonl" };

    expect(
      resolveDebugJsonlPath({
        enabled: true,
        configDir: "/tmp/jin-config",
        env,
      }),
    ).toBe("/tmp/custom-debug.jsonl");
  });

  test("explicit opt-in falls back to config-dir debug.jsonl", () => {
    expect(
      resolveDebugJsonlPath({
        enabled: true,
        configDir: "/tmp/jin-config",
        env: {},
      }),
    ).toBe(join("/tmp/jin-config", "debug.jsonl"));
  });
});
