# Run Modes — Daemon, Service, and Run Guards

jin supports three ways to run, with a guard system that prevents them from conflicting. This document covers how each mode works internally and how the conflict prevention logic operates.

---

## Run Mode State Machine

```mermaid
stateDiagram-v2
    [*] --> None: jin installed, not running

    None --> Foreground: jin watch
    None --> Daemon: jin watch --daemon
    None --> Service: jin service install

    Foreground --> None: Ctrl+C / SIGTERM
    Daemon --> None: jin stop
    Service --> None: jin service uninstall

    Daemon --> Service: jin service install<br/>(auto-stops daemon)
    Foreground --> Service: jin service install<br/>(auto-stops foreground)

    Service --> Foreground: blocked
    Service --> Daemon: blocked
    Daemon --> Foreground: blocked
    Daemon --> Daemon: blocked (duplicate)
    Foreground --> Foreground: blocked (PID file)
    Foreground --> Daemon: blocked (PID file)
```

---

## The Three Modes

### 1. Foreground (`jin watch`)

The simplest mode. jin runs in the terminal, logs to stdout, and exits on Ctrl+C.

**Lifecycle:**
1. Run guard check (PID file + service detection)
2. Write PID to `~/.config/jin/jin.pid`
3. Load config, detect adapters, connect sinks
4. Initial ingest
5. Start file watchers
6. Block on `await new Promise(() => {})` (run forever)
7. On SIGTERM/SIGINT: close watchers, close sinks, delete PID file, exit

**When to use:** Debugging, development, one-off testing.

### 2. Daemon (`jin watch --daemon`)

Forks to background and returns control to the terminal.

**Lifecycle:**
1. Run guard check
2. Resolve the real binary path via `/proc/self/exe` (compiled Bun binaries report a virtual `/$bunfs/root/` path — this gets the actual filesystem path)
3. Open log file descriptor: `fs.openSync(LOG_FILE, "a")`
4. Spawn self: `Bun.spawn([exe, "watch"], { stdout: logFd, stderr: logFd, stdin: "ignore" })`
5. Wait 500ms, check `proc.exitCode !== null` (if it already died, report error)
6. Write child PID to `jin.pid`
7. `proc.unref()` — detach from parent, let child run independently
8. Parent exits, child continues running in background

```mermaid
sequenceDiagram
    participant User
    participant Parent as jin watch --daemon
    participant Child as jin watch (forked)
    participant FS as File System

    User->>Parent: Run command
    Parent->>Parent: Resolve /proc/self/exe
    Parent->>FS: Open jin.log (append mode)
    Parent->>Child: Bun.spawn([exe, "watch"])
    Parent->>Parent: Wait 500ms
    Parent->>FS: Write child PID to jin.pid
    Parent->>User: "jin daemon started (PID X)"
    Parent->>Parent: proc.unref() + exit

    Note over Child: Runs independently
    Child->>Child: PID file check passes (it IS the PID)
    Child->>Child: Load config, ingest, watch...
    Child->>FS: Append logs to jin.log
```

**Key detail — `/proc/self/exe`:** When Bun compiles a binary, `process.argv[0]` returns `/$bunfs/root/jin` (a virtual filesystem path). This is not a real file. To respawn ourselves, we resolve the real path via `fs.realpathSync("/proc/self/exe")` on Linux. On macOS, we fall back to `process.execPath`.

**When to use:** Quick background operation, dev machines, no reboot persistence needed.

### 3. OS Service (`jin service install`)

Registers jin with the operating system's service manager so it auto-starts on boot/login and restarts on crash.

```mermaid
flowchart TD
    A[jin service install] --> B{Platform?}
    B -->|Linux| C[Write systemd unit to<br/>~/.config/systemd/user/jin.service]
    B -->|macOS| D[Write launchd plist to<br/>~/Library/LaunchAgents/com.jin.agent.plist]
    B -->|Windows| E[Register-ScheduledTask<br/>via PowerShell]

    C --> F[systemctl --user daemon-reload]
    F --> G[systemctl --user enable jin.service]
    G --> H[systemctl --user start jin.service]
    H --> I[loginctl enable-linger]

    D --> J[launchctl bootstrap gui/UID plist]

    E --> K[Start-ScheduledTask -TaskName jin]

    I --> L[Done — survives reboot]
    J --> L
    K --> L
```

#### Linux: systemd user service

The generated unit file:

```ini
[Unit]
Description=jin — conversation data pipeline for agentic coding tools
After=network-online.target

[Service]
Type=simple
ExecStart=/path/to/jin watch
Restart=on-failure
RestartSec=5s
StandardOutput=append:~/.config/jin/jin.log
StandardError=append:~/.config/jin/jin.log

[Install]
WantedBy=default.target
```

Key points:
- **User-level** (`~/.config/systemd/user/`): No root required
- **`loginctl enable-linger`**: Critical — without this, user services only run while logged in. With linger, they start at boot
- **`Restart=on-failure`**: systemd auto-restarts jin if it crashes (5s delay)
- **Logs**: Appended to `~/.config/jin/jin.log` (not journald, for consistency with daemon mode)

#### macOS: launchd LaunchAgent

The generated plist sets `RunAtLoad: true` and `KeepAlive.SuccessfulExit: false` (restart on crash, not on clean exit).

#### Windows: Task Scheduler

Uses PowerShell's `Register-ScheduledTask` with an `AtLogOn` trigger. No admin required.

**When to use:** Production, set-and-forget, team deployments.

---

## Run Guards — Conflict Prevention

**Source:** `src/runguard.ts`

The run guard system prevents multiple jin instances from running simultaneously, which would cause duplicate data, race conditions on the SQLite store, and duplicate pushes to sinks.

### Decision Flowchart

```mermaid
flowchart TD
    A[User runs a jin command] --> B{Which command?}

    B -->|jin watch| C{Launched by systemd?}
    C -->|Yes, INVOCATION_ID set| D[Skip service check]
    C -->|No| E{isServiceActive?}
    E -->|Yes| F[BLOCK: running as OS service]
    D --> G{PID file exists + process alive?}
    E -->|No| G
    G -->|Yes| H[BLOCK: already running PID X]
    G -->|No| I[Proceed: start watching]

    B -->|jin watch --daemon| J{isServiceActive?}
    J -->|Yes| K[BLOCK: running as OS service]
    J -->|No| L{PID file + alive?}
    L -->|Yes| M[BLOCK: already running]
    L -->|No| N{isServiceInstalled but inactive?}
    N -->|Yes| O[WARN: service may conflict on reboot]
    N -->|No| P[Proceed: fork daemon]
    O --> P

    B -->|jin service install| Q{Daemon running?}
    Q -->|Yes| R[Auto-stop daemon via SIGTERM]
    Q -->|No| S[Proceed: write unit + enable]
    R --> S

    B -->|jin stop| T{isServiceActive?}
    T -->|Yes| U[Redirect: use jin service uninstall]
    T -->|No| V{PID file exists?}
    V -->|No| W{isServiceInstalled?}
    W -->|Yes| X[Hint: service installed but inactive]
    W -->|No| Y[jin is not running]
    V -->|Yes| Z[Send SIGTERM, wait, clean up PID]
```

### The INVOCATION_ID Problem

When `jin service install` registers the systemd unit, systemd runs `jin watch`. But `jin watch` checks `isServiceActive()` which calls `systemctl --user is-active jin.service` — and since the service IS starting (it's running us!), it returns `activating`. This creates a circular block: the service can never start because it blocks itself.

**Fix:** Check for `INVOCATION_ID` or `JOURNAL_STREAM` environment variables, which systemd sets for processes it manages. If present, we know WE are the service, so we skip the service check.

```typescript
const launchedByService = !!(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM);
if (!launchedByService && isServiceActive()) {
  // Block — another service instance is running
}
```

### The Container Problem

In Docker containers, there's no systemd. Calling `Bun.spawnSync(["systemctl", ...])` throws `ENOENT` because the binary doesn't exist. All `isServiceActive()` and `isServiceInstalled()` calls are wrapped in `try/catch` and return `false` on any error.

### Conflict Matrix

| Already running as | User tries | Result |
|---|---|---|
| Daemon | `jin watch` (foreground) | **Blocked**: "already running (PID X)" |
| Daemon | `jin watch --daemon` | **Blocked**: "already running (PID X)" |
| Daemon | `jin service install` | **Auto-stops** daemon, installs service |
| Service | `jin watch` (foreground) | **Blocked**: "running as OS service" |
| Service | `jin watch --daemon` | **Blocked**: "running as OS service" |
| Service | `jin service install` | systemd won't double-start |
| Service | `jin stop` | **Redirects**: "use jin service uninstall" |
| Foreground | `jin watch --daemon` | **Blocked** via PID file |
| Foreground | `jin service install` | **Auto-stops** foreground, installs service |
| None (service installed, inactive) | `jin watch --daemon` | **Warning** about reboot conflict |

---

## Commands

| Command | What it does |
|---------|-------------|
| `jin watch` | Run in foreground (Ctrl+C to stop) |
| `jin watch --daemon` | Fork to background, write PID file |
| `jin service install` | Register with OS service manager |
| `jin service uninstall` | Stop + deregister from OS |
| `jin service status` | Show OS service state |
| `jin status` | Show daemon PID, session counts, sink info, recent logs |
| `jin stop` | Send SIGTERM to daemon PID |
