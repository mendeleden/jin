# Installation

## One-liner

```sh
curl -fsSL https://jin.builtbyeden.app/install.sh | sh
```

This downloads a pre-built binary for your platform (macOS/Linux, x64/ARM64) or builds from source if no binary is available.

## Build from source

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/mendeleden/jin.git
cd jin
bun install
bun run build
# binary is at ./jin — move it to your PATH
mv jin ~/.local/bin/
```

## Verify

```sh
jin version
```
