#!/usr/bin/env bun

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { build as buildVite } from "vite";

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
await buildRenderer();

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

async function buildRenderer(): Promise<void> {
  await buildVite({
    appType: "spa",
    base: "./",
    build: {
      cssCodeSplit: false,
      emptyOutDir: false,
      outDir: DIST_DIR,
      rollupOptions: {
        input: join(DESKTOP_DIR, "index.html"),
        output: {
          assetFileNames(assetInfo) {
            return assetInfo.name?.endsWith(".css")
              ? "styles.css"
              : "assets/[name]-[hash][extname]";
          },
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "renderer.js",
        },
      },
    },
    clearScreen: false,
    configFile: false,
    plugins: [react(), tailwindcss()],
    root: DESKTOP_DIR,
  });
}
