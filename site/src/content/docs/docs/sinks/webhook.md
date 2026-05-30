---
title: Webhook Sink
description: Route normalized sessions to an internal HTTP endpoint.
sidebar:
  order: 8
---


Use a webhook when you want custom ingestion into an internal API, event bus, or automation system.

## Create a team code

```sh
jin team-config \
  --type=webhook \
  --url="https://api.example.com/jin/ingest" \
  --team-id=platform
```

## Add headers

```sh
jin team-config \
  --type=webhook \
  --url="https://api.example.com/jin/ingest" \
  --headers='{"Authorization":"Bearer token"}' \
  --team-id=platform
```

Webhook payloads contain normalized session batches.
