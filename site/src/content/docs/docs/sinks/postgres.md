---
title: Postgres Sink
description: Route normalized AI coding sessions to a Postgres database.
sidebar:
  order: 7
---


Use Postgres when teams want SQL access, dashboards, and long-lived operational reporting.

## Create a team code

```sh
jin team-config \
  --type=postgres \
  --connection-string="postgresql://jin:password@db.internal:5432/jin" \
  --team-id=platform
```

## Developer onboarding

```sh
jin init --team=<team-code>
jin start
```

## Recommended uses

- Adoption reporting by team, tool, project, and model.
- Token and cost analysis over time.
- Queryable tool-call patterns and repeated error loops.
