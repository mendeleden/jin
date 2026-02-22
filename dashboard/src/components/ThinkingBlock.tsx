import { useState } from "react";
import { formatTokens } from "@/lib/utils";

interface ThinkingBlockProps {
  block: { content: string; tokenCount: number };
}

export default function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-purple-500/20 bg-purple-500/5 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/10 transition-colors"
      >
        <span className="text-purple-400/60">{expanded ? "▾" : "▸"}</span>
        <span className="text-purple-400/80">thinking</span>
        <span className="text-zinc-600">{formatTokens(block.tokenCount)} tokens</span>
      </button>
      {expanded && (
        <div className="border-t border-purple-500/20 px-3 py-2">
          <pre className="text-zinc-400 whitespace-pre-wrap break-words max-h-64 overflow-y-auto text-[11px] leading-relaxed">
            {block.content.length > 3000
              ? block.content.slice(0, 3000) + "\n… (truncated)"
              : block.content}
          </pre>
        </div>
      )}
    </div>
  );
}
