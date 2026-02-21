# Sinks and Team Onboarding — How data reaches your infrastructure

This document covers how jin's output sinks work, how the team onboarding flow operates, and the internals of each sink implementation.

---

## Sink Architecture

```mermaid
classDiagram
    class Sink {
        <<interface>>
        +id: string
        +name: string
        +healthCheck() Promise~HealthResult~
        +push(data: PushPayload[]) Promise~PushResult~
        +close() Promise~void~
    }

    class SinkConfig {
        +type: "webhook" | "postgres" | "s3"
        +teamId: string
        +developerId?: string
        +url?: string
        +connectionString?: string
        +bucket?: string
        +region?: string
        +accessKeyId?: string
        +secretAccessKey?: string
    }

    class PushPayload {
        +session: Session
        +messages: Message[]
    }

    class PushResult {
        +pushed: number
        +failed: number
        +errors: string[]
    }

    Sink <|.. WebhookSink
    Sink <|.. PostgresSink
    Sink <|.. S3Sink

    Sink ..> PushPayload : consumes
    Sink ..> PushResult : returns
    SinkConfig ..> Sink : configures
```

---

## Team Onboarding Flow

The team onboarding flow lets a team lead generate a single base64 code that encodes everything a developer needs to connect to shared infrastructure.

```mermaid
sequenceDiagram
    participant Lead as Team Lead
    participant GenCmd as jin team-config
    participant B64 as Base64 Encoder
    participant Dev as Developer
    participant InitCmd as jin init --team
    participant Sink as Sink
    participant Cfg as ~/.config/jin/config.json

    Lead->>GenCmd: jin team-config --type=postgres<br/>--connection-string=postgres://...<br/>--team-id=acme-eng
    GenCmd->>GenCmd: Build SinkConfig object
    GenCmd->>B64: JSON.stringify → btoa()
    B64-->>Lead: eyJ0eXBlIjoicG9zdGdyZXMiLC4uLn0=

    Note over Lead,Dev: Lead shares code via Slack, docs, etc.

    Dev->>InitCmd: jin init --team=eyJ0eXBlIjoi...
    InitCmd->>B64: atob() → JSON.parse
    B64-->>InitCmd: SinkConfig { type, connectionString, teamId }
    InitCmd->>Sink: createSink(config)
    InitCmd->>Sink: healthCheck()
    Sink-->>InitCmd: { ok: true }
    InitCmd->>Cfg: Write config with sink + team settings
    InitCmd-->>Dev: "Connected to acme-eng (postgres)"
```

### What's in the base64 code?

It's just a JSON object, base64-encoded:

```json
{
  "type": "postgres",
  "connectionString": "postgres://user:pass@host:5432/db",
  "teamId": "acme-eng",
  "schema": "public"
}
```

The `jin init --team=<code>` command:
1. Decodes the base64 string
2. Parses the JSON into a `SinkConfig`
3. Creates a sink instance and runs `healthCheck()` to verify connectivity
4. Saves the config with the sink, team ID, and auto-detected developer ID (`$USER`)
5. Sets sync mode to `realtime`

---

## Push Pipeline

```mermaid
flowchart TD
    A[File change detected] --> B[Push debounce timer: 2s]
    B --> C[Query store: unpushedSessions]
    C --> D{Any unpushed?}
    D -->|No| E[Done]
    D -->|Yes| F[For each session: getMessages]
    F --> G["Build PushPayload[]<br/>{session, messages}"]
    G --> H{How many sinks?}
    H -->|For each sink| I[sink.push payload]
    I --> J{Result?}
    J -->|Success| K[Log to push_log table]
    J -->|Failure| L[Log error, will retry on next cycle]
    K --> E
    L --> E
```

---

## Sink Deep Dives

### 1. Webhook Sink

**Source:** `src/sinks/webhook.ts`

The simplest sink. Sends a POST request with the full payload as JSON.

**Request format:**
```
POST <url>
Content-Type: application/json
X-Jin-Team: <teamId>
X-Jin-Developer: <developerId>

[
  {
    "session": { ... },
    "messages": [ ... ]
  }
]
```

**Implementation:** A single `fetch()` call. No retry logic, no batching beyond what the push pipeline already provides. If the endpoint returns non-2xx, the push is marked as failed and will be retried on the next sync cycle.

**Health check:** Sends a GET request to the URL and checks for a 2xx response.

**Use cases:** Custom APIs, Zapier/Make webhooks, serverless functions, internal tools.

---

### 2. PostgreSQL Sink

**Source:** `src/sinks/postgres.ts`

The most complex sink. Supports two execution modes depending on the connection string format.

```mermaid
flowchart TD
    A[sink.push called] --> B{Connection string format?}

    B -->|"https://"| C[HTTP Mode<br/>Neon / Supabase serverless]
    B -->|"postgres://"| D[psql Mode<br/>Standard PostgreSQL]

    C --> E["fetch(url, {<br/>  method: POST,<br/>  body: { query, params }<br/>})"]

    D --> F["Bun.spawn(['psql', connStr,<br/>  '-t', '-A', '-c', sql])"]

    E --> G[Parse response JSON]
    F --> H[Parse pipe-delimited stdout]

    G --> I[Return rows]
    H --> I
```

**Table schema:**

The sink auto-creates two tables on first push:

```sql
-- jin_sessions: one row per conversation
CREATE TABLE jin_sessions (
    id TEXT PRIMARY KEY,
    adapter_id TEXT NOT NULL,
    adapter_name TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    duration_ms BIGINT DEFAULT 0,
    is_active BOOLEAN DEFAULT FALSE,
    total_tokens INTEGER DEFAULT 0,
    est_cost DOUBLE PRECISION DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    source_path TEXT,
    is_sub_agent BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    team_id TEXT DEFAULT '',
    developer_id TEXT DEFAULT '',
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- jin_messages: one row per message
CREATE TABLE jin_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES jin_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    timestamp TIMESTAMPTZ,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0,
    cache_write INTEGER DEFAULT 0,
    tool_uses JSONB DEFAULT '[]',
    thinking_blocks JSONB DEFAULT '[]'
);
```

**Indexes:** Created on `team_id`, `developer_id`, and `session_id` for fast team-level queries.

**Upsert logic:** Uses `INSERT ... ON CONFLICT (id) DO UPDATE` so re-pushing the same session updates it rather than failing.

**psql mode parameter interpolation:** Since psql doesn't support parameterized queries via CLI, the sink manually interpolates `$1`, `$2`, etc. with escaped values. Single quotes in values are doubled (`'` → `''`).

---

### 3. S3 Sink

**Source:** `src/sinks/s3.ts`

Uploads each session as a JSON file to S3-compatible storage (AWS S3, Cloudflare R2, Google GCS, MinIO).

**Zero-dependency AWS Signature V4:** Instead of importing the AWS SDK, the S3 sink implements the AWS Sig V4 signing algorithm from scratch. This keeps jin's zero-runtime-dependency guarantee.

```mermaid
flowchart TD
    A[sink.push called] --> B[For each session]
    B --> C["Build object key:<br/>prefix/teamId/developerId/adapterId/sessionId.json"]
    C --> D[Serialize: JSON.stringify session + messages]
    D --> E[SHA-256 hash the body]
    E --> F["Build canonical request:<br/>PUT /bucket/key HTTP/1.1<br/>host, date, content-sha256 headers"]
    F --> G["Build string to sign:<br/>AWS4-HMAC-SHA256 + date + scope + hash"]
    G --> H["Derive signing key:<br/>HMAC(HMAC(HMAC(HMAC(secret, date), region), 's3'), 'aws4_request')"]
    H --> I["Calculate signature:<br/>HMAC(signingKey, stringToSign)"]
    I --> J["Add Authorization header:<br/>AWS4-HMAC-SHA256 Credential=.../Signature=..."]
    J --> K["PUT request to endpoint"]
    K --> L{2xx?}
    L -->|Yes| M[Success]
    L -->|No| N[Error]
```

**Object path structure:**
```
s3://bucket/prefix/teamId/developerId/adapterId/sessionId.json
```

Example:
```
s3://my-jin-bucket/jin/acme-eng/alice/claude-code/0ff2289f-3768-450b-9a2c-38373f56d96c.json
```

**Health check:** Sends a HEAD request to the bucket root to verify credentials and access.

**Compatibility:** Works with any S3-compatible API by setting the `endpoint` config:
- AWS S3: `https://s3.us-east-1.amazonaws.com`
- Cloudflare R2: `https://<account>.r2.cloudflarestorage.com`
- MinIO: `http://localhost:9000`
- GCS: `https://storage.googleapis.com` (with HMAC keys)

---

## Sink Registry

**Source:** `src/sinks/registry.ts`

The `createSink(config)` factory takes a `SinkConfig` and returns the appropriate `Sink` instance:

```typescript
switch (config.type) {
  case "webhook":  return new WebhookSink(config);
  case "postgres": return new PostgresSink(config);
  case "s3":       return new S3Sink(config);
}
```

To add a new sink: implement the `Sink` interface, add a case to the factory, and update the `SinkConfig` type union.
