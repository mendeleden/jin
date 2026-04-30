import { describe, expect, test } from "bun:test";
import { buildRunningRuntimeGuidance } from "../src/commands/sink";

describe("buildRunningRuntimeGuidance", () => {
  test("includes the actionable stop/repush/start sequence for service mode", () => {
    const message = buildRunningRuntimeGuidance("service", "postgres-0");
    expect(message).toContain("OS service manager");
    expect(message).toContain("jin stop");
    expect(message).toContain("jin sink repush postgres-0");
    expect(message).toContain("jin start --service");
  });

  test("uses jin start for daemon mode", () => {
    const message = buildRunningRuntimeGuidance("daemon", "team-postgres");
    expect(message).toContain("background daemon");
    expect(message).toContain("jin sink repush team-postgres");
    expect(message).toMatch(/    jin start\n/);
    expect(message).not.toContain("--service");
    expect(message).not.toContain("--foreground");
  });

  test("uses jin start --foreground for foreground mode", () => {
    const message = buildRunningRuntimeGuidance("foreground", "webhook-0");
    expect(message).toContain("foreground runtime");
    expect(message).toContain("jin start --foreground");
  });

  test("explains why the daemon must be paused", () => {
    const message = buildRunningRuntimeGuidance("service", "postgres-0");
    expect(message.toLowerCase()).toContain("push loop would conflict");
  });
});
