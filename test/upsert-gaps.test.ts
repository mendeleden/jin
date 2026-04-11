/**
 * Tests proving that upsertSession and upsertMessages silently drop columns.
 *
 * These tests should FAIL on the current (buggy) code and PASS after the fix.
 *
 * Bug: The schema defines `is_compacted` on sessions and `record_type` on messages,
 * but the INSERT statements don't include them — so the values are always the
 * column defaults (0 and '') regardless of what the caller passes.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { createTestEnv, makeSession } from "./helpers";
import type { Message } from "../src/adapters/types";

const { store, cleanup } = createTestEnv();
afterAll(cleanup);

// ═══════════════════════════════════════════════════════════════════════════
// is_compacted is silently dropped by upsertSession
// ═══════════════════════════════════════════════════════════════════════════

describe("upsertSession: is_compacted column", () => {
  test("is_compacted=true survives a round-trip through the store", () => {
    const session = makeSession("compacted-001", {
      isCompacted: true,
      name: "compacted session",
    });

    store.upsertSession(session);
    const retrieved = store.getSession("compacted-001");

    expect(retrieved).not.toBeNull();
    // BUG: is_compacted is not in the INSERT, so it stays at the default (false)
    expect(retrieved!.isCompacted).toBe(true);
  });

  test("is_compacted=false is also persisted correctly", () => {
    const session = makeSession("not-compacted-001", {
      isCompacted: false,
      name: "normal session",
    });

    store.upsertSession(session);
    const retrieved = store.getSession("not-compacted-001");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.isCompacted).toBe(false);
  });

  test("is_compacted updates from false to true on re-upsert", () => {
    const session = makeSession("compact-update-001", {
      isCompacted: false,
      name: "starts normal",
    });

    store.upsertSession(session);
    expect(store.getSession("compact-update-001")!.isCompacted).toBe(false);

    // Session gets compacted — re-upsert with isCompacted=true
    session.isCompacted = true;
    store.upsertSession(session);

    const updated = store.getSession("compact-update-001");
    // BUG: ON CONFLICT doesn't update is_compacted, so it stays false
    expect(updated!.isCompacted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// record_type is silently dropped by upsertMessages
// ═══════════════════════════════════════════════════════════════════════════

describe("upsertMessages: record_type column", () => {
  const sessionId = "recordtype-001";

  test("record_type survives a round-trip through the store", () => {
    store.upsertSession(makeSession(sessionId, { name: "record type test" }));

    const messages: Message[] = [
      {
        id: "msg-rt-user",
        role: "user",
        content: "Hello",
        timestamp: "2026-03-01T10:00:00Z",
        model: "",
        inputTokens: 10,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "user",
      },
      {
        id: "msg-rt-assistant",
        role: "assistant",
        content: "Hi there",
        timestamp: "2026-03-01T10:00:05Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 10,
        outputTokens: 20,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "assistant",
      },
      {
        id: "msg-rt-boundary",
        role: "system",
        content: '{"trigger":"manual","preTokens":143032}',
        timestamp: "2026-03-01T10:01:00Z",
        model: "",
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "system:compact_boundary",
      },
    ];

    store.upsertMessages(sessionId, messages);
    const retrieved = store.getMessages(sessionId);

    expect(retrieved).toHaveLength(3);

    const user = retrieved.find((m) => m.id === "msg-rt-user");
    const assistant = retrieved.find((m) => m.id === "msg-rt-assistant");
    const boundary = retrieved.find((m) => m.id === "msg-rt-boundary");

    // BUG: record_type is not in the INSERT, so all values are ''
    expect(user!.recordType).toBe("user");
    expect(assistant!.recordType).toBe("assistant");
    expect(boundary!.recordType).toBe("system:compact_boundary");
  });

  test("record_type updates on re-upsert", () => {
    // Insert a message with one record_type, then update it
    const messages: Message[] = [
      {
        id: "msg-rt-update",
        role: "assistant",
        content: "Original content",
        timestamp: "2026-03-01T10:02:00Z",
        model: "claude-sonnet-4-20250514",
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "assistant",
      },
    ];

    store.upsertMessages(sessionId, messages);
    expect(store.getMessages(sessionId).find((m) => m.id === "msg-rt-update")!.recordType).toBe("assistant");

    // Re-upsert with changed record_type (e.g., message gets reclassified as system record)
    messages[0].recordType = "system:compact_boundary";
    messages[0].content = '{"trigger":"manual","preTokens":50000}';
    store.upsertMessages(sessionId, messages);

    const updated = store.getMessages(sessionId).find((m) => m.id === "msg-rt-update");
    // BUG: ON CONFLICT doesn't update record_type
    expect(updated!.recordType).toBe("system:compact_boundary");
  });
});
