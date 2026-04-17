import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
} from "../src/contracts/conversations";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { computeBundleHash } from "../src/db/bundle";
import { ingestConversationViaWorker } from "../src/pipeline/ingest-worker";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("canonical store write session", () => {
  test("matches writeBundle persistence for changed bundles", () => {
    const canonical = createStoreEnv("canonical");
    const sessionEnv = createStoreEnv("session");
    const bundle = makeBundle("session-conv", {
      messages: [
        makeMessage("msg-2", {
          sequence: 2,
          content: "beta replacement token",
          toolUses: [
            makeToolCall("tool-b"),
            makeToolCall("tool-a"),
          ],
        }),
        makeMessage("msg-1", {
          sequence: 1,
          content: "alpha search token",
          turn: 1,
        }),
      ],
    });

    expect(canonical.store.writeBundle(bundle)).toEqual({
      changed: true,
      revision: 1,
    });

    const session = sessionEnv.store.beginWrite(bundle.conversation);
    for (const message of bundle.messages) {
      session.appendMessage(message);
    }
    expect(readStageCounts(sessionEnv.store, bundle.conversation.id)).toEqual({
      sessionCount: 1,
      messageCount: 2,
      toolCallCount: 2,
      stagedBytes: expect.any(Number),
    });

    expect(session.finish(computeBundleHash(bundle))).toEqual({
      changed: true,
      revision: 1,
    });
    expect(readStageCounts(sessionEnv.store, bundle.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });

    expect(sessionEnv.store.getConversation(bundle.conversation.id)).toEqual(
      canonical.store.getConversation(bundle.conversation.id),
    );
    expect(sessionEnv.store.getMessages(bundle.conversation.id)).toEqual(
      canonical.store.getMessages(bundle.conversation.id),
    );
    expect(sessionEnv.store.getToolCalls(bundle.conversation.id)).toEqual(
      canonical.store.getToolCalls(bundle.conversation.id),
    );
    expect(
      sessionEnv.store
        .searchMessages({ query: "alpha" })
        .map((row) => row.messageId),
    ).toEqual(
      canonical.store
        .searchMessages({ query: "alpha" })
        .map((row) => row.messageId),
    );
  });

  test("keeps revision stable for unchanged session writes and bumps on change", () => {
    const { store } = createStoreEnv("revisions");
    const original = makeBundle("rev-session");

    const firstSession = store.beginWrite(original.conversation);
    for (const message of original.messages) {
      firstSession.appendMessage(message);
    }
    expect(firstSession.finish(computeBundleHash(original))).toEqual({
      changed: true,
      revision: 1,
    });

    const before = readIngestedAt(store, original.conversation.id);
    Bun.sleepSync(5);

    const unchangedSession = store.beginWrite(original.conversation);
    expect(readStageCounts(store, original.conversation.id)).toEqual({
      sessionCount: 1,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: expect.any(Number),
    });
    expect(unchangedSession.finish(computeBundleHash(original))).toEqual({
      changed: false,
      revision: 1,
    });
    expect(readStageCounts(store, original.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });
    expect(readIngestedAt(store, original.conversation.id) > before).toBe(true);

    const changed = makeBundle("rev-session", {
      messages: [
        {
          ...original.messages[0],
          content: "changed content",
        },
      ],
    });
    const changedSession = store.beginWrite(changed.conversation);
    for (const message of changed.messages) {
      changedSession.appendMessage(message);
    }
    expect(changedSession.finish(computeBundleHash(changed))).toEqual({
      changed: true,
      revision: 2,
    });
    expect(store.getRevision(changed.conversation.id)).toBe(2);
  });

  test("aborts partial session writes without leaving rows behind", () => {
    const { store } = createStoreEnv("abort");
    const bundle = makeBundle("abort-conv", {
      messages: [
        makeMessage("abort-1"),
        makeMessage("abort-2", { sequence: 2 }),
      ],
    });

    const session = store.beginWrite(bundle.conversation);
    session.appendMessage(bundle.messages[0]!);
    expect(readStageCounts(store, bundle.conversation.id)).toEqual({
      sessionCount: 1,
      messageCount: 1,
      toolCallCount: 0,
      stagedBytes: expect.any(Number),
    });
    session.abort();

    expect(store.getConversation(bundle.conversation.id)).toBeNull();
    expect(store.getMessages(bundle.conversation.id)).toEqual([]);
    expect(store.getToolCalls(bundle.conversation.id)).toEqual([]);
    expect(store.getRevision(bundle.conversation.id)).toBe(0);
    expect(readStageCounts(store, bundle.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });
  });

  test("overlapping sessions do not delete the first session's staged rows", () => {
    const { store } = createStoreEnv("overlap");
    const bundle = makeBundle("overlap-conv", {
      messages: [
        makeMessage("overlap-2", { sequence: 2, content: "second" }),
        makeMessage("overlap-1", { sequence: 1, content: "first" }),
      ],
    });

    const first = store.beginWrite(bundle.conversation);
    for (const message of bundle.messages) {
      first.appendMessage(message);
    }

    const second = store.beginWrite(bundle.conversation);

    expect(first.finish(computeBundleHash(bundle))).toEqual({
      changed: true,
      revision: 1,
    });
    second.abort();

    expect(store.getMessages(bundle.conversation.id).map((message) => message.id)).toEqual([
      "overlap-1",
      "overlap-2",
    ]);
    expect(readStageCounts(store, bundle.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });
  });

  test("stale overlapping sessions do not overwrite newer committed content", () => {
    const { store } = createStoreEnv("stale-overlap");
    const original = makeBundle("stale-overlap-conv", {
      messages: [makeMessage("stale-msg", { content: "original", sequence: 1 })],
    });
    const newer = makeBundle("stale-overlap-conv", {
      messages: [makeMessage("stale-msg", { content: "newer", sequence: 1 })],
    });

    const staleSession = store.beginWrite(original.conversation);
    staleSession.appendMessage(original.messages[0]!);

    const newerSession = store.beginWrite(newer.conversation);
    newerSession.appendMessage(newer.messages[0]!);

    expect(newerSession.finish(computeBundleHash(newer))).toEqual({
      changed: true,
      revision: 1,
    });
    expect(staleSession.finish(computeBundleHash(original))).toEqual({
      changed: false,
      revision: 1,
    });

    expect(
      store.getMessages(original.conversation.id).map((message) => ({
        id: message.id,
        content: message.content,
        sequence: message.sequence,
      })),
    ).toEqual(
      newer.messages.map((message) => ({
        id: message.id,
        content: message.content,
        sequence: message.sequence,
      })),
    );
    expect(store.getRevision(original.conversation.id)).toBe(1);
    expect(readStageCounts(store, original.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });
  });
});

describe("worker ingest write session", () => {
  test("routes worker frames through the store-owned write session", async () => {
    const { store } = createStoreEnv("worker");
    const bundle = makeBundle("worker-conv", {
      messages: [
        makeMessage("worker-2", {
          sequence: 2,
          content: "second message",
          toolUses: [makeToolCall("worker-tool-b")],
        }),
        makeMessage("worker-1", {
          sequence: 1,
          content: "first message",
          toolUses: [makeToolCall("worker-tool-a")],
        }),
      ],
    });

    const bundleHash = computeBundleHash(bundle);
    const workerScript = `
const bundle = ${JSON.stringify(bundle)};
const bundleHash = ${JSON.stringify(bundleHash)};
const VERSION = "2.0";
const INIT = "initialize";
const LOAD = "jin.ingest.loadConversation";
const STARTED = "jin.worker.started";
const SAMPLE = "jin.worker.sample";
const CONVERSATION = "jin.ingest.conversation";
const MESSAGE = "jin.ingest.message";

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}

function parseEnvelope(buffer) {
  const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
  if (headerEnd < 0) return null;
  const header = buffer.slice(0, headerEnd);
  const match = header.match(/Content-Length:\\s*(\\d+)/i);
  if (!match) throw new Error("missing Content-Length");
  const length = Number(match[1]);
  const total = headerEnd + 4 + length;
  if (Buffer.byteLength(buffer, "utf8") < total) return null;
  const body = buffer.slice(headerEnd + 4, total);
  return { message: JSON.parse(body), rest: buffer.slice(total) };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const parsed = parseEnvelope(buffer);
    if (!parsed) break;
    buffer = parsed.rest;
    const message = parsed.message;
    if (message.method === INIT) {
      send({
        jsonrpc: VERSION,
        id: message.id,
        result: { protocolVersion: 1, methods: [LOAD], notifications: [STARTED, SAMPLE, CONVERSATION, MESSAGE] },
      });
      continue;
    }
    if (message.method === LOAD) {
      send({
        jsonrpc: VERSION,
        method: STARTED,
        params: {
          adapterId: bundle.conversation.adapterId,
          refId: bundle.conversation.id,
          sourcePath: bundle.conversation.sourcePath,
          pid: 4242,
        },
      });
      send({
        jsonrpc: VERSION,
        method: CONVERSATION,
        params: {
          adapterId: bundle.conversation.adapterId,
          refId: bundle.conversation.id,
          conversation: bundle.conversation,
        },
      });
      for (const msg of bundle.messages) {
        send({
          jsonrpc: VERSION,
          method: MESSAGE,
          params: {
            adapterId: bundle.conversation.adapterId,
            refId: bundle.conversation.id,
            message: msg,
          },
        });
      }
      send({
        jsonrpc: VERSION,
        id: message.id,
        result: { kind: "loaded", bundleHash, messageCount: bundle.messages.length },
      });
    }
  }
});
`;
    const result = await ingestConversationViaWorker(
      [process.execPath, "-e", workerScript],
      store,
      {
        ref: {
          id: bundle.conversation.id,
          adapterId: bundle.conversation.adapterId,
          sourcePath: bundle.conversation.sourcePath,
        },
        adapter: {
          adapterId: bundle.conversation.adapterId,
          adapterConfig: {
            enabled: true,
          },
        },
      },
    );

    expect(result).toEqual({
      kind: "loaded",
      conversationId: bundle.conversation.id,
      changed: true,
      revision: 1,
    });
    expect(store.getMessages(bundle.conversation.id).map((message) => message.id)).toEqual([
      "worker-1",
      "worker-2",
    ]);
    expect(store.getToolCalls(bundle.conversation.id).map((toolCall) => toolCall.id)).toEqual([
      "worker-tool-a",
      "worker-tool-b",
    ]);
    expect(readStageCounts(store, bundle.conversation.id)).toEqual({
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      stagedBytes: 0,
    });
  });

  test("rejects direct __worker invocation without JSON-RPC traffic", async () => {
    const entryPath = join(process.cwd(), "src", "index.ts");
    const subprocess = Bun.spawn({
      cmd: [process.execPath, entryPath, "__worker"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    subprocess.stdin.end();

    const stderrPromise = readStreamText(subprocess.stderr);
    const stdoutPromise = readStreamText(subprocess.stdout);
    const exitCode = await subprocess.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("jin __worker is an internal JSON-RPC command");
  });

  test("kills malformed workers that fail before loadConversation starts", async () => {
    const { store } = createStoreEnv("worker-protocol-fail");
    const pidFile = join(tmpdir(), `jin-worker-pid-${crypto.randomUUID()}.txt`);
    cleanups.push(() => {
      rmSync(pidFile, { force: true });
    });

    const workerScript = `
const fs = require("fs");
const pidFile = ${JSON.stringify(pidFile)};
fs.writeFileSync(pidFile, String(process.pid));
const VERSION = "2.0";
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
  if (headerEnd < 0) return;
  const body = buffer.slice(headerEnd + 4);
  try {
    const parsed = JSON.parse(body);
    send({
      jsonrpc: VERSION,
      id: parsed.id,
      result: { protocolVersion: 999, methods: [], notifications: [] },
    });
  } catch {}
});
setInterval(() => {}, 1000);
`;

    await expect(
      ingestConversationViaWorker(
        [process.execPath, "-e", workerScript],
        store,
        {
          ref: {
            id: "broken-worker",
            adapterId: "codex",
            sourcePath: "/tmp/broken-worker.jsonl",
          },
          adapter: {
            adapterId: "codex",
            adapterConfig: { enabled: true },
          },
        },
      ),
    ).rejects.toThrow("worker initialize handshake failed");

    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    expect(Number.isFinite(pid)).toBe(true);
    await Bun.sleep(50);
    expect(isPidAlive(pid)).toBe(false);
  });
});

function createStoreEnv(name: string): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), `jin-write-session-${name}-`));
  const store = openStoreAtPath(join(dir, "store.db"));
  cleanups.push(() => {
    try {
      store.close();
    } catch {
      // Best effort cleanup.
    }

    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}

function readIngestedAt(store: SqliteConversationStore, conversationId: string): string {
  const row = store.database
    .prepare(
      `SELECT ingested_at
       FROM _jin_sync
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as { ingested_at: string };

  return row.ingested_at;
}

function readStageCounts(
  store: SqliteConversationStore,
  conversationId: string,
): {
  sessionCount: number;
  messageCount: number;
  toolCallCount: number;
  stagedBytes: number;
} {
  const sessionRow = store.database
    .prepare(
      `SELECT
         COUNT(*) AS session_count,
         COALESCE(SUM(staged_bytes), 0) AS staged_bytes
       FROM _jin_stage_sessions
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as {
    session_count: number;
    staged_bytes: number;
  };
  const messageRow = store.database
    .prepare(
      `SELECT COUNT(*) AS message_count
       FROM _jin_stage_messages
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as { message_count: number };
  const toolCallRow = store.database
    .prepare(
      `SELECT COUNT(*) AS tool_call_count
       FROM _jin_stage_tool_calls
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as { tool_call_count: number };

  return {
    sessionCount: sessionRow.session_count,
    messageCount: messageRow.message_count,
    toolCallCount: toolCallRow.tool_call_count,
    stagedBytes: sessionRow.staged_bytes,
  };
}

async function readStreamText(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeBundle(
  id: string,
  overrides: {
    conversation?: Partial<ParsedConversation>;
    messages?: ParsedMessage[];
  } = {},
): ConversationBundle {
  const conversation: ParsedConversation = {
    id,
    traceId: id,
    parentId: "",
    relationship: "root",
    forkPoint: -1,
    adapterId: "test-adapter",
    name: `Conversation ${id}`,
    cwd: "/tmp/project",
    gitRemote: "git@github.com:acme/test.git",
    branch: "main",
    model: "claude-sonnet-4-20250514",
    startedAt: "2026-04-01T10:00:00.000Z",
    endedAt: "2026-04-01T10:05:00.000Z",
    sourcePath: `/tmp/${id}.jsonl`,
    sourceFormat: "jsonl",
    ...overrides.conversation,
  };

  return {
    conversation,
    messages:
      overrides.messages ??
      [
        makeMessage(`${id}-m-1`, {
          content: `Message for ${id}`,
          sequence: 1,
          toolUses: [makeToolCall(`${id}-tool`)],
        }),
      ],
  };
}

function makeMessage(
  id: string,
  overrides: Partial<ParsedMessage> = {},
): ParsedMessage {
  return {
    id,
    role: overrides.role ?? "assistant",
    content: overrides.content ?? `Content for ${id}`,
    recordType: overrides.recordType ?? "assistant",
    model: overrides.model ?? "claude-sonnet-4-20250514",
    sequence: overrides.sequence ?? 1,
    turn: overrides.turn ?? 1,
    isSidechain: overrides.isSidechain ?? false,
    parentMessageId: overrides.parentMessageId ?? "",
    inputTokens: overrides.inputTokens ?? 10,
    outputTokens: overrides.outputTokens ?? 20,
    cacheRead: overrides.cacheRead ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
    thinkingContent: overrides.thinkingContent ?? "",
    thinkingTokens: overrides.thinkingTokens ?? 0,
    timestamp: overrides.timestamp ?? "2026-04-01T10:01:00.000Z",
    toolUses: overrides.toolUses ?? [],
  };
}

function makeToolCall(
  id: string,
  overrides: Partial<ParsedToolCall> = {},
): ParsedToolCall {
  return {
    id,
    name: overrides.name ?? "shell",
    input: overrides.input ?? "echo hello",
    output: overrides.output ?? "hello",
    isError: overrides.isError ?? false,
    durationMs: overrides.durationMs ?? 12,
    timestamp: overrides.timestamp ?? "2026-04-01T10:01:01.000Z",
  };
}
