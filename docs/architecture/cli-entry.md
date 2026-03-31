# Architecture: CLI entry (`jin init`)

**Module:** `src/index.ts`  
**Role:** Parse `process.argv`, dispatch subcommands, pass options into `initCommand`.

## Runtime and binary

- Shebang: `#!/usr/bin/env bun` — the CLI runs under Bun.
- `package.json` registers `"bin": { "jin": "./src/index.ts" }`.

## Argument parsing

```5:25:src/index.ts
const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg === "-h") {
      flags.help = true;
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

const flags = parseFlags(args.slice(1));
```

- Subcommand: `args[0]` (e.g. `init`).
- Flags are taken from **`args.slice(1)`** only — positional arguments after the subcommand are not flags; they are ignored for `init` specifically (unlike `connect`, which reads a project name from `args[1]`).

## Help

If `flags.help` is true, `command` is set, and `COMMAND_HELP[command]` exists, the matching help text is printed and the process returns without running the command.

## Dispatch to `init`

```309:316:src/index.ts
    case "init": {
      const { initCommand } = await import("./commands/init");
      await initCommand({
        team: flags.team as string | undefined,
        json: !!flags.json,
        skills: !!flags.skills,
      });
      break;
    }
```

- **Dynamic import** loads `./commands/init` only when `init` runs.
- Options passed through:
  - `team` — string from `--team=<code>` (or undefined).
  - `json` — true if `--json` present.
  - `skills` — true if `--skills` present.

## Related strings

- `COMMAND_HELP.init` documents `jin init` flags for `jin help init` / `jin init -h`.
- Global `usage()` mentions `jin init` in getting-started and quick-start lines.

## See also

- [00-jin-init-first-run.md](./00-jin-init-first-run.md) — full first-run flow.
- [command-init.md](./command-init.md) — what `initCommand` does internally.
