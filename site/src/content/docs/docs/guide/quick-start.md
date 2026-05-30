---
title: Quick Start
description: Start the jin daemon and inspect recent AI coding sessions.
sidebar:
  order: 2
---


Three commands get the local data layer running.

## 1. Detect tools

```sh
jin init
```

Jin scans for supported tools and writes config to `~/.config/jin/config.json`.

## 2. Start the daemon

```sh
jin start
```

The daemon watches local tool data and indexes sessions as they change.

## 3. Inspect activity

```sh
jin sessions --since=24h
jin stats --since=7d
```

The local store lives at `~/.config/jin/store.db` by default.
