import { useState } from "react";

interface ToolUseBlockProps {
  toolUse: { id: string; name: string; input: string; output: string };
}

/** Attempt to extract a readable summary from tool input */
function summarizeInput(name: string, input: string): string {
  try {
    const parsed = JSON.parse(input);
    // Common patterns
    if (parsed.command) return parsed.command.slice(0, 80);
    if (parsed.file_path) return parsed.file_path;
    if (parsed.pattern) return parsed.pattern;
    if (parsed.query) return parsed.query.slice(0, 80);
    if (parsed.url) return parsed.url.slice(0, 80);
    if (parsed.path) return parsed.path;
    return "";
  } catch {
    return input.slice(0, 60);
  }
}

export default function ToolUseBlock({ toolUse }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(toolUse.name, toolUse.input);

  return (
    <div className="rounded border border-zinc-700/40 bg-zinc-800/20 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-700/15 transition-colors min-w-0"
      >
        <span className="text-zinc-600 text-[10px]">{expanded ? "▾" : "▸"}</span>
        <span className="text-amber-400/70 font-mono shrink-0">{toolUse.name}</span>
        {summary && (
          <span className="text-zinc-600 truncate">{summary}</span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-zinc-700/40 px-3 py-2 space-y-2">
          {toolUse.input && (
            <div>
              <span className="text-zinc-600 text-[10px] uppercase">Input</span>
              <pre className="mt-0.5 text-zinc-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-[11px]">
                {toolUse.input.length > 2000
                  ? toolUse.input.slice(0, 2000) + "\n… (truncated)"
                  : toolUse.input}
              </pre>
            </div>
          )}
          {toolUse.output && (
            <div>
              <span className="text-zinc-600 text-[10px] uppercase">Output</span>
              <pre className="mt-0.5 text-zinc-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-[11px]">
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
