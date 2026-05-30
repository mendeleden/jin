---
title: Team Setup
description: Route every developer's local AI coding sessions to shared infrastructure.
sidebar:
  order: 3
---


Jin supports team-wide collection without centralizing the developer workflow. Each developer runs `jin` locally, and normalized sessions are routed to a shared sink.

## Generate a team config

For Postgres:

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://jin:password@db.internal:5432/jin" \
  --team-id=platform
```

This returns an onboarding code.

## Share the onboarding command

Each developer runs:

```sh
jin init --team=<team-code>
jin start
```

## Supported sinks

| Sink | Best for |
| --- | --- |
| Postgres | SQL queries, BI dashboards, operations reports. |
| Webhook | Internal APIs, Slack bots, custom processing. |
| S3 / R2 | Archival, compliance exports, data lake ingestion. |
