# Contributing to jin

jin is a conversation data pipeline for agentic coding tools. It reads session
data from tools like Claude Code, Cursor, Codex, etc., normalizes it, stores it
in SQLite, and pushes it to configurable sinks (webhook, Postgres, S3).

This guide covers the workflow for contributing code.

---

## Dev environment setup

Prerequisites: [Bun](https://bun.sh/) v1.1+, Git, Docker (for the test harness).

```bash
git clone <your-fork-url>
cd jin
bun install
bun run build        # compiles to a single binary: ./jin
bun run typecheck    # runs tsc --noEmit
```

During development you can run commands directly without compiling:

```bash
bun run src/index.ts init
bun run src/index.ts ingest
bun run src/index.ts list
```

---

## Project structure

```
jin/
  src/
    index.ts              CLI entry point, command routing
    store.ts              SQLite store (bun:sqlite, WAL mode)
    config.ts             Config loading/saving (~/.config/jin/config.json)
    watcher.ts            fs.watch with debounce for live ingestion
    runguard.ts           PID file + service detection to prevent conflicts
    pricing.ts            Token cost estimation by model

    adapters/
      types.ts            Adapter, Session, Message, ToolUse, ThinkingBlock interfaces
      registry.ts         allAdapters() and detectAdapters() — adapter registry
      claude-code.ts      Claude Code adapter (JSONL)
      cursor.ts           Cursor adapter
      codex.ts            OpenAI Codex adapter (JSONL)
      warp.ts             Warp adapter
      gemini-cli.ts       Gemini CLI adapter
      kiro.ts             Kiro adapter
      amp.ts              Amp adapter
      opencode.ts         OpenCode adapter
      pi.ts               Pi adapter
      piagent.ts          PiAgent adapter

    sinks/
      types.ts            Sink, SinkConfig, PushPayload, PushResult interfaces
      registry.ts         createSink() factory, availableSinks()
      webhook.ts          HTTP webhook sink
      postgres.ts         PostgreSQL sink
      s3.ts               S3-compatible sink (AWS, R2, MinIO, GCS)

    commands/
      init.ts             jin init — detect tools, apply team config
      watch.ts            jin watch — foreground/daemon watcher
      stop.ts             jin stop — stop daemon
      status.ts           jin status — show running mode + stats
      service.ts          jin service install|uninstall|status — OS service management
      ingest.ts           jin ingest — one-shot ingest from all detected adapters
      push.ts             jin push — push sessions to configured sinks
      list.ts             jin list — list ingested sessions
      show.ts             jin show — display a session's messages
      analyze.ts          jin analyze — token/cost analysis
      export.ts           jin export — export to JSON or Markdown files
      team-config.ts      jin team-config — generate base64 onboarding code

  test-harness/
    docker-compose.yml    Spins up Postgres + real coding tools + jin watcher
    .env.example          API keys template
    scripts/              Shell scripts for running tool containers
    sample-project/       Minimal TypeScript project for tools to work on
```

---

## How to add a new adapter

Adapters read tool-specific data files and normalize them into `Session` and
`Message` objects.

1. Create `src/adapters/<tool-name>.ts` implementing the `Adapter` interface
   from `src/adapters/types.ts`.

2. The interface requires:

   | Method       | Purpose                                          |
   |-------------|--------------------------------------------------|
   | `id`        | Unique string identifier (e.g. `"my-tool"`)       |
   | `name`      | Human-readable name (e.g. `"My Tool"`)            |
   | `icon`      | Single character icon for CLI display              |
   | `detect()`  | Return `true` if the tool's data exists on disk    |
   | `sessions()`| Return all sessions found for this tool            |
   | `messages(sessionId)` | Return all messages for a session        |
   | `watchPaths()` | Return directories to watch for live changes    |

3. Register it in `src/adapters/registry.ts`:

   ```typescript
   import { MyToolAdapter } from "./my-tool";

   export function allAdapters(): Adapter[] {
     return [
       // ... existing adapters
       new MyToolAdapter(),
     ];
   }
   ```

4. Add a default config entry in `src/config.ts` under `defaultConfig()`:

   ```typescript
   adapters: {
     // ... existing entries
     "my-tool": { enabled: true },
   }
   ```

See [ADDING_ADAPTERS.md](./ADDING_ADAPTERS.md) for a detailed walkthrough with
a skeleton implementation.

---

## How to add a new sink

Sinks push normalized session/message data to external destinations.

1. Create `src/sinks/<sink-name>.ts` implementing the `Sink` interface from
   `src/sinks/types.ts`.

2. The interface requires:

   | Method         | Purpose                                       |
   |---------------|-----------------------------------------------|
   | `id`          | Unique string identifier                       |
   | `name`        | Human-readable name                            |
   | `healthCheck()` | Verify connection/credentials are valid      |
   | `push(data)`  | Push an array of `PushPayload` objects         |
   | `close()`     | Clean up connections                           |

3. Register it in `src/sinks/registry.ts`:

   ```typescript
   const SINK_FACTORIES: Record<string, (config: SinkConfig) => Sink> = {
     // ... existing entries
     "my-sink": (c) => new MySinkSink(c),
   };
   ```

4. Add relevant config fields to the `SinkConfig` interface in
   `src/sinks/types.ts` and update the `SinkConfig.type` union.

5. Update `src/commands/team-config.ts` if the sink should be available via
   `jin team-config`.

---

## How to add a new command

1. Create `src/commands/<command-name>.ts` exporting an async function:

   ```typescript
   export async function myCommand(opts: { /* flags */ }): Promise<void> {
     // implementation
   }
   ```

2. Wire it into the `switch` block in `src/index.ts`:

   ```typescript
   case "my-command": {
     const { myCommand } = await import("./commands/my-command");
     await myCommand({ /* parse flags */ });
     break;
   }
   ```

3. Add usage text in the `usage()` function in `src/index.ts`.

Commands are lazily imported (dynamic `import()`) so they do not affect startup
time for other commands.

---

## Code style

- **TypeScript only.** The project targets Bun's runtime. Use Bun APIs where
  appropriate (`Bun.file()`, `Bun.write()`, `bun:sqlite`, `Bun.spawnSync()`).

- **No runtime npm dependencies.** The `package.json` has zero `dependencies` --
  only `devDependencies` for types and the TypeScript compiler. Keep it that way.
  If you need HTTP, use the built-in `fetch`. If you need SQLite, use
  `bun:sqlite`. If you need filesystem access, use `node:fs`.

- **Keep adapters self-contained.** Each adapter file should be a single module
  that handles its own file discovery, parsing, and normalization. Do not create
  shared parsing utilities unless multiple adapters genuinely share a format.

- **Handle errors gracefully.** Adapters and sinks encounter missing files,
  corrupt data, and network failures. Use try/catch and continue processing
  rather than throwing and stopping the pipeline.

- **Use `existsSync` for path checks** before reading files. Tools may not be
  installed on a given machine.

---

## Testing with the Docker Compose test harness

The `test-harness/` directory contains a Docker Compose setup that runs real
coding tools against a sample project, then verifies jin can ingest and push
the data.

```bash
cd test-harness

# 1. Set up API keys
cp .env.example .env
# Edit .env with your GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY

# 2. Start Postgres
docker compose up -d postgres

# 3. Run a coding tool (pick one)
docker compose up gemini-cli
docker compose up codex
docker compose up opencode

# 4. Run jin watcher (ingests + pushes to Postgres)
docker compose up jin-watch

# 5. Check results
docker compose --profile analyze up jin-analyze
docker compose --profile list up jin-list
```

For local-only testing without Docker, you can test against your own tool data:

```bash
bun run src/index.ts init
bun run src/index.ts ingest
bun run src/index.ts list
bun run src/index.ts analyze
```

---

## PR process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes. Run `bun run typecheck` to verify types.
3. Test with `jin ingest` and `jin list` against real or sample data.
4. If adding an adapter or sink, test with the Docker Compose harness.
5. Open a PR against `main` with a clear description of what changed and why.
6. Keep PRs focused -- one adapter, one sink, or one feature per PR.
