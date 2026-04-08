# Experimental V2 Reset And Install

Experimental v2 treats the local jin store as disposable. The source files on
disk are the source of truth. If a machine has v1 or pre-cutover local state,
do not try to preserve that SQLite store. Reset the local state, install the
current repo binary, and let `jin` rebuild from source. Experimental v2 does
not promise backward-compatible local DB migration for these pre-cutover
stores.

If the local runtime hit an RSS hard shutdown and later commands start failing
with SQLite errors such as `attempt to write a readonly database` or `unable to
open database file`, treat that local store as unrecoverable experimental
state. Do a hard reset instead of attempting to repair the SQLite files in
place.

This is intentionally a shell-command runbook. We are not adding
`jin reset-local`. If this flow stabilizes, a wrapper script can come later.

When the runtime detects this poisoned-store signature on `jin start` or
`jin ingest`, it should print reset guidance instead of the raw SQLite stack:

```text
Experimental v2 local state is unrecoverable after the previous shutdown.
Run `jin stop || true`, remove ~/.config/jin, and restart jin.
Jin will not repair or delete the SQLite files automatically.
```

## Local Versus Team State

- Local reset only touches `~/.config/jin` on the developer machine.
- `jin team schema ...` is a separate operator path for a remote Postgres sink.
- Do not use remote schema commands as a substitute for a local reset.

## Rebuild And Install The Current Repo Binary

Run this from the repo root:

```sh
bun install
bun run build
mkdir -p "$HOME/.local/bin"
install -m 755 ./jin "$HOME/.local/bin/jin"
export PATH="$HOME/.local/bin:$PATH"
hash -r
jin version
```

If you do not want to install into `PATH`, stay in the repo root and replace
`jin` below with `./jin`.

## Soft Reset

Use the soft reset when you want to keep `~/.config/jin/config.json` and only
discard the local SQLite store.

```sh
jin stop || true
rm -f "$HOME/.config/jin"/store.db{,-shm,-wal}
jin start
```

Result:

- keeps local config, routes, and sinks
- recreates `~/.config/jin/store.db`
- reindexes from source files with the current experimental v2 binary

## Hard Reset

Use the hard reset when the machine has unknown legacy state or you want a
fully clean local install.

```sh
jin stop || true
rm -rf "$HOME/.config/jin"
jin start
```

Result:

- removes local config, routes, sinks, and the local store
- bootstraps a fresh local config directory on the next `jin start`
- requires re-running any workspace or integration setup afterward

## Basic Team / Postgres Path After Reset

Operator path for a generic Postgres destination:

```sh
jin team schema apply --connection-string="postgres://USER:PASSWORD@HOST:5432/DB"
jin team schema check --connection-string="postgres://USER:PASSWORD@HOST:5432/DB"
jin team bridge --type=postgres --connection-string="postgres://USER:PASSWORD@HOST:5432/DB"
```

Developer path:

```sh
jin connect --team="<bridge-code>"
jin start
```

Notes:

- `jin team schema apply` is the operator escape hatch for the remote Postgres
  integration schema. It is not a local migration command.
- `jin team bridge` generates the onboarding code the developer shares in chat.
- `jin connect --team=...` is the developer onboarding path that creates the
  sink and route locally.
