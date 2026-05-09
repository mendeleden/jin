#!/usr/bin/env bun

import { cpSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DESKTOP_DIR = join(ROOT, "desktop");
const DIST_DIR = join(DESKTOP_DIR, "dist");

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

await buildEntry({
  entrypoint: "main.ts",
  outfile: "main.js",
  target: "node",
  format: "esm",
  external: ["electron"],
});
await buildEntry({
  entrypoint: "preload.ts",
  outfile: "preload.cjs",
  target: "node",
  format: "cjs",
  external: ["electron"],
});
await buildEntry({
  entrypoint: "renderer.ts",
  outfile: "renderer.js",
  target: "browser",
  format: "esm",
  external: [],
});

cpSync(join(DESKTOP_DIR, "index.html"), join(DIST_DIR, "index.html"));
cpSync(join(DESKTOP_DIR, "styles.css"), join(DIST_DIR, "styles.css"));

interface BuildEntryOptions {
  entrypoint: string;
  outfile: string;
  target: "browser" | "node";
  format: "cjs" | "esm";
  external: string[];
}

async function buildEntry(options: BuildEntryOptions): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(DESKTOP_DIR, options.entrypoint)],
    target: options.target,
    format: options.format,
    external: options.external,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const output = result.outputs[0];
  if (!output) {
    console.error(`No build output generated for ${options.entrypoint}`);
    process.exit(1);
  }

  await Bun.write(join(DIST_DIR, options.outfile), output);
}
