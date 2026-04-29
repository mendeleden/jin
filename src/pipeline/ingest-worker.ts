import { heapStats } from "bun:jsc";
import {
  isDiscoveryCacheCapableAdapter,
  type DiscoveryCacheState,
} from "../adapters/discovery-cache";
import { createAdapter } from "../adapters/registry";
import type { AdapterConfig } from "../config";
import type { Adapter as V2Adapter } from "../contracts/adapters";
import type { ChangeHint } from "../contracts/adapters";
import type {
  ConversationBundle,
  ConversationRef,
  ParsedConversation,
  ParsedMessage,
} from "../contracts/conversations";
import type {
  ConversationStore,
  ConversationWriteSession,
} from "../contracts/store";
import { computeBundleHash } from "../db/bundle";
import { orderedMessages } from "../db/ordering";
import { abortConversationWriteSession } from "../db/write-session";

const MB = 1024 * 1024;
const JSON_RPC_VERSION = "2.0";
const INITIALIZE_METHOD = "initialize";
const FIND_CHANGED_METHOD = "jin.ingest.findChanged";
const LOAD_CONVERSATION_METHOD = "jin.ingest.loadConversation";
const WORKER_STARTED_METHOD = "jin.worker.started";
const WORKER_SAMPLE_METHOD = "jin.worker.sample";
const INGEST_CONVERSATION_METHOD = "jin.ingest.conversation";
const INGEST_MESSAGE_METHOD = "jin.ingest.message";
const INGEST_MISSING_METHOD = "jin.ingest.missing";
const WORKER_PROTOCOL_HANDSHAKE_TIMEOUT_MS = 1000;
let lastProcessCpuUsage = process.cpuUsage();
let lastProcessCpuAtNs = process.hrtime.bigint();

type JsonRpcId = number;

type JsonRpcRequest = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcSuccessResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcErrorResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
};

type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

export type WorkerAdapterSnapshot = {
  adapterId: string;
  adapterConfig: AdapterConfig;
};

export type WorkerLoadConversationRequest = {
  ref: ConversationRef;
  adapter: WorkerAdapterSnapshot;
};

export type WorkerFindChangedRequest = {
  hint?: ChangeHint;
  adapter: WorkerAdapterSnapshot;
  discoveryState?: DiscoveryCacheState | null;
};

type WorkerFindChangedResult = {
  refs: ConversationRef[];
  discoveryState: DiscoveryCacheState | null;
};

type WorkerLoadConversationResult =
  | {
      kind: "missing";
    }
  | {
      kind: "loaded";
      bundleHash: string;
      messageCount: number;
    };

type WorkerStartedNotification = {
  adapterId: string;
  refId: string;
  sourcePath: string;
  pid: number;
};

type WorkerSampleNotification = {
  adapterId: string;
  refId?: string;
  phase: string;
  pid: number;
  rssMb: number;
  cpuPct: number;
  jscHeapMb: number;
  externalMb: number;
};

type ConversationNotification = {
  adapterId: string;
  refId: string;
  conversation: ParsedConversation;
};

type MessageNotification = {
  adapterId: string;
  refId: string;
  message: ParsedMessage;
};

type MissingNotification = {
  adapterId: string;
  refId: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export async function runWorkerServerCommand(): Promise<void> {
  let sawRequest = false;
  let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  const directInvocationError = () =>
    new Error(
      "jin __worker is an internal JSON-RPC command and requires a parent stdio transport",
    );

  const handshakeGuard = new Promise<void>((resolve, reject) => {
    if (process.stdin.isTTY || process.stdout.isTTY) {
      reject(directInvocationError());
      return;
    }

    handshakeTimeout = setTimeout(() => {
      if (!sawRequest) {
        reject(directInvocationError());
        return;
      }
      resolve();
    }, WORKER_PROTOCOL_HANDSHAKE_TIMEOUT_MS);
  });

  const readLoop = readJsonRpcMessages(Bun.stdin.stream(), async (message) => {
    if (!isJsonRpcRequest(message)) {
      return;
    }

    sawRequest = true;

    try {
      switch (message.method) {
        case INITIALIZE_METHOD:
          writeJsonRpcMessage(process.stdout, {
            jsonrpc: JSON_RPC_VERSION,
            id: message.id,
            result: {
              protocolVersion: 1,
              methods: [FIND_CHANGED_METHOD, LOAD_CONVERSATION_METHOD],
              notifications: [
                WORKER_STARTED_METHOD,
                WORKER_SAMPLE_METHOD,
                INGEST_CONVERSATION_METHOD,
                INGEST_MESSAGE_METHOD,
                INGEST_MISSING_METHOD,
              ],
            },
          });
          return;
        case FIND_CHANGED_METHOD: {
          const params = parseFindChangedParams(message.params);
          const result = await findChangedAndSnapshot(params);
          writeJsonRpcMessage(process.stdout, {
            jsonrpc: JSON_RPC_VERSION,
            id: message.id,
            result,
          });
          return;
        }
        case LOAD_CONVERSATION_METHOD: {
          const params = parseLoadConversationParams(message.params);
          const result = await loadConversationAndNotify(params);
          writeJsonRpcMessage(process.stdout, {
            jsonrpc: JSON_RPC_VERSION,
            id: message.id,
            result,
          });
          return;
        }
        default:
          writeJsonRpcMessage(process.stdout, {
            jsonrpc: JSON_RPC_VERSION,
            id: message.id,
            error: {
              code: -32601,
              message: `Method not found: ${message.method}`,
            },
          });
      }
    } catch (error) {
      writeJsonRpcMessage(process.stdout, {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  try {
    await Promise.race([readLoop, handshakeGuard]);
    await readLoop;
  } finally {
    if (handshakeTimeout !== null) {
      clearTimeout(handshakeTimeout);
    }
  }

  if (!sawRequest) {
    throw directInvocationError();
  }
}

export async function ingestConversationViaWorker(
  workerCommand: string[],
  store: ConversationStore,
  request: WorkerLoadConversationRequest,
  options: {
    timeoutMs?: number;
    onWorkerEvent?: (
      phase: "start" | "sample" | "end" | "fail",
      fields: Record<string, unknown>,
    ) => void | Promise<void>;
  } = {},
): Promise<
  | { kind: "missing" }
  | {
      kind: "loaded";
      conversationId: string;
      changed: boolean;
      revision: number;
    }
> {
  const { ref } = request;
  const subprocess = Bun.spawn({
    cmd: [...workerCommand, "__worker"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrPromise = readStreamText(subprocess.stderr);
  let session: ConversationWriteSession | null = null;
  let conversationId = ref.id;
  let timedOut = false;
  let failNotified = false;
  let nextRequestId = 1;
  const pending = new Map<JsonRpcId, PendingRequest>();
  let streamedMessageCount = 0;

  const readLoop = readJsonRpcMessages(subprocess.stdout, async (message) => {
    if (isJsonRpcResponse(message)) {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if ("error" in message) {
        entry.reject(
          new Error(
            `worker rpc error ${message.error.code}: ${message.error.message}`,
          ),
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (!isJsonRpcNotification(message)) {
      return;
    }

    switch (message.method) {
      case WORKER_STARTED_METHOD: {
        const params = message.params as WorkerStartedNotification;
        await options.onWorkerEvent?.("start", {
          adapterId: params.adapterId,
          refId: params.refId,
          sourcePath: params.sourcePath,
          childPid: params.pid,
        });
        return;
      }
      case WORKER_SAMPLE_METHOD: {
        const params = message.params as WorkerSampleNotification;
        const parentRssMb = Math.round(process.memoryUsage().rss / MB);
        const parentCpuPct = sampleProcessCpuPct();
        await options.onWorkerEvent?.("sample", {
          adapterId: params.adapterId,
          ...(params.refId ? { refId: params.refId } : {}),
          phase: params.phase,
          childPid: params.pid,
          childRssMb: params.rssMb,
          childCpuPct: params.cpuPct,
          childJscHeapMb: params.jscHeapMb,
          childExternalMb: params.externalMb,
          combinedRssMb: parentRssMb + params.rssMb,
          combinedCpuPct: Math.round((parentCpuPct + params.cpuPct) * 10) / 10,
        });
        return;
      }
      case INGEST_CONVERSATION_METHOD: {
        const params = message.params as ConversationNotification;
        assertNotificationMatchesRef(params.adapterId, params.refId, ref);
        if (session) {
          throw new Error(
            `worker conversation notification arrived twice for ${ref.id}`,
          );
        }
        session = store.beginWrite(params.conversation);
        conversationId = params.conversation.id;
        return;
      }
      case INGEST_MESSAGE_METHOD: {
        const params = message.params as MessageNotification;
        assertNotificationMatchesRef(params.adapterId, params.refId, ref);
        if (!session) {
          throw new Error(
            `worker message arrived before conversation start for ${ref.id}`,
          );
        }
        session.appendMessage(params.message);
        streamedMessageCount += 1;
        return;
      }
      case INGEST_MISSING_METHOD: {
        const params = message.params as MissingNotification;
        assertNotificationMatchesRef(params.adapterId, params.refId, ref);
        if (session) {
          throw new Error(
            `worker missing notification arrived after conversation start for ${ref.id}`,
          );
        }
        return;
      }
    }
  }).finally(() => {
    if (pending.size === 0) {
      return;
    }

    const error = new Error("worker stream ended before pending responses arrived");
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  });

  const sendRequest = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextRequestId;
    nextRequestId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    writeJsonRpcMessage(subprocess.stdin, {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    });
    return promise;
  };

  const work = (async () => {
    const initializeResult = await sendRequest(INITIALIZE_METHOD, {
      client: "jin",
      protocolVersion: 1,
    });
    assertInitializeResult(initializeResult, [LOAD_CONVERSATION_METHOD]);

    const loadPromise = sendRequest(LOAD_CONVERSATION_METHOD, request);
    subprocess.stdin.end();

    const result = parseLoadConversationResult(await loadPromise);
    const exitCode = await subprocess.exited;
    await readLoop;

    const stderr = (await stderrPromise).trim();
    if (exitCode !== 0) {
      abortSession(session, ref);
      if (!timedOut) {
        failNotified = true;
        await options.onWorkerEvent?.("fail", {
          adapterId: ref.adapterId,
          refId: ref.id,
          exitCode,
          stderr,
        });
      }
      throw new Error(
        `worker exited with code ${exitCode}${
          stderr ? `: ${stderr.slice(0, 400)}` : ""
        }`,
      );
    }

    if (result.kind === "missing") {
      await options.onWorkerEvent?.("end", {
        adapterId: ref.adapterId,
        refId: ref.id,
        kind: "missing",
      });
      return { kind: "missing" } as const;
    }

    if (!session) {
      throw new Error(
        `worker returned loaded result without conversation notification for ${ref.id}`,
      );
    }
    const activeSession = session as ConversationWriteSession;

    if (result.messageCount !== streamedMessageCount) {
      throw new Error(
        `worker streamed ${streamedMessageCount} messages but reported ${result.messageCount} for ${ref.id}`,
      );
    }

    const write = activeSession.finish(result.bundleHash);
    session = null;
    await options.onWorkerEvent?.("end", {
      adapterId: ref.adapterId,
      refId: ref.id,
      kind: "loaded",
      changed: write.changed,
      revision: write.revision,
    });
    return {
      kind: "loaded" as const,
      conversationId,
      changed: write.changed,
      revision: write.revision,
    };
  })();

  const timeoutMs = options.timeoutMs ?? 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout =
    timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(async () => {
            timedOut = true;
            try {
              subprocess.kill();
            } catch {
              // Best-effort kill for timed-out workers.
            }
            const stderr = (await stderrPromise).trim();
            await options.onWorkerEvent?.("fail", {
              adapterId: ref.adapterId,
              refId: ref.id,
              timeoutMs,
              stderr,
            });
            reject(
              new Error(
                `worker timed out after ${timeoutMs}ms${
                  stderr ? `: ${stderr.slice(0, 400)}` : ""
                }`,
              ),
            );
          }, timeoutMs);
        })
      : null;

  try {
    return await (timeout ? Promise.race([work, timeout]) : work);
  } catch (error) {
    abortSession(session, ref);
    try {
      subprocess.stdin.end();
    } catch {
      // Best-effort close for protocol/setup failures.
    }
    if (subprocess.exitCode === null) {
      try {
        subprocess.kill();
      } catch {
        // Best-effort kill for failed workers.
      }
    }
    if (!timedOut && !failNotified) {
      const stderr = (await stderrPromise).trim();
      await options.onWorkerEvent?.("fail", {
        adapterId: ref.adapterId,
        refId: ref.id,
        error: error instanceof Error ? error.message : String(error),
        stderr,
      });
    }
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function findChangedViaWorker(
  workerCommand: string[],
  request: WorkerFindChangedRequest,
  options: {
    timeoutMs?: number;
    onWorkerEvent?: (
      phase: "sample",
      fields: Record<string, unknown>,
    ) => void | Promise<void>;
  } = {},
): Promise<WorkerFindChangedResult> {
  const subprocess = Bun.spawn({
    cmd: [...workerCommand, "__worker"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrPromise = readStreamText(subprocess.stderr);
  let nextRequestId = 1;
  const pending = new Map<JsonRpcId, PendingRequest>();

  const readLoop = readJsonRpcMessages(subprocess.stdout, async (message) => {
    if (isJsonRpcNotification(message)) {
      if (message.method !== WORKER_SAMPLE_METHOD) {
        return;
      }

      const params = message.params as WorkerSampleNotification;
      const parentRssMb = Math.round(process.memoryUsage().rss / MB);
      const parentCpuPct = sampleProcessCpuPct();
      await options.onWorkerEvent?.("sample", {
        adapterId: params.adapterId,
        ...(params.refId ? { refId: params.refId } : {}),
        phase: params.phase,
        childPid: params.pid,
        childRssMb: params.rssMb,
        childCpuPct: params.cpuPct,
        childJscHeapMb: params.jscHeapMb,
        childExternalMb: params.externalMb,
        combinedRssMb: parentRssMb + params.rssMb,
        combinedCpuPct: Math.round((parentCpuPct + params.cpuPct) * 10) / 10,
      });
      return;
    }

    if (!isJsonRpcResponse(message)) {
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);
    if ("error" in message) {
      entry.reject(
        new Error(
          `worker rpc error ${message.error.code}: ${message.error.message}`,
        ),
      );
    } else {
      entry.resolve(message.result);
    }
  }).finally(() => {
    if (pending.size === 0) {
      return;
    }

    const error = new Error("worker stream ended before pending responses arrived");
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  });

  const sendRequest = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextRequestId;
    nextRequestId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    writeJsonRpcMessage(subprocess.stdin, {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    });
    return promise;
  };

  const work = (async () => {
    const initializeResult = await sendRequest(INITIALIZE_METHOD, {
      client: "jin",
      protocolVersion: 1,
    });
    assertInitializeResult(initializeResult, [FIND_CHANGED_METHOD]);

    const findChangedPromise = sendRequest(FIND_CHANGED_METHOD, request);
    subprocess.stdin.end();

    const result = parseFindChangedResult(await findChangedPromise);
    const exitCode = await subprocess.exited;
    await readLoop;

    const stderr = (await stderrPromise).trim();
    if (exitCode !== 0) {
      throw new Error(
        `worker exited with code ${exitCode}${
          stderr ? `: ${stderr.slice(0, 400)}` : ""
        }`,
      );
    }

    return result;
  })();

  const timeoutMs = options.timeoutMs ?? 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout =
    timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(async () => {
            try {
              subprocess.kill();
            } catch {
              // Best-effort kill for timed-out workers.
            }
            const stderr = (await stderrPromise).trim();
            reject(
              new Error(
                `worker timed out after ${timeoutMs}ms${
                  stderr ? `: ${stderr.slice(0, 400)}` : ""
                }`,
              ),
            );
          }, timeoutMs);
        })
      : null;

  try {
    return await (timeout ? Promise.race([work, timeout]) : work);
  } catch (error) {
    try {
      subprocess.stdin.end();
    } catch {
      // Best-effort close for protocol/setup failures.
    }
    if (subprocess.exitCode === null) {
      try {
        subprocess.kill();
      } catch {
        // Best-effort kill for failed workers.
      }
    }
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function loadConversationAndNotify(
  request: WorkerLoadConversationRequest,
): Promise<WorkerLoadConversationResult> {
  const { ref, adapter } = request;
  if (adapter.adapterId !== ref.adapterId) {
    throw new Error(
      `worker adapter snapshot ${adapter.adapterId} does not match ref adapter ${ref.adapterId}`,
    );
  }

  const created = createAdapter(
    adapter.adapterId,
    adapter.adapterConfig,
  ) as unknown as V2Adapter;
  if (typeof created.loadConversation !== "function") {
    throw new Error(`adapter ${adapter.adapterId} does not support loadConversation`);
  }

  writeJsonRpcMessage(process.stdout, notification(WORKER_STARTED_METHOD, {
    adapterId: created.id,
    refId: ref.id,
    sourcePath: ref.sourcePath,
    pid: process.pid,
  }));
  writeSample(created.id, ref.id, "before-load");

  const bundle = await created.loadConversation(ref);
  writeSample(created.id, ref.id, "after-load");

  if (!bundle) {
    writeJsonRpcMessage(process.stdout, notification(INGEST_MISSING_METHOD, {
      adapterId: created.id,
      refId: ref.id,
    }));
    return { kind: "missing" };
  }

  writeJsonRpcMessage(process.stdout, notification(INGEST_CONVERSATION_METHOD, {
    adapterId: created.id,
    refId: ref.id,
    conversation: bundle.conversation,
  }));

  const bundleHash = computeBundleHash(bundle);
  const messages = orderedMessages(bundle.messages);
  const messageCount = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    writeJsonRpcMessage(process.stdout, notification(INGEST_MESSAGE_METHOD, {
      adapterId: created.id,
      refId: ref.id,
      message: messages[index],
    }));
    if ((index + 1) % 100 === 0) {
      writeSample(created.id, ref.id, `stream-${index + 1}`);
    }
  }

  bundle.messages.length = 0;
  messages.length = 0;
  created.releaseTransientMemory?.();
  created.releaseDiscoveryMemory?.();
  Bun.gc(true);
  await Bun.sleep(0);
  Bun.gc(true);
  writeSample(created.id, ref.id, "after-drop");
  return {
    kind: "loaded",
    bundleHash,
    messageCount,
  };
}

async function findChangedAndSnapshot(
  request: WorkerFindChangedRequest,
): Promise<WorkerFindChangedResult> {
  const { adapter, hint, discoveryState } = request;
  const created = createAdapter(
    adapter.adapterId,
    adapter.adapterConfig,
  ) as unknown as V2Adapter;

  if (discoveryState && isDiscoveryCacheCapableAdapter(created)) {
    created.importDiscoveryState(discoveryState);
  }

  writeSample(created.id, undefined, "before-findChanged");
  const refs = await created.findChanged(hint);
  writeSample(created.id, undefined, "after-findChanged");
  const nextDiscoveryState = isDiscoveryCacheCapableAdapter(created)
    ? created.exportDiscoveryState()
    : null;

  created.releaseDiscoveryMemory?.();
  created.releaseTransientMemory?.();
  Bun.gc(true);
  await Bun.sleep(0);
  Bun.gc(true);
  writeSample(created.id, undefined, "after-findChanged-release");

  return {
    refs,
    discoveryState: nextDiscoveryState,
  };
}

function assertInitializeResult(
  result: unknown,
  requiredMethods: string[],
): void {
  if (
    !isRecord(result) ||
    !Array.isArray(result.methods)
  ) {
    throw new Error("worker initialize handshake failed");
  }

  for (const method of requiredMethods) {
    if (!result.methods.includes(method)) {
      throw new Error("worker initialize handshake failed");
    }
  }
}

function parseFindChangedParams(
  value: unknown,
): WorkerFindChangedRequest {
  if (!isRecord(value) || !isRecord(value.adapter)) {
    throw new Error("invalid worker findChanged params");
  }

  const adapter = value.adapter;
  const snapshotAdapterId = asString(adapter.adapterId);
  const adapterConfig = adapter.adapterConfig;

  if (!snapshotAdapterId || !isRecord(adapterConfig)) {
    throw new Error("worker findChanged params missing required fields");
  }

  return {
    hint: parseChangeHint(value.hint),
    adapter: {
      adapterId: snapshotAdapterId,
      adapterConfig: {
        enabled:
          typeof adapterConfig.enabled === "boolean"
            ? adapterConfig.enabled
            : true,
        ...(typeof adapterConfig.dataDir === "string"
          ? { dataDir: adapterConfig.dataDir }
          : {}),
        ...(typeof adapterConfig.allowProtectedSource === "boolean"
          ? { allowProtectedSource: adapterConfig.allowProtectedSource }
          : {}),
      },
    },
    discoveryState: parseDiscoveryCacheState(value.discoveryState),
  };
}

function parseLoadConversationParams(
  value: unknown,
): WorkerLoadConversationRequest {
  if (!isRecord(value) || !isRecord(value.ref) || !isRecord(value.adapter)) {
    throw new Error("invalid worker loadConversation params");
  }

  const ref = value.ref;
  const adapter = value.adapter;
  const adapterId = asString(ref.adapterId);
  const refId = asString(ref.id);
  const sourcePath = asString(ref.sourcePath);
  const snapshotAdapterId = asString(adapter.adapterId);
  const adapterConfig = adapter.adapterConfig;

  if (!adapterId || !refId || !sourcePath || !snapshotAdapterId || !isRecord(adapterConfig)) {
    throw new Error("worker loadConversation params missing required fields");
  }

  return {
    ref: {
      id: refId,
      adapterId,
      sourcePath,
    },
    adapter: {
      adapterId: snapshotAdapterId,
      adapterConfig: {
        enabled:
          typeof adapterConfig.enabled === "boolean"
            ? adapterConfig.enabled
            : true,
        ...(typeof adapterConfig.dataDir === "string"
          ? { dataDir: adapterConfig.dataDir }
          : {}),
        ...(typeof adapterConfig.allowProtectedSource === "boolean"
          ? { allowProtectedSource: adapterConfig.allowProtectedSource }
          : {}),
      },
    },
  };
}

function parseLoadConversationResult(
  value: unknown,
): WorkerLoadConversationResult {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("invalid worker loadConversation result");
  }

  if (value.kind === "missing") {
    return { kind: "missing" };
  }

  if (
    value.kind === "loaded" &&
    typeof value.bundleHash === "string" &&
    typeof value.messageCount === "number"
  ) {
    return {
      kind: "loaded",
      bundleHash: value.bundleHash,
      messageCount: value.messageCount,
    };
  }

  throw new Error("invalid worker loadConversation result");
}

function parseFindChangedResult(
  value: unknown,
): WorkerFindChangedResult {
  if (!isRecord(value) || !Array.isArray(value.refs)) {
    throw new Error("invalid worker findChanged result");
  }

  const refs: ConversationRef[] = value.refs.map((ref) => {
    if (!isRecord(ref)) {
      throw new Error("invalid worker findChanged ref");
    }
    const id = asString(ref.id);
    const adapterId = asString(ref.adapterId);
    const sourcePath = asString(ref.sourcePath);
    if (!id || !adapterId || !sourcePath) {
      throw new Error("invalid worker findChanged ref");
    }
    return { id, adapterId, sourcePath };
  });

  return {
    refs,
    discoveryState: parseDiscoveryCacheState(value.discoveryState),
  };
}

function notification(method: string, params: unknown): JsonRpcNotification {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method,
    params,
  };
}

function writeSample(
  adapterId: string,
  refId: string | undefined,
  phase: string,
): void {
  const mem = process.memoryUsage();
  const stats = heapStats();
  writeJsonRpcMessage(process.stdout, notification(WORKER_SAMPLE_METHOD, {
    adapterId,
    ...(refId ? { refId } : {}),
    phase,
    pid: process.pid,
    rssMb: Math.round(mem.rss / MB),
    cpuPct: sampleProcessCpuPct(),
    jscHeapMb: Math.round(stats.heapSize / MB),
    externalMb: Math.round((mem.external ?? 0) / MB),
  }));
}

function sampleProcessCpuPct(): number {
  const nowNs = process.hrtime.bigint();
  const usage = process.cpuUsage();
  const elapsedMs = Number(nowNs - lastProcessCpuAtNs) / 1_000_000;
  const deltaMicros =
    usage.user +
    usage.system -
    (lastProcessCpuUsage.user + lastProcessCpuUsage.system);

  lastProcessCpuUsage = usage;
  lastProcessCpuAtNs = nowNs;

  if (elapsedMs <= 0) {
    return 0;
  }

  return Math.round(((deltaMicros / 1000) / elapsedMs) * 1000) / 10;
}

function writeJsonRpcMessage(
  sink:
    | NodeJS.WritableStream
    | {
        write: (chunk: string) => unknown;
      },
  message: JsonRpcMessage,
): void {
  const body = JSON.stringify(message);
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  sink.write(payload);
}

async function readJsonRpcMessages(
  stream: ReadableStream<Uint8Array> | undefined | null,
  onMessage: (message: JsonRpcMessage) => Promise<void> | void,
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer = concatUint8Arrays(buffer, value);
    while (true) {
      const headerEnd = indexOfHeaderTerminator(buffer);
      if (headerEnd < 0) {
        break;
      }

      const headerBytes = buffer.slice(0, headerEnd);
      const headerText = decoder.decode(headerBytes);
      const contentLength = parseContentLength(headerText);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        break;
      }

      const bodyBytes = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);
      await onMessage(JSON.parse(decoder.decode(bodyBytes)) as JsonRpcMessage);
    }
  }

  if (buffer.length > 0) {
    throw new Error("worker stream ended with incomplete JSON-RPC message");
  }
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

function indexOfHeaderTerminator(buffer: Uint8Array): number {
  for (let index = 0; index <= buffer.length - 4; index += 1) {
    if (
      buffer[index] === 13 &&
      buffer[index + 1] === 10 &&
      buffer[index + 2] === 13 &&
      buffer[index + 3] === 10
    ) {
      return index;
    }
  }

  return -1;
}

function parseContentLength(headerText: string): number {
  const match = headerText.match(/(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i);
  if (!match) {
    throw new Error("worker message missing Content-Length header");
  }

  return Number.parseInt(match[1], 10);
}

function concatUint8Arrays(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  const next = new Uint8Array(left.length + right.length);
  next.set(left);
  next.set(right, left.length);
  return next;
}

function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  return (
    isRecord(message) &&
    message.jsonrpc === JSON_RPC_VERSION &&
    typeof message.method === "string" &&
    typeof message.id === "number"
  );
}

function isJsonRpcNotification(
  message: unknown,
): message is JsonRpcNotification {
  return (
    isRecord(message) &&
    message.jsonrpc === JSON_RPC_VERSION &&
    typeof message.method === "string" &&
    !("id" in message)
  );
}

function isJsonRpcResponse(
  message: unknown,
): message is JsonRpcSuccessResponse | (JsonRpcErrorResponse & { id: number }) {
  return (
    isRecord(message) &&
    message.jsonrpc === JSON_RPC_VERSION &&
    typeof message.id === "number" &&
    ("result" in message || "error" in message)
  );
}

function assertNotificationMatchesRef(
  adapterId: string,
  refId: string,
  ref: ConversationRef,
): void {
  if (adapterId !== ref.adapterId || refId !== ref.id) {
    throw new Error(
      `worker notification targeted ${adapterId}/${refId} but expected ${ref.adapterId}/${ref.id}`,
    );
  }
}

function abortSession(
  session: ConversationWriteSession | null,
  ref: ConversationRef,
): void {
  abortConversationWriteSession(
    session,
    `worker write session ${ref.adapterId}/${ref.id}`,
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseChangeHint(value: unknown): ChangeHint | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("invalid worker change hint");
  }

  const kind = asString(value.kind);
  if (
    kind !== "startup-scan" &&
    kind !== "fs-change" &&
    kind !== "periodic-scan"
  ) {
    throw new Error("invalid worker change hint");
  }

  const changedPaths = Array.isArray(value.changedPaths)
    ? value.changedPaths.flatMap((entry) =>
        typeof entry === "string" ? [entry] : [],
      )
    : undefined;

  return changedPaths ? { kind, changedPaths } : { kind };
}

function parseDiscoveryCacheState(value: unknown): DiscoveryCacheState | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("invalid worker discovery cache state");
  }

  return {
    sources: value.sources.map((source) => {
      if (!isRecord(source)) {
        throw new Error("invalid worker discovery cache source");
      }
      const sourcePath = asString(source.sourcePath);
      const sourceKind = asString(source.sourceKind);
      const signature = asString(source.signature);
      const sizeBytes =
        typeof source.sizeBytes === "number" ? source.sizeBytes : NaN;
      const mtimeMs =
        typeof source.mtimeMs === "number" ? source.mtimeMs : NaN;
      if (
        !sourcePath ||
        !sourceKind ||
        !signature ||
        !Number.isFinite(sizeBytes) ||
        !Number.isFinite(mtimeMs)
      ) {
        throw new Error("invalid worker discovery cache source");
      }
      return {
        sourcePath,
        sourceKind,
        sizeBytes,
        mtimeMs,
        signature,
        payload: source.payload as DiscoveryCacheState["sources"][number]["payload"],
      };
    }),
  };
}
