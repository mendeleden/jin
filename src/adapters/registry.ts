import type { Adapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code";
import { CursorAdapter } from "./cursor";
import { CodexAdapter } from "./codex";
import { WarpAdapter } from "./warp";
import { GeminiCliAdapter } from "./gemini-cli";
import { KiroAdapter } from "./kiro";
import { AmpAdapter } from "./amp";
import { OpenCodeAdapter } from "./opencode";
import { PiAdapter } from "./pi";
import { PiAgentAdapter } from "./piagent";

export function allAdapters(): Adapter[] {
  return [
    new ClaudeCodeAdapter(),
    new CursorAdapter(),
    new CodexAdapter(),
    new WarpAdapter(),
    new GeminiCliAdapter(),
    new KiroAdapter(),
    new AmpAdapter(),
    new OpenCodeAdapter(),
    new PiAdapter(),
    new PiAgentAdapter(),
  ];
}

export async function detectAdapters(): Promise<Adapter[]> {
  const adapters = allAdapters();
  const detected: Adapter[] = [];
  for (const a of adapters) {
    try {
      if (await a.detect()) {
        detected.push(a);
      }
    } catch {
      // skip failed detection
    }
  }
  return detected;
}
