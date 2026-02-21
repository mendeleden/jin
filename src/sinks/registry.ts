import type { Sink, SinkConfig } from "./types";
import { WebhookSink } from "./webhook";
import { PostgresSink } from "./postgres";
import { S3Sink } from "./s3";

const SINK_FACTORIES: Record<string, (config: SinkConfig) => Sink> = {
  webhook: (c) => new WebhookSink(c),
  postgres: (c) => new PostgresSink(c),
  s3: (c) => new S3Sink(c),
};

export function createSink(config: SinkConfig): Sink {
  const factory = SINK_FACTORIES[config.type];
  if (!factory) {
    throw new Error(
      `Unknown sink type: "${config.type}". Available: ${Object.keys(SINK_FACTORIES).join(", ")}`
    );
  }
  return factory(config);
}

export function availableSinks(): string[] {
  return Object.keys(SINK_FACTORIES);
}
