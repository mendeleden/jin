---
title: CLI Reference
description: Common jin commands for local capture, inspection, routing, and team setup.
sidebar:
  order: 5
---


## Setup

| Command | Description |
| --- | --- |
| `jin init` | Detect tools and create config. |
| `jin init --team=<code>` | Join a shared team sink. |
| `jin init --skills` | Register jin with supported coding tools. |

## Runtime

| Command | Description |
| --- | --- |
| `jin start` | Start the watcher in the background. |
| `jin start --foreground` | Run the watcher in the current terminal. |
| `jin stop` | Stop running jin components. |
| `jin status` | Show daemon and routing status. |

## Inspection

| Command | Description |
| --- | --- |
| `jin sessions --since=24h` | List recent sessions. |
| `jin show <session-id>` | Show one session. |
| `jin stats --since=7d` | Show token, cost, tool, and adapter stats. |
| `jin export --format=json` | Export normalized session data. |

## Team routing

| Command | Description |
| --- | --- |
| `jin team-config --type=postgres` | Create a team onboarding code for Postgres. |
| `jin team-config --type=webhook` | Create a team onboarding code for HTTP ingestion. |
| `jin team-config --type=s3` | Create a team onboarding code for object storage. |
