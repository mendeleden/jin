---
title: Configuration
description: Configure adapters, the local store, watchers, and routing sinks.
sidebar:
  order: 6
---


Jin stores local configuration at:

```txt
~/.config/jin/config.json
```

## Example

```json
{
  "adapters": {
    "claude-code": { "enabled": true },
    "cursor": { "enabled": true },
    "codex": { "enabled": true }
  },
  "store": {
    "dbPath": "~/.config/jin/store.db",
    "rawDir": "~/.config/jin/raw"
  },
  "watch": {
    "debounceMs": 200,
    "pollIntervalMs": 30000
  },
  "sinks": [],
  "team": null
}
```

## Policy

Policy-like behavior should be owned in one module and validated at the policy boundary. Avoid scattering environment checks, magic flag strings, schema names, or default paths across call sites.
