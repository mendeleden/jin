import { afterEach, describe, expect, test } from "bun:test";
import type { Conversation, Message, ToolCall } from "../src/contracts/conversations";
import type { PushPayload, PushResult, SinkHealth } from "../src/contracts/sinks";
import { PostgresSink } from "../src/sinks/postgres";

type SqlCall = {
  query: string;
  params: unknown[];
};

type SqlResponse = Response | { rows?: Array<Record<string, unknown>> };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("PostgresSink", () => {
  test("healthCheck succeeds when the schema version and tool-call key match", async () => {
    const calls: SqlCall[] = [];

    setSqlTransport(calls, async (call) => {
      if (call.query.includes(`SELECT value FROM "public"."jin_meta"`)) {
        return { rows: [{ value: "2.5" }] };
      }

      if (call.query.includes(`SELECT pg_get_constraintdef(oid) AS definition`)) {
        return { rows: [{ definition: "PRIMARY KEY (conversation_id, message_id, id)" }] };
      }

      if (call.query.includes("FROM information_schema.columns")) {
        return { rows: [{ column_name: "team_id" }, { column_name: "user_id" }] };
      }

      return { rows: [] };
    });

    const result = (await makeSink().healthCheck()) as SinkHealth;

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.query).toContain(`SELECT value FROM "public"."jin_meta"`);
    expect(calls[0]?.params).toEqual(["schema_version"]);
    expect(calls[1]?.query).toContain(`SELECT pg_get_constraintdef(oid) AS definition`);
    expect(calls[2]?.query).toContain("FROM information_schema.columns");
  });

  test("healthCheck refuses the sink when the remote tool-call key is still legacy-shaped", async () => {
    const calls: SqlCall[] = [];

    setSqlTransport(calls, async (call) => {
      if (call.query.includes(`SELECT value FROM "public"."jin_meta"`)) {
        return { rows: [{ value: "2.5" }] };
      }

      if (call.query.includes(`SELECT pg_get_constraintdef(oid) AS definition`)) {
        return { rows: [{ definition: "PRIMARY KEY (id)" }] };
      }

      return { rows: [] };
    });

    const result = (await makeSink().healthCheck()) as SinkHealth;

    expect(result.ok).toBe(false);
    expect(result.error).toContain(`"public"."jin_tool_calls"`);
    expect(result.error).toContain("PRIMARY KEY (conversation_id, message_id, id)");
    expect(result.error).toContain("jin team schema apply");
  });

  test("push pauses every payload when the remote schema major version is incompatible", async () => {
    const calls: SqlCall[] = [];
    const payloads = [makePayload("conv-1", 1), makePayload("conv-2", 2)];

    setSqlTransport(calls, async () => ({ rows: [{ value: "3.0" }] }));

    const result = (await makeSink().push(payloads)) as PushResult;

    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(payloads.length);
    expect(result.errors).toEqual([
      {
        conversationId: "conv-1",
        error: expect.stringContaining("Push paused"),
      },
      {
        conversationId: "conv-2",
        error: expect.stringContaining("Push paused"),
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain(`SELECT value FROM "public"."jin_meta"`);
  });

  test("healthCheck refuses the sink when schema metadata is missing", async () => {
    const calls: SqlCall[] = [];

    setSqlTransport(
      calls,
      async () =>
        new Response('relation "public.jin_meta" does not exist', {
          status: 400,
          statusText: "Bad Request",
        }),
    );

    const result = (await makeSink().healthCheck()) as SinkHealth;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Remote schema is not initialized");
    expect(result.error).toContain(`"public"."jin_meta"`);
    expect(calls).toHaveLength(1);
  });

  test("healthCheck surfaces permission denied on jin_meta instead of reporting missing schema", async () => {
    const calls: SqlCall[] = [];

    setSqlTransport(
      calls,
      async () =>
        new Response("permission denied for relation public.jin_meta", {
          status: 403,
          statusText: "Forbidden",
        }),
    );

    const result = (await makeSink().healthCheck()) as SinkHealth;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Postgres HTTP error 403");
    expect(result.error).toContain("permission denied for relation public.jin_meta");
    expect(result.error).not.toContain("Remote schema is not initialized");
    expect(calls).toHaveLength(1);
  });

  test("push uses full-snapshot DML only and keeps pushed plus failed equal to the payload count", async () => {
    const calls: SqlCall[] = [];
    const payloads = [makePayload("conv-ok", 7), makePayload("conv-fail", 8)];

    setSqlTransport(calls, async (call) => {
      if (call.query.includes(`SELECT value FROM "public"."jin_meta"`)) {
        return { rows: [{ value: "2.5" }] };
      }

      if (call.query.includes(`SELECT pg_get_constraintdef(oid) AS definition`)) {
        return { rows: [{ definition: "PRIMARY KEY (conversation_id, message_id, id)" }] };
      }

      if (call.query.includes("FROM information_schema.columns")) {
        return { rows: [{ column_name: "team_id" }, { column_name: "user_id" }] };
      }

      if (
        call.query.includes(`INSERT INTO "public"."jin_conversations"`) &&
        call.params[0] === "conv-fail"
      ) {
        return new Response("upsert failed", {
          status: 409,
          statusText: "Conflict",
        });
      }

      return { rows: [] };
    });

    const result = (await makeSink("https://postgres.example/sql", {
      teamId: "team-1",
      userId: "user-9",
    }).push(payloads)) as PushResult;
    const ddlQueries = calls.filter((call) =>
      /^(CREATE|ALTER|DROP|TRUNCATE)\b/.test(call.query.trim().toUpperCase()),
    );

    expect(result).toEqual({
      pushed: 1,
      failed: 1,
      errors: [
        {
          conversationId: "conv-fail",
          error: "Postgres HTTP error 409: upsert failed",
        },
      ],
    });
    expect(result.pushed + result.failed).toBe(payloads.length);
    expect(ddlQueries).toEqual([]);
    expect(calls.some((call) => call.query.includes(`INSERT INTO "public"."jin_conversations"`))).toBe(true);
    expect(calls.some((call) => call.query.includes(`INSERT INTO "public"."jin_messages"`))).toBe(true);
    expect(calls.some((call) => call.query.includes(`INSERT INTO "public"."jin_tool_calls"`))).toBe(true);
    const conversationInsert = calls.find((call) =>
      call.query.includes(`INSERT INTO "public"."jin_conversations"`),
    );
    expect(conversationInsert?.params.slice(-2)).toEqual([
      "team-1",
      "user-9",
    ]);
  });

  test("push uses sql.begin for postgres:// schema and DML queries when root-client unsafe is disallowed", async () => {
    const connectionCalls: SqlCall[] = [];
    const transactionCalls: SqlCall[] = [];
    const payloads = [makePayload("conv-psql", 3)];

    const transactionExecutor = {
      unsafe: async (query: string, params: unknown[] = []) => {
        transactionCalls.push({ query, params });
        if (query.includes(`SELECT value FROM "public"."jin_meta"`)) {
          return [{ value: "2.5" }];
        }
        if (query.includes(`SELECT pg_get_constraintdef(oid) AS definition`)) {
          return [{ definition: "PRIMARY KEY (conversation_id, message_id, id)" }];
        }
        if (query.includes("FROM information_schema.columns")) {
          return [{ column_name: "team_id" }, { column_name: "user_id" }];
        }
        return [];
      },
    };

    const fakeConn = {
      begin: async <T>(work: (tx: typeof transactionExecutor) => Promise<T>) => {
        return await work(transactionExecutor);
      },
      unsafe: async (query: string, params: unknown[] = []) => {
        connectionCalls.push({ query, params });
        throw new Error("Only use sql.begin, sql.reserved or max: 1");
      },
      close: async () => {},
    };

    const sink = makeSink("postgres://postgres.example/jin");
    (sink as unknown as { conn: unknown }).conn = fakeConn;

    const result = (await sink.push(payloads)) as PushResult;

    expect(result).toEqual({
      pushed: 1,
      failed: 0,
      errors: [],
    });
    expect(connectionCalls).toHaveLength(0);
    expect(
      transactionCalls.some((call) =>
        /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(call.query),
      ),
    ).toBe(false);
    expect(
      transactionCalls.some((call) =>
        call.query.includes(`SELECT value FROM "public"."jin_meta"`),
      ),
    ).toBe(true);
    expect(
      transactionCalls.some((call) =>
        call.query.includes(`INSERT INTO "public"."jin_conversations"`),
      ),
    ).toBe(true);
  });
});

function makeSink(
  connectionString = "https://postgres.example/sql",
  identity: { teamId?: string; userId?: string } = {},
): PostgresSink {
  return new PostgresSink({
    type: "postgres",
    id: "postgres-ref",
    enabled: true,
    connectionString,
    ...identity,
  } as ConstructorParameters<typeof PostgresSink>[0]);
}

function setSqlTransport(
  calls: SqlCall[],
  handler: (call: SqlCall) => Promise<SqlResponse> | SqlResponse,
): void {
  globalThis.fetch = async (_input, init) => {
    const rawBody = String(init?.body ?? "{}");
    const parsed = JSON.parse(rawBody) as {
      query?: unknown;
      params?: unknown;
    };
    const call: SqlCall = {
      query: typeof parsed.query === "string" ? parsed.query : "",
      params: Array.isArray(parsed.params) ? parsed.params : [],
    };
    calls.push(call);

    const response = await handler(call);
    if (response instanceof Response) {
      return response;
    }

    return new Response(JSON.stringify({ rows: response.rows ?? [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

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
      content: "Summarize the sink status.",
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
      content: "The Postgres reference sink is ready.",
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
      input: "{\"query\":\"sink status\"}",
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
