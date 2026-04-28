import { afterEach, describe, expect, test } from "bun:test";
import type {
  Conversation,
  Message,
  ToolCall,
} from "../src/contracts/conversations";
import type {
  PushPayload,
  PushResult,
  SinkHealth,
} from "../src/contracts/sinks";
import { S3Sink } from "../src/sinks/s3";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("S3Sink", () => {
  test("healthCheck reports bucket readiness failures without provisioning", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];

    setFetch(async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(null, { status: 404, statusText: "Not Found" });
    });

    const sink = makeSink();
    const result = (await sink.healthCheck()) as SinkHealth;

    expect(result).toEqual({ ok: false, error: "HTTP 404 Not Found" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://storage.example.com/sink-bucket/");
    expect(calls[0]?.init?.method).toBe("HEAD");
  });

  test("push uploads BP-06 full snapshots to stable object keys", async () => {
    const payloads = [makePayload("conv-1", 7), makePayload("conv-2", 8)];
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];

    setFetch(async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(null, { status: 200 });
    });

    const sink = makeSink();
    const result = (await sink.push(payloads)) as PushResult;

    expect(result).toEqual({ pushed: 2, failed: 0, errors: [] });
    expect(calls.map((call) => call.input)).toEqual([
      "https://storage.example.com/sink-bucket/exports/root/claude-code/conv-1.json",
      "https://storage.example.com/sink-bucket/exports/root/claude-code/conv-2.json",
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["PUT", "PUT"]);

    const firstBody = JSON.parse(String(calls[0]?.init?.body ?? ""));
    const secondBody = JSON.parse(String(calls[1]?.init?.body ?? ""));

    expect(firstBody).toEqual({
      conversation: payloads[0]?.conversation,
      messages: payloads[0]?.messages,
      toolCalls: payloads[0]?.toolCalls,
    });
    expect(secondBody).toEqual({
      conversation: payloads[1]?.conversation,
      messages: payloads[1]?.messages,
      toolCalls: payloads[1]?.toolCalls,
    });
    expect(firstBody).not.toHaveProperty("attemptedRevision");
    expect(firstBody).not.toHaveProperty("_meta");
  });

  test("push reports upload failures per conversation id", async () => {
    const payloads = [makePayload("conv-1", 1), makePayload("conv-2", 2)];

    setFetch(async (input) => {
      if (String(input).includes("conv-2.json")) {
        return new Response("access denied", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }

      return new Response(null, { status: 200 });
    });

    const sink = makeSink();
    const result = (await sink.push(payloads)) as PushResult;

    expect(result).toEqual({
      pushed: 1,
      failed: 1,
      errors: [
        {
          conversationId: "conv-2",
          error: "HTTP 503 Service Unavailable: access denied",
        },
      ],
    });
  });

  test("push includes team and user metadata when configured", async () => {
    const payloads = [makePayload("conv-1", 7)];
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];

    setFetch(async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(null, { status: 200 });
    });

    const sink = new S3Sink({
      type: "s3",
      id: "s3-ref",
      enabled: true,
      bucket: "sink-bucket",
      region: "us-east-1",
      endpoint: "https://storage.example.com",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      prefix: "exports/root/",
      teamId: "team-1",
      userId: "user-9",
    });

    const result = (await sink.push(payloads)) as PushResult;
    const body = JSON.parse(String(calls[0]?.init?.body ?? ""));

    expect(result).toEqual({ pushed: 1, failed: 0, errors: [] });
    expect(body._meta).toEqual({
      teamId: "team-1",
      userId: "user-9",
    });
  });
});

function makeSink(): S3Sink {
  return new S3Sink({
    type: "s3",
    id: "s3-ref",
    enabled: true,
    bucket: "sink-bucket",
    region: "us-east-1",
    endpoint: "https://storage.example.com",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    prefix: "exports/root/",
  });
}

function makePayload(
  conversationId: string,
  attemptedRevision: number,
): PushPayload {
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
      content: "Build passed after the S3 sink update.",
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
  implementation: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): void {
  globalThis.fetch = implementation as typeof globalThis.fetch;
}
