---
title: Install jin
description: Install the jin CLI and verify that your local AI coding sessions can be indexed.
sidebar:
  order: 1
---


Install the CLI with the one-line installer:

```sh
curl -fsSL https://jin.builtbyeden.app/install.sh | sh
```

On Windows PowerShell:

```powershell
irm https://jin.builtbyeden.app/install.ps1 | iex
```

## Verify the binary

```sh
jin --version
jin status
```

## Build from source

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/mendeleden/jin.git
cd jin
bun install
bun run build
mv jin ~/.local/bin/
```

## Next step

Run `jin init` to detect your local AI coding tools and create the initial config.
