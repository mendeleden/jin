import { afterEach, describe, expect, test } from "bun:test";
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
import type {
  PipelineHandle,
  PipelineWatchEvent,
  PipelineWatcher,
  PipelineWatcherFactory,
} from "../src/pipeline";
import { runPipeline } from "../src/pipeline";

const NOOP_LOGGER = {
  info() {},
  warn() {},
  error() {},
};

const ROUTE_ALL_TO_PRIMARY: RouteConfig[] = [
  {
    match: {},
    sinks: ["primary"],
  },
];

afterEach(async () => {
  await Bun.sleep(0);
});

describe("pipeline spine", () => {
  test("serializes watcher-driven ingest for the same adapter", async () => {
    const store = new InMemoryConversationStore();
    const watcherHarness = new FakeWatcherHarness();
    const firstFindChanged = deferred<void>();
    const adapter = new TestAdapter("alpha", {
      async findChanged(_hint, callIndex) {
        if (callIndex === 1) {
          await firstFindChanged.promise;
          return [makeRef("alpha-1", "alpha")];
        }

        return [makeRef("alpha-2", "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const handle = await startPipeline({
      adapterSource: [adapter],
      store,
      sinks: [],
      routes: [],
      watcherFactory: watcherHarness.factory,
    });

    try {
      watcherHarness.current.emit("alpha", "/watch/alpha/one.jsonl");
      await waitFor(() => adapter.findChangedHints.length === 1);
      watcherHarness.current.emit("alpha", "/watch/alpha/two.jsonl");

      await Bun.sleep(0);
      expect(adapter.findChangedHints).toHaveLength(1);
      expect(adapter.maxConcurrentCalls).toBe(1);

      firstFindChanged.resolve();
      await handle.waitForIdle();

      expect(adapter.findChangedHints).toHaveLength(2);
      expect(adapter.maxConcurrentCalls).toBe(1);
      expect(adapter.loadConversationRefs).toEqual(["alpha-1", "alpha-2"]);
    } finally {
      await handle.shutdown();
    }
  });

  test("coalesces adjacent push work after changed ingests", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    const adapter = new TestAdapter("alpha", {
      async findChanged(_hint, callIndex) {
        return [makeRef(`alpha-${callIndex}`, "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const handle = await startPipeline({
      adapterSource: [adapter],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
    });

    try {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "fs-change", changedPaths: ["/watch/alpha/one.jsonl"] },
      });
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "fs-change", changedPaths: ["/watch/alpha/two.jsonl"] },
      });

      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(
        sink.pushCalls[0].map((payload) => payload.conversation.id),
      ).toEqual(["alpha-1", "alpha-2"]);
    } finally {
      await handle.shutdown();
    }
  });

  test("waitForIdle does not resolve before a directly handed-off work item finishes", async () => {
    const store = new InMemoryConversationStore();
    const firstFindChanged = deferred<void>();
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        await firstFindChanged.promise;
        return [makeRef("alpha-1", "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const handle = await startPipeline({
      adapterSource: [adapter],
      store,
      sinks: [],
      routes: [],
    });

    try {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "startup-scan" },
      });

      let idleResolved = false;
      const idlePromise = handle.waitForIdle().then(() => {
        idleResolved = true;
      });

      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(idleResolved).toBe(false);

      await waitFor(() => adapter.findChangedHints.length === 1);
      firstFindChanged.resolve();
      await idlePromise;

      expect(adapter.loadConversationRefs).toEqual(["alpha-1"]);
    } finally {
      await handle.shutdown();
    }
  });

  test("does not enqueue push work when ingest is unchanged", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        return [makeRef("alpha-stable", "alpha")];
      },
      async loadConversation() {
        return makeBundle("alpha-stable", "alpha");
      },
    });

    store.writeBundle(makeBundle("alpha-stable", "alpha"));

    const handle = await startPipeline({
      adapterSource: [adapter],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
    });

    try {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "fs-change", changedPaths: ["/watch/alpha/stable.jsonl"] },
      });

      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(0);
    } finally {
      await handle.shutdown();
    }
  });

  test("can defer watcher startup until the pipeline drains initial work", async () => {
    const store = new InMemoryConversationStore();
    const watcherHarness = new FakeWatcherHarness();
    const firstFindChanged = deferred<void>();
    const adapter = new TestAdapter("alpha", {
      async findChanged() {
        await firstFindChanged.promise;
        return [makeRef("alpha-1", "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const handle = await runPipeline({
      adapterSource: [adapter],
      store,
      sinks: [],
      routes: [],
      scheduleStartupWork: false,
      deferWatcherStart: true,
      scanIntervalMs: null,
      watcherFactory: watcherHarness.factory,
      logger: NOOP_LOGGER,
    });

    try {
      expect(watcherHarness.current.paths).toEqual([]);

      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "startup-scan" },
      });

      await waitFor(() => adapter.findChangedHints.length === 1);
      expect(watcherHarness.current.paths).toEqual([]);

      firstFindChanged.resolve();
      await handle.waitForIdle();

      expect(watcherHarness.current.paths).toEqual([
        { path: "/watch/alpha", adapterId: "alpha" },
      ]);
    } finally {
      await handle.shutdown();
    }
  });

  test("prioritizes config reload ahead of queued push work and uses refreshed routes", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    const firstFindChanged = deferred<void>();
    let routes: RouteConfig[] = [];
    const alpha = new TestAdapter("alpha", {
      async findChanged() {
        await firstFindChanged.promise;
        return [makeRef("alpha-1", "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });

    const handle = await startPipeline({
      adapterSource: [alpha],
      store,
      sinks: [sink],
      routes,
      getRoutes: () => routes,
      onConfigReload: async () => {
        routes = ROUTE_ALL_TO_PRIMARY;
      },
    });

    try {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: "alpha",
        hint: { kind: "startup-scan" },
      });

      await waitFor(() => alpha.findChangedHints.length === 1);
      handle.enqueue({ kind: "push" });
      handle.reloadConfig("command");

      firstFindChanged.resolve();
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(
        sink.pushCalls[0].map((payload) => payload.conversation.id),
      ).toEqual(["alpha-1"]);
    } finally {
      await handle.shutdown();
    }
  });

  test("config reload enqueues push so retargeted sinks receive existing backlog", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("secondary");
    let sinks: Sink[] = [];
    let routes: RouteConfig[] = [];
    store.writeBundle(makeBundle("alpha-1", "alpha"));
    store.writeBundle(makeBundle("alpha-2", "alpha"));

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks,
      routes,
      getSinks: () => sinks,
      getRoutes: () => routes,
      onConfigReload: async () => {
        sinks = [sink];
        routes = [{ match: {}, sinks: ["secondary"] }];
      },
    });

    try {
      handle.reloadConfig("command");
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(sink.pushCalls[0].map((payload) => payload.conversation.id)).toEqual([
        "alpha-1",
        "alpha-2",
      ]);
      expect(store.conversationsNeedingPush("secondary")).toEqual([]);
    } finally {
      await handle.shutdown();
    }
  });

  test("stops remaining local push batches when current config disables the sink", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    store.writeBundle(makeBundle("alpha-1", "alpha"));
    store.writeBundle(makeBundle("alpha-2", "alpha"));
    store.writeBundle(makeBundle("alpha-3", "alpha"));
    let deliveryChecks = 0;

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
      pushBatchSize: 1,
      getCurrentDeliverySnapshot: (sinkId) => {
        expect(sinkId).toBe("primary");
        deliveryChecks += 1;
        const enabled = deliveryChecks <= 2;
        return {
          generationToken: enabled ? "enabled" : "disabled",
          sinks: [{ id: "primary", enabled }],
          routes: ROUTE_ALL_TO_PRIMARY,
        };
      },
    });

    try {
      handle.enqueue({ kind: "push" });
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(sink.pushCalls[0].map((payload) => payload.conversation.id)).toEqual([
        "alpha-1",
      ]);
      expect(store.conversationsNeedingPush("primary")).toEqual([
        "alpha-2",
        "alpha-3",
      ]);
      expect(deliveryChecks).toBeGreaterThanOrEqual(3);
    } finally {
      await handle.shutdown();
    }
  });

  test("stops remaining local push batches when current routes no longer target the sink", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    let deliveryChecks = 0;
    store.writeBundle(makeBundle("alpha-1", "alpha"));
    store.writeBundle(makeBundle("alpha-2", "alpha"));
    store.writeBundle(makeBundle("alpha-3", "alpha"));

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
      pushBatchSize: 1,
      getCurrentDeliverySnapshot: () => {
        deliveryChecks += 1;
        const routes = deliveryChecks <= 2 ? ROUTE_ALL_TO_PRIMARY : [];
        return {
          generationToken: routes.length > 0 ? "routed" : "unrouted",
          sinks: [{ id: "primary", enabled: true }],
          routes,
        };
      },
    });

    try {
      handle.enqueue({ kind: "push" });
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(sink.pushCalls[0].map((payload) => payload.conversation.id)).toEqual([
        "alpha-1",
      ]);
      expect(store.conversationsNeedingPush("primary")).toEqual([
        "alpha-2",
        "alpha-3",
      ]);
      expect(deliveryChecks).toBeGreaterThanOrEqual(3);
    } finally {
      await handle.shutdown();
    }
  });

  test("stops remaining local push batches when current config removes the sink", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    let deliveryChecks = 0;
    store.writeBundle(makeBundle("alpha-1", "alpha"));
    store.writeBundle(makeBundle("alpha-2", "alpha"));

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
      pushBatchSize: 1,
      getCurrentDeliverySnapshot: () => {
        deliveryChecks += 1;
        const sinkPresent = deliveryChecks <= 2;
        return {
          generationToken: sinkPresent ? "present" : "removed",
          sinks: sinkPresent ? [{ id: "primary", enabled: true }] : [],
          routes: ROUTE_ALL_TO_PRIMARY,
        };
      },
    });

    try {
      handle.enqueue({ kind: "push" });
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(sink.pushCalls[0].map((payload) => payload.conversation.id)).toEqual([
        "alpha-1",
      ]);
      expect(store.conversationsNeedingPush("primary")).toEqual(["alpha-2"]);
      expect(deliveryChecks).toBeGreaterThanOrEqual(3);
    } finally {
      await handle.shutdown();
    }
  });

  test("does not record push success when config changes during an in-flight batch", async () => {
    const store = new InMemoryConversationStore();
    const pushStarted = deferred<void>();
    const finishPush = deferred<void>();
    const sink = new TestSink("primary");
    let generationToken = "before";
    store.writeBundle(makeBundle("alpha-1", "alpha"));

    sink.pushImpl = async (payloads) => {
      pushStarted.resolve();
      await finishPush.promise;
      return {
        pushed: payloads.length,
        failed: 0,
        errors: [],
      };
    };

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
      getCurrentDeliverySnapshot: () => ({
        generationToken,
        sinks: [{ id: "primary", enabled: true }],
        routes: ROUTE_ALL_TO_PRIMARY,
      }),
    });

    try {
      handle.enqueue({ kind: "push" });
      await pushStarted.promise;
      generationToken = "after";
      finishPush.resolve();
      await handle.waitForIdle();

      expect(sink.pushCalls).toHaveLength(1);
      expect(store.conversationsNeedingPush("primary")).toEqual(["alpha-1"]);
    } finally {
      await handle.shutdown();
    }
  });

  test("fatal config reload stops without shutdown flushing stale sink routes", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    store.writeBundle(makeBundle("alpha-1", "alpha"));
    const reloadStarted = deferred<void>();
    const finishReload = deferred<void>();
    const reloadCompleted = deferred<void>();

    const handle = await startPipeline({
      adapterSource: [],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
      onConfigReload: async () => {
        reloadStarted.resolve();
        await finishReload.promise;
        reloadCompleted.resolve();
        return false;
      },
    });

    handle.reloadConfig("command");
    await reloadStarted.promise;
    handle.enqueue({ kind: "push" });
    finishReload.resolve();
    await reloadCompleted.promise;

    const result = await handle.shutdown();

    expect(result.timedOut).toBe(false);
    expect(sink.pushCalls).toHaveLength(0);
    expect(store.conversationsNeedingPush("primary")).toEqual(["alpha-1"]);
  });

  test("shutdown skips queued normal work and performs one bounded final flush", async () => {
    const store = new InMemoryConversationStore();
    const sink = new TestSink("primary");
    const alphaFirstScan = deferred<void>();

    const alpha = new TestAdapter("alpha", {
      async findChanged(_hint, callIndex) {
        if (callIndex === 1) {
          await alphaFirstScan.promise;
        }
        return [makeRef("alpha-final", "alpha")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "alpha");
      },
    });
    const beta = new TestAdapter("beta", {
      async findChanged() {
        return [makeRef("beta-final", "beta")];
      },
      async loadConversation(ref) {
        return makeBundle(ref.id, "beta");
      },
    });

    const handle = await startPipeline({
      adapterSource: [alpha, beta],
      store,
      sinks: [sink],
      routes: ROUTE_ALL_TO_PRIMARY,
    });

    handle.enqueue({
      kind: "ingest-adapter",
      adapterId: "alpha",
      hint: { kind: "fs-change", changedPaths: ["/watch/alpha/one.jsonl"] },
    });
    handle.enqueue({
      kind: "ingest-adapter",
      adapterId: "beta",
      hint: { kind: "fs-change", changedPaths: ["/watch/beta/one.jsonl"] },
    });

    await waitFor(() => alpha.findChangedHints.length === 1);
    const shutdownPromise = handle.shutdown();
    alphaFirstScan.resolve();

    const result = await shutdownPromise;

    expect(result.timedOut).toBe(false);
    expect(result.abandonedWorkItems).toBeGreaterThanOrEqual(1);
    expect(alpha.findChangedHints).toHaveLength(2);
    expect(beta.findChangedHints).toHaveLength(1);
    expect(sink.pushCalls).toHaveLength(1);
    expect(
      sink.pushCalls[0].map((payload) => payload.conversation.id),
    ).toEqual(["alpha-final", "beta-final"]);
    expect(sink.closeCalls).toBe(1);
  });
});

async function startPipeline(
  options: Omit<
    Parameters<typeof runPipeline>[0],
    "scheduleStartupWork" | "scanIntervalMs" | "logger"
  >,
): Promise<PipelineHandle> {
  return runPipeline({
    ...options,
    scheduleStartupWork: false,
    scanIntervalMs: null,
    logger: NOOP_LOGGER,
  });
}

class TestAdapter implements Adapter {
  readonly name: string;
  readonly findChangedHints: Array<ChangeHint | undefined> = [];
  readonly loadConversationRefs: string[] = [];
  maxConcurrentCalls = 0;
  private inFlightCalls = 0;
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
    return this.trackConcurrency(() =>
      this.behavior.findChanged(hint, callIndex),
    );
  }

  async loadConversation(
    ref: ConversationRef,
  ): Promise<ConversationBundle | null> {
    const callIndex = this.loadConversationRefs.length + 1;
    this.loadConversationRefs.push(ref.id);
    return this.trackConcurrency(() =>
      this.behavior.loadConversation(ref, callIndex),
    );
  }

  watchPaths(): string[] {
    return this.behavior.watchPaths ?? [`/watch/${this.id}`];
  }

  private async trackConcurrency<T>(work: () => Promise<T>): Promise<T> {
    this.inFlightCalls += 1;
    this.maxConcurrentCalls = Math.max(
      this.maxConcurrentCalls,
      this.inFlightCalls,
    );

    try {
      return await work();
    } finally {
      this.inFlightCalls -= 1;
    }
  }
}

class TestSink implements Sink {
  readonly name: string;
  readonly pushCalls: PushPayload[][] = [];
  closeCalls = 0;
  pushImpl?: (payloads: PushPayload[]) => Promise<PushResult>;

  constructor(readonly id: string) {
    this.name = id;
  }

  async push(payloads: PushPayload[]): Promise<PushResult> {
    this.pushCalls.push(clonePayloads(payloads));
    const result = this.pushImpl
      ? await this.pushImpl(payloads)
      : {
          pushed: payloads.length,
          failed: 0,
          errors: [],
        };
    return result;
  }

  async healthCheck() {
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeWatcherHarness {
  private readonly watchers: FakeWatcher[] = [];

  readonly factory: PipelineWatcherFactory = ({ onChange }) => {
    const watcher = new FakeWatcher(onChange);
    this.watchers.push(watcher);
    return watcher;
  };

  get current(): FakeWatcher {
    const watcher = this.watchers.at(-1);
    if (!watcher) {
      throw new Error("No watcher was created");
    }
    return watcher;
  }
}

class FakeWatcher implements PipelineWatcher {
  readonly paths: Array<{ path: string; adapterId: string }> = [];
  closed = false;
  private readonly onChange: (event: PipelineWatchEvent) => void;

  constructor(onChange: (event: PipelineWatchEvent) => void) {
    this.onChange = onChange;
  }

  addPath(path: string, adapterId: string): void {
    this.paths.push({ path, adapterId });
  }

  emit(adapterId: string, path: string): void {
    this.onChange({ adapterId, path });
  }

  close(): void {
    this.closed = true;
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
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
