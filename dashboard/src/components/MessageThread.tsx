import type { MessageItem } from "@/lib/api";
import { cn, formatTokens, timeAgo } from "@/lib/utils";
import ToolUseBlock from "./ToolUseBlock";
import ThinkingBlock from "./ThinkingBlock";

interface MessageThreadProps {
  messages: MessageItem[];
}

export default function MessageThread({ messages }: MessageThreadProps) {
  return (
    <div className="space-y-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "rounded-lg border px-4 py-3",
            msg.role === "user"
              ? "border-zinc-700 bg-zinc-800/40"
              : msg.role === "assistant"
              ? "border-zinc-800 bg-zinc-900/60"
              : "border-zinc-800/50 bg-zinc-900/30"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded",
                  msg.role === "user"
                    ? "bg-blue-500/15 text-blue-400"
                    : msg.role === "assistant"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-zinc-700 text-zinc-400"
                )}
              >
                {msg.role}
              </span>
              {msg.model && (
                <span className="text-[10px] text-zinc-500">{msg.model}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              {(msg.inputTokens > 0 || msg.outputTokens > 0) && (
                <span>
                  {formatTokens(msg.inputTokens)}→{formatTokens(msg.outputTokens)}
                </span>
              )}
              {msg.timestamp && <span>{timeAgo(msg.timestamp)}</span>}
            </div>
          </div>

          {/* Thinking blocks */}
          {msg.thinkingBlocks.length > 0 && (
            <div className="mb-2 space-y-1">
              {msg.thinkingBlocks.map((tb, i) => (
                <ThinkingBlock key={i} block={tb} />
              ))}
            </div>
          )}

          {/* Content */}
          {msg.content && (
            <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
              {msg.content.length > 5000
                ? msg.content.slice(0, 5000) + "\n\n… (truncated)"
                : msg.content}
            </div>
          )}

          {/* Tool uses */}
          {msg.toolUses.length > 0 && (
            <div className="mt-2 space-y-1">
              {msg.toolUses.map((tu) => (
                <ToolUseBlock key={tu.id} toolUse={tu} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
