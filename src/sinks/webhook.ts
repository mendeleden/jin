import type { Sink, SinkConfig, PushPayload, PushResult } from "./types";

export class WebhookSink implements Sink {
  id = "webhook";
  name = "HTTP Webhook";
  private url: string;
  private headers: Record<string, string>;
  private batchSize: number;

  constructor(config: SinkConfig) {
    if (!config.url) throw new Error("Webhook sink requires 'url'");
    this.url = config.url;
    this.headers = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };
    if (config.teamId) this.headers["X-Jin-Team"] = config.teamId;
    if (config.developerId) this.headers["X-Jin-Developer"] = config.developerId;
    this.batchSize = config.batchSize || 10;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch(this.url, {
        method: "HEAD",
        headers: this.headers,
      });
      // Accept any 2xx or 405 (Method Not Allowed for HEAD is fine)
      if (resp.ok || resp.status === 405) return { ok: true };
      return { ok: false, error: `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async push(data: PushPayload[]): Promise<PushResult> {
    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Send in batches
    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize);
      try {
        const resp = await fetch(this.url, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            batch: batch.map((d) => ({
              session: d.session,
              messages: d.messages,
            })),
            pushedAt: new Date().toISOString(),
          }),
        });

        if (resp.ok) {
          pushed += batch.length;
        } else {
          failed += batch.length;
          const text = await resp.text();
          errors.push(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }
      } catch (err) {
        failed += batch.length;
        errors.push(String(err));
      }
    }

    return { pushed, failed, errors };
  }

  async close(): Promise<void> {}
}
