import { useState } from "react";
import { Link } from "react-router-dom";
import type { MessageItem, SessionSummary } from "@/lib/api";
import { cn, formatTokens, timeAgo } from "@/lib/utils";
import ToolUseBlock from "./ToolUseBlock";
import ThinkingBlock from "./ThinkingBlock";

interface MessageThreadProps {
  messages: MessageItem[];
  children?: SessionSummary[];
}

/** Try to parse a Task tool use and extract the sub-agent description */
function parseTaskToolUse(toolUse: { name: string; input: string; output: string }) {
  if (toolUse.name !== "Task") return null;
  try {
    const inp = JSON.parse(toolUse.input);
    return {
      description: inp.description || inp.prompt?.slice(0, 80) || "Sub-agent",
      prompt: inp.prompt || "",
      subagentType: inp.subagent_type || inp.subagentType || "",
      output: toolUse.output,
    };
  } catch {
    return null;
  }
}

export default function MessageThread({ messages, children }: MessageThreadProps) {
  // Build a map of child sessions by name fragment for linking
  const childMap = new Map<string, SessionSummary>();
  if (children) {
    for (const child of children) {
      // Index by first 40 chars of name for fuzzy matching with Task descriptions
      childMap.set(child.id, child);
    }
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          index={idx}
          childSessions={children || []}
        />
      ))}
    </div>
  );
}

function MessageBubble({
  msg,
  index,
  childSessions,
}: {
  msg: MessageItem;
  index: number;
  childSessions: SessionSummary[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Separate Task tool uses from regular ones
  const taskTools: ReturnType<typeof parseTaskToolUse>[] = [];
  const regularTools: typeof msg.toolUses = [];

  for (const tu of msg.toolUses) {
    const parsed = parseTaskToolUse(tu);
    if (parsed) {
      taskTools.push(parsed);
    } else {
      regularTools.push(tu);
    }
  }

  // System messages get minimal styling
  if (msg.role === "system") {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-zinc-600">
        <span className="w-12 shrink-0 text-right tabular-nums text-zinc-700">
          #{index + 1}
        </span>
        <div className="h-px flex-1 bg-zinc-800/60" />
        <span className="italic">{msg.content?.slice(0, 80) || "system"}</span>
        <div className="h-px flex-1 bg-zinc-800/60" />
      </div>
    );
  }

  const isUser = msg.role === "user";

  return (
    <div className="flex gap-2">
      {/* Index + role indicator */}
      <div className="flex flex-col items-center pt-3 shrink-0 w-12">
        <span className="text-[10px] tabular-nums text-zinc-700">#{index + 1}</span>
        <div
          className={cn(
            "w-2 h-2 rounded-full mt-1",
            isUser ? "bg-blue-500/60" : "bg-emerald-500/60"
          )}
        />
      </div>

      {/* Message body */}
      <div
        className={cn(
          "flex-1 rounded-lg border px-4 py-3 min-w-0",
          isUser
            ? "border-zinc-700/60 bg-zinc-800/30"
            : "border-zinc-800/60 bg-zinc-900/40"
        )}
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wide",
                isUser ? "text-blue-400/80" : "text-emerald-400/80"
              )}
            >
              {msg.role}
            </span>
            {msg.model && (
              <span className="text-[10px] text-zinc-600 truncate">{msg.model}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(msg.inputTokens > 0 || msg.outputTokens > 0) && (
              <span className="text-[10px] text-zinc-600 tabular-nums">
                {formatTokens(msg.inputTokens)}in {formatTokens(msg.outputTokens)}out
              </span>
            )}
            {msg.timestamp && (
              <span className="text-[10px] text-zinc-700">{timeAgo(msg.timestamp)}</span>
            )}
            {msg.content && msg.content.length > 200 && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="text-[10px] text-zinc-600 hover:text-zinc-400"
              >
                {collapsed ? "expand" : "collapse"}
              </button>
            )}
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
        {msg.content && !collapsed && (
          <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
            {msg.content.length > 4000
              ? msg.content.slice(0, 4000) + "\n\n… (truncated)"
              : msg.content}
          </div>
        )}
        {collapsed && (
          <div className="text-xs text-zinc-600 italic">
            {msg.content.length} chars (collapsed)
          </div>
        )}

        {/* Sub-agent (Task) tool uses — rendered as linked cards */}
        {taskTools.length > 0 && (
          <div className="mt-3 space-y-2">
            {taskTools.map((task, i) => (
              <SubAgentCard
                key={i}
                task={task!}
                childSessions={childSessions}
              />
            ))}
          </div>
        )}

        {/* Regular tool uses */}
        {regularTools.length > 0 && (
          <div className="mt-2 space-y-1">
            {regularTools.map((tu) => (
              <ToolUseBlock key={tu.id} toolUse={tu} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SubAgentCard({
  task,
  childSessions,
}: {
  task: { description: string; prompt: string; subagentType: string; output: string };
  childSessions: SessionSummary[];
}) {
  const [showOutput, setShowOutput] = useState(false);

  // Try to find a matching child session by matching the prompt/description
  const matchedChild = childSessions.find((c) => {
    const name = (c.name || "").toLowerCase();
    const desc = task.description.toLowerCase();
    const promptStart = task.prompt.slice(0, 60).toLowerCase();
    return name.includes(desc) || name.includes(promptStart) || desc.includes(name.slice(0, 30));
  });

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-amber-400/70 text-xs">↳</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80 font-medium">
          sub-agent
        </span>
        {task.subagentType && (
          <span className="text-[10px] text-zinc-600">{task.subagentType}</span>
        )}
        <span className="text-xs text-zinc-300 truncate flex-1">
          {task.description}
        </span>
        {matchedChild && (
          <Link
            to={`/sessions/${matchedChild.id}`}
            className="text-[10px] px-2 py-0.5 rounded bg-jin-500/15 text-jin-400 hover:bg-jin-500/25 transition-colors whitespace-nowrap"
          >
            View session →
          </Link>
        )}
        {task.output && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            {showOutput ? "hide" : "result"}
          </button>
        )}
      </div>

      {/* Matched child stats */}
      {matchedChild && (
        <div className="flex items-center gap-3 px-3 pb-2 text-[10px] text-zinc-600">
          <span>{matchedChild.messageCount} msgs</span>
          <span>{formatTokens(matchedChild.totalTokens)} tokens</span>
        </div>
      )}

      {showOutput && task.output && (
        <div className="border-t border-amber-500/10 px-3 py-2">
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
            {task.output.length > 2000
              ? task.output.slice(0, 2000) + "\n… (truncated)"
              : task.output}
          </pre>
        </div>
      )}
    </div>
  );
}
