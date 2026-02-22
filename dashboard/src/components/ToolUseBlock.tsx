import { useState } from "react";

interface ToolUseBlockProps {
  toolUse: { id: string; name: string; input: string; output: string };
}

export default function ToolUseBlock({ toolUse }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-zinc-700/50 bg-zinc-800/30 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-700/20 transition-colors"
      >
        <span className="text-amber-400/80">{expanded ? "▾" : "▸"}</span>
        <span className="text-amber-400/80 font-mono">{toolUse.name}</span>
        <span className="text-zinc-600 truncate flex-1">{toolUse.id}</span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-700/50 px-3 py-2 space-y-2">
          {toolUse.input && (
            <div>
              <span className="text-zinc-500 text-[10px] uppercase">Input</span>
              <pre className="mt-0.5 text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {toolUse.input.length > 2000
                  ? toolUse.input.slice(0, 2000) + "\n… (truncated)"
                  : toolUse.input}
              </pre>
            </div>
          )}
          {toolUse.output && (
            <div>
              <span className="text-zinc-500 text-[10px] uppercase">Output</span>
              <pre className="mt-0.5 text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {toolUse.output.length > 2000
                  ? toolUse.output.slice(0, 2000) + "\n… (truncated)"
                  : toolUse.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
