import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  Adapter,
  ChangeHint,
} from "../src/contracts/adapters";
import type {
  Conversation,
  ConversationBundle,
  ConversationRef,
  Message,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
  ToolCall,
} from "../src/contracts/conversations";
import type { RouteConfig } from "../src/contracts/config";
import type {
  PushPayload,
  PushResult,
  Sink,
} from "../src/contracts/sinks";
import type { ConversationStore } from "../src/contracts/store";
import type { PipelineLogger } from "../src/pipeline";
import { DiagnosticLogger } from "../src/pipeline/diagnostic";
import { ingestOne, pushDirty, runPipeline } from "../src/pipeline";

const ROUTE_ALL: RouteConfig[] = [
  {
    match: {},
    sinks: ["primary", "disabled"],
  },
];

afterEach(async () => {
  await Bun.sleep(0);
});

describe("pipeline spec gap closure", () => {
  test("BP-02 matrix row: findChanged timeout logs and skips that adapter cycle", async () => {
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        return never<ConversationRef[]>();
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const result = await ingestOne(
      adapter,
      store,
      { kind: "periodic-scan" },
      {
        logger,
        findChangedTimeoutMs: 5,
      },
    );

    expect(result).toEqual({
      scannedRefCount: 0,
      loadedConversationCount: 0,
      changedConversationIds: [],
      anyChanged: false,
    });
    expect(adapter.loadConversationRefs).toEqual([]);
    expect(logger.warns).toContain(
      "Adapter alpha findChanged timed out after 5ms; skipping adapter for this cycle",
    );
  });

  test("BP-02 matrix row: loadConversation timeout logs and skips only that ref", async () => {
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        return [makeRef("alpha-timeout", "alpha"), makeRef("alpha-ok", "alpha")];
      },
      async loadConversation(ref) {
        if (ref.id === "alpha-timeout") {
          return never<ConversationBundle | null>();
        }

        return makeBundle(ref.id, "alpha");
      },
    });

    const result = await ingestOne(
      adapter,
      store,
      { kind: "periodic-scan" },
      {
        logger,
        loadConversationTimeoutMs: 5,
      },
    );

    expect(result.scannedRefCount).toBe(2);
    expect(result.loadedConversationCount).toBe(1);
    expect(result.changedConversationIds).toEqual(["alpha-ok"]);
    expect(result.anyChanged).toBe(true);
    expect(store.getConversation("alpha-timeout")).toBeNull();
    expect(store.getConversation("alpha-ok")?.id).toBe("alpha-ok");
    expect(logger.warns).toContain(
      "Adapter alpha loadConversation timed out for alpha-timeout after 5ms; skipping ref",
    );
  });

  test("BP-02 matrix row: Codex ingest narrows batch cadence to bound peak RSS", async () => {
    const store = new InMemoryConversationStore();
    const processedRefs: number[] = [];
    const adapter = new TestAdapter("codex", {
      async findChanged() {
        return [
          makeRef("codex-1", "codex"),
          makeRef("codex-2", "codex"),
          makeRef("codex-3", "codex"),
        ];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "codex");
      },
    });

    const result = await ingestOne(
      adapter,
      store,
      { kind: "startup-scan" },
      {
        batchSize: 20,
        onBatchProcessed: ({ processedRefs: count }) => {
          processedRefs.push(count);
        },
      },
    );

    expect(result.scannedRefCount).toBe(3);
    expect(result.loadedConversationCount).toBe(3);
    expect(result.anyChanged).toBe(true);
    expect(adapter.loadConversationRefs).toEqual([
      "codex-1",
      "codex-2",
      "codex-3",
    ]);
    expect(processedRefs).toEqual([1, 2]);
  });

  test("BP-08 matrix row: pushDirty skips disabled sinks without affecting enabled sinks", async () => {
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    const enabledSink = new TestSink("primary");
    const disabledSink = new TestSink("disabled", { enabled: false });

    store.writeBundle(makeBundle("conversation-1", "alpha"));

    const result = await pushDirty(
      store,
      [enabledSink, disabledSink],
      ROUTE_ALL,
      { logger },
    );

    expect(result).toMatchObject({
      sinkAttempts: 1,
      pushedConversations: 1,
      failedConversations: 0,
    });
    expect(enabledSink.pushCalls).toHaveLength(1);
    expect(disabledSink.pushCalls).toHaveLength(0);
    expect(store.conversationsNeedingPush("primary")).toEqual([]);
    expect(store.conversationsNeedingPush("disabled")).toEqual([
      "conversation-1",
    ]);
    expect(logger.infos).toContain("Skipping disabled sink disabled");
  });

  test("BP-02 matrix row: RSS warning and hard limit enforcement run in the v2 pipeline path", async () => {
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    const sink = new TestSink("primary");
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        return [
          makeRef("alpha-1", "alpha"),
          makeRef("alpha-2", "alpha"),
          makeRef("alpha-3", "alpha"),
        ];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });
    const rssReads = [mb(150), mb(220), mb(260), mb(260)];
    let rssReadIndex = 0;

    const handle = await runPipeline({
      adapterSource: [adapter],
      store,
      sinks: [sink],
      routes: [
        {
          match: {},
          sinks: ["primary"],
        },
      ],
      logger,
      scheduleStartupWork: false,
      scanIntervalMs: null,
      ingestBatchSize: 1,
      pushBatchSize: 1,
      getRssBytes: () =>
        rssReads[Math.min(rssReadIndex++, rssReads.length - 1)] ?? mb(260),
    });

    try {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "periodic-scan" },
      });

      await waitFor(() =>
        logger.errors.some((message) => message.includes("hard limit")),
      );

      const result = await handle.shutdown();

      expect(result.timedOut).toBe(false);
      expect(logger.warns.some((message) => message.includes("warning threshold"))).toBe(
        true,
      );
      expect(logger.errors.some((message) => message.includes("hard limit"))).toBe(
        true,
      );
      expect(store.getConversation("alpha-1")?.id).toBe("alpha-1");
      expect(store.getConversation("alpha-2")?.id).toBe("alpha-2");
      expect(store.getConversation("alpha-3")).toBeNull();
      expect(sink.pushCalls).toHaveLength(0);
      expect(sink.closeCalls).toBe(1);
    } finally {
      await handle.shutdown();
    }
  });

  test("diagnostics emit a single failed work:end entry when pipeline work throws", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "jin-pipeline-diagnostic-"));
    const diagnosticPath = join(tempRoot, "debug.jsonl");
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    let adapterSourceCalls = 0;

    const handle = await runPipeline({
      adapterSource: async () => {
        adapterSourceCalls += 1;
        if (adapterSourceCalls === 1) {
          return [];
        }
        throw new Error("boom");
      },
      store,
      sinks: [],
      routes: [],
      logger,
      diagnosticLogPath: diagnosticPath,
      scheduleStartupWork: false,
      scanIntervalMs: null,
    });

    try {
      handle.enqueue({
        kind: "reconcile-adapters",
      });

      await handle.waitForIdle();

      const entries = readFileSync(diagnosticPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const workEnds = entries.filter(
        (entry) =>
          entry.event === "work:end" &&
          entry.kind === "reconcile-adapters",
      );

      expect(workEnds).toHaveLength(1);
      expect(workEnds[0]?.error).toBe("boom");
      expect(logger.errors).toEqual(["Pipeline work item reconcile-adapters failed"]);
    } finally {
      await handle.shutdown();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("push diagnostics emit repush lifecycle, batch progress, and sampled long-push events", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "jin-push-diagnostic-"));
    const diagnosticPath = join(tempRoot, "debug.jsonl");
    const store = new InMemoryConversationStore();
    const logger = createLogger();
    const sink: Sink = {
      id: "primary",
      name: "primary",
      async push(payloads) {
        await Bun.sleep(25);
        return {
          pushed: payloads.length,
          failed: 0,
          errors: [],
        };
      },
      async healthCheck() {
        return { ok: true };
      },
      async close() {},
    };
    const diag = new DiagnosticLogger({
      path: diagnosticPath,
      getRssBytes: () => process.memoryUsage().rss,
      getQueueSize: () => 0,
      getQueueSnapshot: () => [],
    });

    store.writeBundle(makeBundle("repush-diagnostic", "alpha"));

    try {
      const summary = await pushDirty(
        store,
        [sink],
        [
          {
            match: {},
            sinks: ["primary"],
          },
        ],
        {
          logger,
          diag,
          reason: "repush",
          batchSize: 1,
          sampleIntervalMs: 5,
        },
      );
      diag.pushResult(summary, 25, summary.sinkBreakdown, "repush");

      const entries = readFileSync(diagnosticPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "push:start",
            sinkId: "primary",
            reason: "repush",
            dirtyConversations: 1,
            staleConversations: 0,
            batchCount: 1,
          }),
          expect.objectContaining({
            event: "push:batch",
            sinkId: "primary",
            reason: "repush",
            batchIndex: 1,
            batchCount: 1,
            payloadCount: 1,
            selectedConversations: 1,
          }),
          expect.objectContaining({
            event: "push:ok",
            sinkId: "primary",
            reason: "repush",
            conversationId: "repush-diagnostic",
            attemptedRevision: 1,
          }),
          expect.objectContaining({
            event: "push:sink-result",
            sinkId: "primary",
            reason: "repush",
            dirtyConversations: 1,
            staleConversations: 0,
            pushed: 1,
            failed: 0,
          }),
          expect.objectContaining({
            event: "push:result",
            reason: "repush",
            sinkAttempts: 1,
            pushed: 1,
            failed: 0,
          }),
        ]),
      );
      expect(
        entries.some((entry) => entry.event === "push:sample"),
      ).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function createLogger(): TestLogger {
  return {
    infos: [],
    warns: [],
    errors: [],
    info(message: string) {
      this.infos.push(message);
    },
    warn(message: string) {
      this.warns.push(message);
    },
    error(message: string) {
      this.errors.push(message);
    },
  };
}

interface TestLogger extends PipelineLogger {
  infos: string[];
  warns: string[];
  errors: string[];
}

class TestAdapter implements Adapter {
  readonly name: string;
  readonly findChangedHints: Array<ChangeHint | undefined> = [];
  readonly loadConversationRefs: string[] = [];
  private readonly behavior: {
    findChanged: (
      hint: ChangeHint | undefined,
      callIndex: number,
    ) => Promise<ConversationRef[]>;
    loadConversation: (
      ref: ConversationRef,
      callIndex: number,
    ) => Promise<ConversationBundle | null>;
    watchPaths?: string[];
  };

  constructor(
    readonly id: string,
    behavior: {
      findChanged: (
        hint: ChangeHint | undefined,
        callIndex: number,
      ) => Promise<ConversationRef[]>;
      loadConversation: (
        ref: ConversationRef,
        callIndex: number,
      ) => Promise<ConversationBundle | null>;
      watchPaths?: string[];
    },
  ) {
    this.name = id;
    this.behavior = behavior;
  }

  async detect(): Promise<boolean> {
    return true;
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    const callIndex = this.findChangedHints.length + 1;
    this.findChangedHints.push(hint);
    return this.behavior.findChanged(hint, callIndex);
  }

  async loadConversation(
    ref: ConversationRef,
  ): Promise<ConversationBundle | null> {
    const callIndex = this.loadConversationRefs.length + 1;
    this.loadConversationRefs.push(ref.id);
    return this.behavior.loadConversation(ref, callIndex);
  }

  watchPaths(): string[] {
    return this.behavior.watchPaths ?? [`/watch/${this.id}`];
  }
}

class TestSink implements Sink {
  readonly name: string;
  readonly pushCalls: PushPayload[][] = [];
  readonly enabled?: boolean;
  closeCalls = 0;

  constructor(
    readonly id: string,
    options: {
      enabled?: boolean;
    } = {},
  ) {
    this.name = id;
    this.enabled = options.enabled;
  }

  async push(payloads: PushPayload[]): Promise<PushResult> {
    this.pushCalls.push(clonePayloads(payloads));
    return {
      pushed: payloads.length,
      failed: 0,
      errors: [],
    };
  }

  async healthCheck() {
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class InMemoryConversationStore implements ConversationStore {
  private readonly records = new Map<
    string,
    {
      bundleKey: string;
      conversation: Conversation;
      messages: Message[];
      toolCalls: ToolCall[];
      revision: number;
    }
  >();
  private readonly pushState = new Map<
    string,
    Map<
      string,
      {
        lastAttemptedRevision: number;
        lastSuccessfulRevision: number;
        lastError: string;
      }
    >
  >();

  beginWrite(conversation: ParsedConversation) {
    const store = this;
    const messages: ParsedMessage[] = [];
    let active = true;
    let finished = false;

    return {
      appendMessage(message: ParsedMessage) {
        assertActive();
        messages.push(cloneMessage(message));
      },
      finish(_bundleHash: string) {
        assertActive();
        finished = true;
        active = false;
        return store.writeBundle({
          conversation: { ...conversation },
          messages,
        });
      },
      abort() {
        if (!active) {
          return;
        }
        active = false;
        finished = false;
        messages.length = 0;
      },
    };

    function assertActive(): void {
      if (!active || finished) {
        throw new Error("in-memory write session is no longer active");
      }
    }
  }

  writeBundle(bundle: ConversationBundle) {
    const conversationId = bundle.conversation.id;
    const bundleKey = JSON.stringify(bundle);
    const existing = this.records.get(conversationId);

    if (existing && existing.bundleKey === bundleKey) {
      return {
        changed: false,
        revision: existing.revision,
      };
    }

    const revision = existing ? existing.revision + 1 : 1;
    const messages = bundle.messages.map((message) => ({
      conversationId,
      ...cloneMessage(message),
    }));
    const toolCalls = flattenToolCalls(conversationId, bundle.messages);
    const conversation = buildConversation(
      bundle.conversation,
      messages,
      toolCalls,
    );

    this.records.set(conversationId, {
      bundleKey,
      conversation,
      messages,
      toolCalls,
      revision,
    });

    return {
      changed: true,
      revision,
    };
  }

  getConversation(id: string): Conversation | null {
    return this.records.get(id)?.conversation ?? null;
  }

  getMessages(conversationId: string): Message[] {
    return this.records.get(conversationId)?.messages ?? [];
  }

  getToolCalls(conversationId: string): ToolCall[] {
    return this.records.get(conversationId)?.toolCalls ?? [];
  }

  getRevision(conversationId: string): number {
    return this.records.get(conversationId)?.revision ?? 0;
  }

  conversationsNeedingPush(sinkId: string): string[] {
    return [...this.records.entries()]
      .filter(([conversationId, record]) => {
        const state = this.pushState.get(conversationId)?.get(sinkId);
        return (state?.lastSuccessfulRevision ?? 0) < record.revision;
      })
      .map(([conversationId]) => conversationId)
      .sort();
  }

  recordPushResult(
    conversationId: string,
    sinkId: string,
    attemptedRevision: number,
    result: { ok: true } | { ok: false; error: string },
  ): void {
    const bySink = this.pushState.get(conversationId) ?? new Map();
    const previous = bySink.get(sinkId) ?? {
      lastAttemptedRevision: 0,
      lastSuccessfulRevision: 0,
      lastError: "",
    };

    bySink.set(sinkId, {
      lastAttemptedRevision: attemptedRevision,
      lastSuccessfulRevision: result.ok
        ? attemptedRevision
        : previous.lastSuccessfulRevision,
      lastError: result.ok ? "" : result.error,
    });
    this.pushState.set(conversationId, bySink);
  }

  findOrphanedConversations(): [] {
    return [];
  }

  findConversationsMissingSync(): string[] {
    return [];
  }
}

function buildConversation(
  conversation: ParsedConversation,
  messages: Message[],
  toolCalls: ToolCall[],
): Conversation {
  return {
    ...conversation,
    durationMs: computeDurationMs(conversation.startedAt, conversation.endedAt),
    messageCount: messages.length,
    toolCount: toolCalls.length,
    turnCount: messages.reduce((max, message) => Math.max(max, message.turn), 0),
    inputTokens: messages.reduce((sum, message) => sum + message.inputTokens, 0),
    outputTokens: messages.reduce(
      (sum, message) => sum + message.outputTokens,
      0,
    ),
    cacheRead: messages.reduce((sum, message) => sum + message.cacheRead, 0),
    cacheWrite: messages.reduce((sum, message) => sum + message.cacheWrite, 0),
    estCost: 0,
  };
}

function flattenToolCalls(
  conversationId: string,
  messages: ParsedMessage[],
): ToolCall[] {
  return messages.flatMap((message) =>
    message.toolUses.map((toolCall) => ({
      conversationId,
      messageId: message.id,
      ...cloneToolCall(toolCall),
    })),
  );
}

function makeRef(id: string, adapterId: string): ConversationRef {
  return {
    id,
    adapterId,
    sourcePath: `/tmp/${adapterId}/${id}.jsonl`,
  };
}

function makeBundle(
  id: string,
  adapterId: string,
  overrides: Partial<ParsedConversation> = {},
): ConversationBundle {
  const toolCall: ParsedToolCall = {
    id: `${id}-tool`,
    name: "tool",
    input: "{}",
    output: "{}",
    isError: false,
    durationMs: 10,
    timestamp: "2026-04-01T12:00:01.000Z",
  };

  return {
    conversation: {
      id,
      traceId: `${id}-trace`,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId,
      name: id,
      cwd: `/work/${adapterId}`,
      gitRemote: "https://github.com/acme/repo.git",
      branch: "main",
      model: "gpt-5",
      startedAt: "2026-04-01T12:00:00.000Z",
      endedAt: "2026-04-01T12:01:00.000Z",
      sourcePath: `/tmp/${adapterId}/${id}.jsonl`,
      sourceFormat: "jsonl",
      ...overrides,
    },
    messages: [
      {
        id: `${id}-message-1`,
        role: "user",
        content: `hello from ${id}`,
        recordType: "message",
        model: "gpt-5",
        sequence: 1,
        turn: 1,
        isSidechain: false,
        parentMessageId: "",
        inputTokens: 11,
        outputTokens: 7,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: "",
        thinkingTokens: 0,
        timestamp: "2026-04-01T12:00:00.000Z",
        toolUses: [toolCall],
      },
    ],
  };
}

function clonePayloads(payloads: PushPayload[]): PushPayload[] {
  return payloads.map((payload) => ({
    attemptedRevision: payload.attemptedRevision,
    conversation: { ...payload.conversation },
    messages: payload.messages.map((message) => ({ ...message })),
    toolCalls: payload.toolCalls.map((toolCall) => ({ ...toolCall })),
  }));
}

function cloneMessage(message: ParsedMessage): ParsedMessage {
  return {
    ...message,
    toolUses: message.toolUses.map((toolCall) => cloneToolCall(toolCall)),
  };
}

function cloneToolCall(toolCall: ParsedToolCall): ParsedToolCall {
  return { ...toolCall };
}

function computeDurationMs(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);

  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }

  return Math.max(0, ended - started);
}

function mb(value: number): number {
  return value * 1024 * 1024;
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(0);
  }

  throw new Error("Timed out waiting for condition");
}
