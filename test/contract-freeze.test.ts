import { describe, expect, test } from "bun:test";
import { ADAPTER_CHANGE_HINT_KINDS } from "../src/contracts/adapters";
import {
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  SINK_TYPES,
} from "../src/contracts/config";
import { CONVERSATION_RELATIONSHIPS } from "../src/contracts/conversations";
import {
  RUNTIME_MODES,
  RUNTIME_STATES,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
} from "../src/contracts/lifecycle";
import {
  DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  DEFAULT_INGEST_BATCH_SIZE,
  DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
  DEFAULT_PUSH_BATCH_SIZE,
  DEFAULT_WATCH_DEBOUNCE_MS,
} from "../src/contracts/pipeline";

describe("Wave 0 contract freeze", () => {
  test("freezes the shared enum-like contract sets", () => {
    expect(CONVERSATION_RELATIONSHIPS).toEqual([
      "root",
      "compacted",
      "spawned",
      "forked",
    ]);
    expect(ADAPTER_CHANGE_HINT_KINDS).toEqual([
      "startup-scan",
      "fs-change",
      "periodic-scan",
    ]);
    expect(SINK_TYPES).toEqual(["postgres", "s3", "webhook"]);
    expect(RUNTIME_MODES).toEqual(["foreground", "daemon", "service"]);
    expect(RUNTIME_STATES).toEqual([
      "stopped",
      "starting",
      "running",
      "degraded",
      "stopping",
    ]);
  });

  test("freezes the default operational budgets", () => {
    expect(DEFAULT_SCAN_INTERVAL_MS).toBe(60_000);
    expect(DEFAULT_WATCH_DEBOUNCE_MS).toBe(500);
    expect(DEFAULT_FIND_CHANGED_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_INGEST_BATCH_SIZE).toBe(20);
    expect(DEFAULT_PUSH_BATCH_SIZE).toBe(20);
    expect(SHUTDOWN_DRAIN_TIMEOUT_MS).toBe(15_000);
    expect(DEFAULT_S3_REGION).toBe("us-east-1");
    expect(DEFAULT_S3_PREFIX).toBe("jin/");
    expect(DEFAULT_WEBHOOK_TIMEOUT_MS).toBe(30_000);
  });
});
