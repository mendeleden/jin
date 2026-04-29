---
title: jin status should not block while fetching log tail
date: 2026-04-19
tags: [cli, status, service, logs]
related: [W3-PERF-11]
---

# jin status should not block while fetching log tail

## Problem

In live service-mode testing, `jin status` printed the primary runtime summary
and then appeared to hang before returning control to the shell.

The likely cause is the final log-summary step. Today `jin status` tries to show
the last log line as part of the command output. That is useful when it is fast,
but it is not important enough to justify making `jin status` feel blocked or
wedged.

## Why This Matters

`jin status` is the main operator health command. It needs to be cheap and
predictable.

If the log tail path blocks, users lose trust in the command and start treating
the runtime itself as suspect even when the daemon is healthy.

## Desired Outcome

`jin status` should always return promptly after printing the runtime summary.

Acceptable follow-up behaviors:

- skip the log tail entirely when it is unavailable or slow
- time-bound the log read aggressively and print `last: unavailable`
- move log inspection to a separate explicit command

## Recommendation

Treat the log tail as best-effort only.

The runtime/store/adapters summary should never wait on filesystem or log-read
paths that can stall the command.
