---
title: Jin Documentation
description: Install jin, run the local daemon, inspect sessions, and route AI coding data to team infrastructure.
template: splash
hero:
  title: Jin documentation
  tagline: Set up the private data layer for AI coding teams.
  actions:
    - text: Install jin
      link: /docs/guide/getting-started/
    - text: Team setup
      link: /docs/guide/team-setup/
      variant: secondary
---

## Product surfaces

| Surface | Marketing name | Purpose |
| --- | --- | --- |
| `jin` | JustIndex | Passive daemon and normalized local data model. |
| `jin desktop` | JustInfo | Local developer interface for search, routing, and inspection. |
| `jin team` | JustInsight | Team sinks, analytics, and organization-level visibility. |

## Core workflows

- Install `jin` and let it detect supported AI coding tools.
- Run the daemon locally so sessions are captured as developers work.
- Inspect sessions, tool calls, token usage, and project history.
- Route normalized events to Postgres, S3, R2, or a webhook for team analysis.
