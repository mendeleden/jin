import { afterEach, describe, expect, test } from "bun:test";
import type { Conversation, Message, ToolCall } from "../src/contracts/conversations";
import type { PushPayload, PushResult, SinkHealth } from "../src/contracts/sinks";
import { WebhookSink } from "../src/sinks/webhook";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WebhookSink", () => {
  test("healthCheck uses HEAD and treats 405 as ready", async () => {
    const calls: RequestInit[] = [];
    setFetch(async (_input, init) => {
      calls.push(init ?? {});
      return new Response(null, { status: 405 });
    });

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
    });

    const result = (await sink.healthCheck()) as SinkHealth;

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("HEAD");
  });

  test("healthCheck includes team and user headers when configured", async () => {
    const calls: RequestInit[] = [];
    setFetch(async (_input, init) => {
      calls.push(init ?? {});
      return new Response(null, { status: 405 });
    });

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
      teamId: "team-1",
      userId: "user-9",
    });

    const result = (await sink.healthCheck()) as SinkHealth;

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Jin-Team": "team-1",
      "X-Jin-User": "user-9",
    });
  });

  test("push sends BP-06 full snapshots with derived idempotency keys", async () => {
    const payloads = [makePayload("conv-1", 7), makePayload("conv-2", 8)];
    const bodies: string[] = [];

    setFetch(async (_input, init) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 202 });
    });

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
    });

    const result = (await sink.push(payloads)) as PushResult;
    const requestBody = JSON.parse(bodies[0] ?? "") as {
      batch: Array<Record<string, unknown>>;
    };

    expect(result).toEqual({ pushed: 2, failed: 0, errors: [] });
    expect(requestBody).toEqual({
      batch: payloads.map((payload) => ({
        idempotencyKey: `${payload.conversation.id}:r${payload.attemptedRevision}`,
        conversation: payload.conversation,
        messages: payload.messages,
        toolCalls: payload.toolCalls,
      })),
    });
    expect(requestBody.batch[0]).not.toHaveProperty("attemptedRevision");
  });

  test("push reports partial batch failures by conversation id", async () => {
    const payloads = [makePayload("conv-1", 1), makePayload("conv-2", 2)];

    setFetch(async () =>
      new Response(
        JSON.stringify({
          errors: [{ conversationId: "conv-2", error: "Receiver rejected snapshot" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
    });

    const result = (await sink.push(payloads)) as PushResult;

    expect(result).toEqual({
      pushed: 1,
      failed: 1,
      errors: [{ conversationId: "conv-2", error: "Receiver rejected snapshot" }],
    });
  });

  test("push maps non-ok responses to every failed conversation", async () => {
    const payloads = [makePayload("conv-1", 1), makePayload("conv-2", 2)];
    let callCount = 0;

    setFetch(async () => {
      callCount += 1;
      return new Response("upstream unavailable", { status: 503, statusText: "Service Unavailable" });
    });

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
    });

    const result = (await sink.push(payloads)) as PushResult;

    expect(callCount).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors).toEqual([
      {
        conversationId: "conv-1",
        error: "HTTP 503 Service Unavailable: upstream unavailable",
      },
      {
        conversationId: "conv-2",
        error: "HTTP 503 Service Unavailable: upstream unavailable",
      },
    ]);
  });

  test("push treats timeout as an explicit failure without retrying", async () => {
    const payloads = [makePayload("conv-timeout", 3)];
    let callCount = 0;

    setFetch(async (_input, init) => {
      callCount += 1;
      return await new Promise<Response>((_resolve, reject) => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        init?.signal?.addEventListener(
          "abort",
          () => reject(error),
          { once: true },
        );
      });
    });

    const sink = new WebhookSink({
      type: "webhook",
      id: "webhook-ref",
      enabled: true,
      url: "https://example.com/webhook",
      timeoutMs: 5,
    });

    const result = (await sink.push(payloads)) as PushResult;

    expect(callCount).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      {
        conversationId: "conv-timeout",
        error: "Request timed out after 5ms",
      },
    ]);
  });
});

function makePayload(conversationId: string, attemptedRevision: number): PushPayload {
  const conversation: Conversation = {
    id: conversationId,
    traceId: `trace-${conversationId}`,
    parentId: "",
    relationship: "root",
    forkPoint: 0,
    adapterId: "claude-code",
    name: `Conversation ${conversationId}`,
    cwd: "/tmp/project",
    gitRemote: "https://github.com/example/repo.git",
    branch: "main",
    model: "claude-sonnet-4",
    startedAt: "2026-04-01T12:00:00.000Z",
    endedAt: "2026-04-01T12:05:00.000Z",
    sourcePath: `/tmp/${conversationId}.jsonl`,
    sourceFormat: "jsonl",
    durationMs: 300_000,
    messageCount: 2,
    toolCount: 1,
    turnCount: 1,
    inputTokens: 120,
    outputTokens: 45,
    cacheRead: 0,
    cacheWrite: 0,
    estCost: 0.12,
  };

  const messages: Message[] = [
    {
      id: `${conversationId}-msg-1`,
      conversationId,
      role: "user",
      content: "Please summarize the latest build output.",
      recordType: "message",
      model: "",
      sequence: 1,
      turn: 1,
      isSidechain: false,
      parentMessageId: "",
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      thinkingContent: "",
      thinkingTokens: 0,
      timestamp: "2026-04-01T12:00:01.000Z",
      toolUses: [],
    },
    {
      id: `${conversationId}-msg-2`,
      conversationId,
      role: "assistant",
      content: "Build passed after the webhook sink update.",
      recordType: "message",
      model: "claude-sonnet-4",
      sequence: 2,
      turn: 1,
      isSidechain: false,
      parentMessageId: `${conversationId}-msg-1`,
      inputTokens: 120,
      outputTokens: 45,
      cacheRead: 0,
      cacheWrite: 0,
      thinkingContent: "",
      thinkingTokens: 0,
      timestamp: "2026-04-01T12:00:02.000Z",
      toolUses: [],
    },
  ];

  const toolCalls: ToolCall[] = [
    {
      id: `${conversationId}-tool-1`,
      conversationId,
      messageId: `${conversationId}-msg-2`,
      name: "search",
      input: "{\"query\":\"build output\"}",
      output: "{\"status\":\"ok\"}",
      isError: false,
      durationMs: 42,
      timestamp: "2026-04-01T12:00:02.500Z",
    },
  ];

  return {
    attemptedRevision,
    conversation,
    messages,
    toolCalls,
  };
}

function setFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    await handler(input, init)) as unknown as typeof fetch;
}
