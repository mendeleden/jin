# Team Setup

jin supports team-wide collection of AI coding session data. Each developer runs jin locally, and sessions are pushed to a shared sink (Postgres, Webhook, or S3).

## How it works

```
Developer A (macOS)          Developer B (Linux)
  jin watch --daemon           jin watch --daemon
       │                            │
       └──────────┬─────────────────┘
                  ▼
         ┌──────────────┐
         │  PostgreSQL   │   (or Webhook / S3)
         │  your infra   │
         └──────────────┘
```

## Setup flow

### 1. Team lead generates a config code

On any machine with jin installed:

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://jin:yourpassword@db.internal:5432/jin" \
  --team-id=my-team
```

This outputs a base64-encoded config string:

```
eyJzaW5rIjoicG9zdGdyZXMiLCJjb25uZWN0aW9uU3RyaW5nIjoi...
```

### 2. Share the code with your team

Send it via Slack, email, or your team wiki. It contains the connection details for the shared sink.

### 3. Each developer runs

```sh
jin init --team=eyJzaW5rIjoicG9zdGdyZXMiLCJjb25uZWN0aW9uU3RyaW5nIjoi...
jin watch --daemon
```

That's it. Sessions from every developer's local tools are now streaming to your shared Postgres.

## Supported sinks

| Sink | Best for | Guide |
|------|----------|-------|
| **PostgreSQL** | Teams wanting SQL queries, dashboards, Metabase/Grafana | [Self-hosted Postgres →](/guide/postgres-self-hosted) |
| **Webhook** | Custom integrations, Slack bots, internal APIs | [Webhook →](/guide/webhook) |
| **S3 / R2** | Archival, compliance, data lake | [S3 →](/guide/s3) |
