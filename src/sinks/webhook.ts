import { DEFAULT_WEBHOOK_TIMEOUT_MS, type WebhookSinkConfig } from "../contracts/config";
import type {
  PushError,
  PushPayload as SnapshotPushPayload,
  PushResult as SnapshotPushResult,
  Sink as SnapshotSink,
  SinkHealth,
} from "../contracts/sinks";
import type {
  PushPayload as LegacyPushPayload,
  PushResult as LegacyPushResult,
  Sink as LegacySink,
  SinkConfig as LegacySinkConfig,
} from "./types";

type WebhookConfigInput = LegacySinkConfig | WebhookSinkConfig;

type LegacyWebhookConfig = LegacySinkConfig & {
  batchSize?: number;
  developerId?: string;
  id?: string;
  name?: string;
  teamId?: string;
  timeoutMs?: number;
};

interface WebhookBatchItem {
  idempotencyKey: string;
  conversation: SnapshotPushPayload["conversation"];
  messages: SnapshotPushPayload["messages"];
  toolCalls: SnapshotPushPayload["toolCalls"];
}

interface WebhookBatchResponse {
  errors?: unknown;
  failed?: unknown;
}

const V2_PAYLOAD_ERROR =
  "Webhook sink requires v2 full-snapshot push payloads";

export class WebhookSink implements LegacySink, SnapshotSink {
  readonly id: string;
  readonly name: string;

  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly batchSize: number | null;

  constructor(config: WebhookConfigInput) {
    const normalized = config as LegacyWebhookConfig;
    if (!normalized.url) {
      throw new Error("Webhook sink requires 'url'");
    }

    this.id = normalized.id ?? "webhook";
    this.name = normalized.name ?? "HTTP Webhook";
    this.url = normalized.url;
    this.headers = {
      "Content-Type": "application/json",
      ...(normalized.headers ?? {}),
    };

    if (normalized.teamId) {
      this.headers["X-Jin-Team"] = normalized.teamId;
    }
    if (normalized.developerId) {
      this.headers["X-Jin-Developer"] = normalized.developerId;
    }

    this.timeoutMs = normalizePositiveInt(
      normalized.timeoutMs,
      DEFAULT_WEBHOOK_TIMEOUT_MS,
    );
    this.batchSize = normalizeBatchSize(normalized.batchSize);
  }

  async healthCheck(): Promise<SinkHealth> {
    try {
      const response = await this.fetchWithTimeout(this.url, {
        method: "HEAD",
        headers: this.headers,
      });

      if (response.ok || response.status === 405) {
        return { ok: true };
      }

      return {
        ok: false,
        error: formatHttpError(
          response.status,
          response.statusText,
          await readResponseText(response),
        ),
      };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  async push(payloads: SnapshotPushPayload[]): Promise<SnapshotPushResult>;
  async push(payloads: LegacyPushPayload[]): Promise<LegacyPushResult>;
  async push(
    payloads: Array<SnapshotPushPayload | LegacyPushPayload>,
  ): Promise<any> {
    if (payloads.length === 0) {
      return { pushed: 0, failed: 0, errors: [] };
    }

    if (payloads.every(isSnapshotPushPayload)) {
      return this.pushSnapshots(payloads);
    }

    return {
      pushed: 0,
      failed: payloads.length,
      errors: payloads.map((payload, index) =>
        formatLegacyPayloadError(payload, index),
      ),
    };
  }

  async close(): Promise<void> {}

  private async pushSnapshots(
    payloads: SnapshotPushPayload[],
  ): Promise<SnapshotPushResult> {
    const results: SnapshotPushResult[] = [];
    const batchSize = this.batchSize ?? payloads.length;

    for (let index = 0; index < payloads.length; index += batchSize) {
      const batch = payloads.slice(index, index + batchSize);
      results.push(await this.pushBatch(batch));
    }

    return {
      pushed: results.reduce((sum, result) => sum + result.pushed, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      errors: results.flatMap((result) => result.errors),
    };
  }

  private async pushBatch(
    payloads: SnapshotPushPayload[],
  ): Promise<SnapshotPushResult> {
    try {
      const response = await this.fetchWithTimeout(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          batch: payloads.map((payload) => this.toBatchItem(payload)),
        }),
      });

      const responseText = await readResponseText(response);
      const explicitErrors = parseResponseErrors(responseText, payloads);

      if (!response.ok) {
        return failBatch(
          payloads,
          formatHttpError(response.status, response.statusText, responseText),
          explicitErrors,
        );
      }

      return {
        pushed: payloads.length - explicitErrors.length,
        failed: explicitErrors.length,
        errors: explicitErrors,
      };
    } catch (error) {
      return failBatch(payloads, formatError(error));
    }
  }

  private toBatchItem(payload: SnapshotPushPayload): WebhookBatchItem {
    return {
      idempotencyKey: `${payload.conversation.id}:r${payload.attemptedRevision}`,
      conversation: payload.conversation,
      messages: payload.messages,
      toolCalls: payload.toolCalls,
    };
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && isAbortError(error)) {
        throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function isSnapshotPushPayload(
  payload: SnapshotPushPayload | LegacyPushPayload,
): payload is SnapshotPushPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "attemptedRevision" in payload &&
    "conversation" in payload &&
    "messages" in payload &&
    "toolCalls" in payload
  );
}

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeBatchSize(value: number | undefined): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return Math.floor(value);
  }

  return null;
}

function parseResponseErrors(
  responseText: string,
  payloads: SnapshotPushPayload[],
): PushError[] {
  if (!responseText.trim()) {
    return [];
  }

  let parsed: WebhookBatchResponse;
  try {
    parsed = JSON.parse(responseText) as WebhookBatchResponse;
  } catch {
    return [];
  }

  const candidate =
    Array.isArray(parsed.errors) ? parsed.errors : parsed.failed;

  if (!Array.isArray(candidate)) {
    return [];
  }

  const allowedIds = new Set(payloads.map((payload) => payload.conversation.id));
  const errors: PushError[] = [];
  const seen = new Set<string>();

  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const conversationId =
      "conversationId" in entry && typeof entry.conversationId === "string"
        ? entry.conversationId
        : null;
    if (!conversationId || !allowedIds.has(conversationId) || seen.has(conversationId)) {
      continue;
    }

    const error =
      "error" in entry && typeof entry.error === "string" && entry.error.trim()
        ? entry.error.trim()
        : "Webhook push failed";

    errors.push({ conversationId, error });
    seen.add(conversationId);
  }

  return errors;
}

function failBatch(
  payloads: SnapshotPushPayload[],
  fallbackError: string,
  explicitErrors: PushError[] = [],
): SnapshotPushResult {
  const explicitById = new Map(
    explicitErrors.map((entry) => [entry.conversationId, entry.error]),
  );

  return {
    pushed: 0,
    failed: payloads.length,
    errors: payloads.map((payload) => ({
      conversationId: payload.conversation.id,
      error: explicitById.get(payload.conversation.id) ?? fallbackError,
    })),
  };
}

function formatLegacyPayloadError(
  payload: SnapshotPushPayload | LegacyPushPayload,
  index: number,
): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "session" in payload &&
    payload.session &&
    typeof payload.session === "object" &&
    "id" in payload.session &&
    typeof payload.session.id === "string"
  ) {
    return `Session ${payload.session.id}: ${V2_PAYLOAD_ERROR}`;
  }

  return `Payload ${index}: ${V2_PAYLOAD_ERROR}`;
}

function formatHttpError(
  status: number,
  statusText: string,
  responseText: string,
): string {
  const bodySummary = summarizeResponseText(responseText);
  const label = statusText.trim() ? `HTTP ${status} ${statusText.trim()}` : `HTTP ${status}`;
  return bodySummary ? `${label}: ${bodySummary}` : label;
}

function summarizeResponseText(responseText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    return "";
  } catch {
    return trimmed.slice(0, 200);
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("aborted"))
  );
}
