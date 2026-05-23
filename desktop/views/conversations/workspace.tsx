import type { ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Conversation, Message } from "../../../src/contracts/conversations";
import type {
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopTreeView,
} from "../../../src/contracts/desktop";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatMetricNumber,
  formatNumber,
  shortId,
  type DesktopConversationSubview,
  type RendererState,
} from "../../renderer";
import { RuntimeStateGate } from "../../components/shell/status-panels";
import type {
  DesktopShellActions,
  MaybePromise,
} from "../../components/shell/actions";
import { Button } from "../../ui/button";
import { cx } from "../../ui/classnames";
import {
  Eyebrow,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "../../ui/panel";
import {
  EmptyState,
  ListPlaceholder,
  PreformattedText,
} from "../../ui/primitives";
import { formatProjectReference } from "../../ui/project-reference";

const TIME_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All time", value: "" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];
const TREE_DEPTH_CLASS_MAX = 12;
const SURFACE_CLASS =
  "rounded-[var(--radius-panel)] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] shadow-[var(--shadow)]";
const SELECT_FIELD_CLASS =
  "w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-white/[0.03] px-2 py-1.5 text-[var(--text)] transition-colors hover:border-[var(--line-strong)]";
const FILTER_FIELD_CLASS =
  "flex flex-col gap-1.5 text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]";
const ROW_BASE_CLASS =
  "grid w-full cursor-pointer content-start overflow-hidden rounded-[11px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] px-[9px] py-2 text-left shadow-none";
const ROW_SELECTED_CLASS =
  "border-[rgba(137,212,161,0.28)] bg-[linear-gradient(90deg,rgba(137,212,161,0.1),rgba(255,255,255,0.025)),linear-gradient(180deg,rgba(18,25,29,0.98),rgba(12,18,23,0.98))] shadow-[inset_2px_0_0_rgba(137,212,161,0.78),0_8px_20px_rgba(0,0,0,0.16)]";
const ROW_TOP_CLASS = "flex min-w-0 items-start justify-between gap-2.5";
const ROW_TITLE_CLASS =
  "line-clamp-2 min-w-0 overflow-hidden text-[0.8rem] font-semibold leading-[1.22] tracking-normal";
const ROW_META_CLASS =
  "mt-[5px] flex flex-wrap gap-x-[9px] gap-y-1.5 text-[0.68rem] text-[var(--text-dim)]";
const ROW_FOOT_CLASS =
  "mt-[5px] grid grid-cols-[auto_minmax(0,1fr)] gap-x-[9px] gap-y-1.5 text-[0.68rem] text-[var(--text-dim)]";
const CHIP_CLASS =
  "inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--line)] bg-white/[0.03] px-2 py-[5px] text-[0.72rem] text-[var(--text-soft)]";
const ICON_BUTTON_CLASS =
  "inline-flex h-8 min-w-8 flex-none cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.03] p-0 text-[var(--text-soft)] hover:border-[var(--line-strong)] hover:text-[var(--text)] [&_svg]:h-[15px] [&_svg]:w-[15px]";
const TREE_DEPTH_CLASSES = [
  "pl-3",
  "pl-[30px]",
  "pl-12",
  "pl-[66px]",
  "pl-[84px]",
  "pl-[102px]",
  "pl-[120px]",
  "pl-[138px]",
  "pl-[156px]",
  "pl-[174px]",
  "pl-[192px]",
  "pl-[210px]",
  "pl-[228px]",
] as const;

export function ConversationsWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  return (
    <RuntimeStateGate
      actions={actions}
      state={state}
      stopped={{
        description:
          "Start the daemon to load the library, selected conversation timeline, trace, and tree views.",
        label: "Conversations",
        title: "Conversation browsing is paused while Jin is stopped.",
      }}
      transition={{
        label: "Conversations",
        startingDescription: "The library will populate once the daemon is queryable.",
        stoppingDescription: "The library is paused until shutdown completes.",
      }}
    >
      {() => (
        <section
          className={cx(
            "grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden max-[880px]:grid-cols-1 max-[880px]:grid-rows-[auto] max-[880px]:overflow-auto",
            state.inspectorCollapsed
              ? "grid-cols-[320px_minmax(0,1fr)_64px] max-[1480px]:grid-cols-[304px_minmax(0,1fr)_64px] max-[1220px]:grid-cols-[282px_minmax(0,1fr)_64px]"
              : "grid-cols-[320px_minmax(0,1fr)_232px] max-[1480px]:grid-cols-[304px_minmax(0,1fr)_220px] max-[1220px]:grid-cols-[282px_minmax(0,1fr)_204px]",
          )}
          data-conversation-workspace
          data-inspector-state={state.inspectorCollapsed ? "collapsed" : "expanded"}
        >
          <ConversationWorkspaceToolbar actions={actions} state={state} />
          <aside
            className={cx(
              SURFACE_CLASS,
              "flex h-full min-h-0 flex-col overflow-hidden p-2.5 max-[880px]:h-auto max-[880px]:min-h-[180px]",
            )}
            data-library-panel
          >
            <PanelHeader
              actions={
                <PanelMeta>
                {state.library
                  ? `${formatNumber(state.library.conversations.length)} shown`
                  : state.libraryLoading
                    ? "Loading..."
                    : "Waiting"}
                </PanelMeta>
              }
              className="mb-3"
            >
              <Eyebrow>Library</Eyebrow>
              <PanelTitle>Index</PanelTitle>
            </PanelHeader>
            <ConversationLibrary actions={actions} state={state} />
          </aside>

          <section
            className={cx(
              SURFACE_CLASS,
              "h-full min-h-0 overflow-hidden p-0 max-[880px]:h-auto max-[880px]:min-h-[180px]",
            )}
            data-detail-panel
          >
            <ConversationDetailSurface actions={actions} state={state} />
          </section>

          {state.inspectorCollapsed ? (
            <InspectorRail actions={actions} />
          ) : (
            <aside
              className={cx(
                SURFACE_CLASS,
                "flex h-full min-h-0 flex-col overflow-hidden border-[rgba(216,226,244,0.12)] bg-[linear-gradient(180deg,rgba(13,18,27,0.96),rgba(7,10,16,0.96)),linear-gradient(90deg,rgba(137,180,255,0.08),transparent_22%)] p-2 max-[880px]:h-auto max-[880px]:min-h-[180px]",
              )}
              data-inspector-panel
            >
              <ConversationInspector actions={actions} state={state} />
            </aside>
          )}
        </section>
      )}
    </RuntimeStateGate>
  );
}

function ConversationWorkspaceToolbar({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const shown = state.library?.conversations.length ?? 0;
  const totalLabel = state.library
    ? `${formatNumber(shown)} shown`
    : state.libraryLoading
      ? "Loading..."
      : "Waiting";

  return (
    <div
      className={cx(
        "col-span-full grid min-w-0 grid-cols-[minmax(190px,1fr)_minmax(300px,auto)_minmax(280px,auto)] items-center gap-2.5 rounded-[13px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(14,19,29,0.88),rgba(8,12,18,0.88))] px-2.5 py-2 shadow-[var(--shadow)] max-[1220px]:grid-cols-[minmax(180px,1fr)_minmax(260px,1fr)] max-[880px]:grid-cols-1",
      )}
      data-conversation-toolbar
    >
      <div className="grid min-w-0 grid-cols-[auto_auto_1fr] items-baseline gap-[9px] max-[880px]:grid-cols-1 max-[880px]:gap-[3px]">
        <Eyebrow>Workspace</Eyebrow>
        <strong className="truncate text-[0.9rem] text-[var(--text)]">
          Conversation index
        </strong>
        <span className="truncate text-[0.74rem] text-[var(--text-dim)]">
          {totalLabel}
        </span>
      </div>
      <ConversationFilters actions={actions} state={state} />
      <RelationshipMix library={state.library} />
    </div>
  );
}

function ConversationFilters({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const adapterOptions = state.library?.availableAdapters ?? [];
  const adapterValue = state.libraryRequest.adapterId ?? "";
  const sinceValue = state.libraryRequest.since ?? "";

  return (
    <div className="grid grid-cols-[repeat(2,minmax(130px,1fr))] gap-[7px] max-[880px]:grid-cols-1">
      <label className={FILTER_FIELD_CLASS}>
        <span>Adapter</span>
        <select
          className={SELECT_FIELD_CLASS}
          onChange={(event) => void actions.setAdapterFilter(event.currentTarget.value)}
          value={adapterValue}
        >
          <option value="">All adapters</option>
          {adapterOptions.map((adapter) => (
            <option key={adapter} value={adapter}>
              {adapter}
            </option>
          ))}
        </select>
      </label>
      <label className={FILTER_FIELD_CLASS}>
        <span>Range</span>
        <select
          className={SELECT_FIELD_CLASS}
          onChange={(event) => void actions.setSinceFilter(event.currentTarget.value)}
          value={sinceValue}
        >
          {TIME_FILTERS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RelationshipMix({
  library,
}: {
  library: DesktopConversationListView | null;
}) {
  const relationships = library?.relationshipMix ?? [];
  if (relationships.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5 max-[1220px]:col-span-full max-[1220px]:justify-start">
      {relationships.map((entry) => (
        <span className={CHIP_CLASS} key={entry.relationship}>
          <span>{entry.relationship}</span>
          <strong>{formatNumber(entry.conversations)}</strong>
        </span>
      ))}
    </div>
  );
}

function ConversationLibrary({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.libraryLoading && !state.library) {
    return <ListPlaceholder />;
  }

  if (state.libraryError && !state.library) {
    return (
      <EmptyState title="Conversation library unavailable">
        <p>{state.libraryError}</p>
        <Button onClick={() => void actions.refreshShell()}>Retry</Button>
      </EmptyState>
    );
  }

  const conversations = state.library?.conversations ?? [];
  if (conversations.length === 0) {
    return (
      <EmptyState title="No conversations match the current filters.">
        <p>
          Desktop is connected, but the library is empty for this adapter/range
          combination.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-h-0 gap-1.5 overflow-auto" data-conversation-list>
      {conversations.map((conversation) => (
        <ConversationRow
          conversation={conversation}
          key={conversation.id}
          onOpen={actions.openConversation}
          selected={conversation.id === state.selectedConversationId}
        />
      ))}
    </div>
  );
}

function ConversationRow({
  conversation,
  onOpen,
  selected,
}: {
  conversation: Conversation;
  onOpen(conversationId: string): MaybePromise;
  selected: boolean;
}) {
  return (
    <button
      className={cx(ROW_BASE_CLASS, "min-h-[88px]", selected && ROW_SELECTED_CLASS)}
      data-conversation-row={conversation.id}
      onClick={() => void onOpen(conversation.id)}
      type="button"
    >
      <div className={ROW_TOP_CLASS}>
        <div className={ROW_TITLE_CLASS} title={conversation.name}>
          {formatConversationTitle(conversation.name)}
        </div>
        <span className={relationshipChipClass(conversation.relationship)}>
          {conversation.relationship}
        </span>
      </div>
      <div className={ROW_META_CLASS}>
        <span>{conversation.adapterId}</span>
        <span>{formatDate(conversation.endedAt || conversation.startedAt)}</span>
        <span>{formatNumber(conversation.messageCount)} msg</span>
        <span>{formatMetricNumber(totalTokens(conversation)).display} tok</span>
      </div>
      <div className={ROW_FOOT_CLASS}>
        <span className="[font-family:var(--mono)]">{shortId(conversation.id)}</span>
        <span className="truncate">
          {formatProjectReference(conversation.gitRemote || conversation.cwd)}
        </span>
      </div>
    </button>
  );
}

function ConversationDetailSurface({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedConversationLoading && !state.detail) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="Loading selected conversation"
      >
        <p>
          Fetching detail, trace, and tree views through the typed daemon
          boundary.
        </p>
      </EmptyState>
    );
  }

  if (state.selectedConversationError && !state.detail) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="Conversation detail unavailable"
      >
        <p>{state.selectedConversationError}</p>
      </EmptyState>
    );
  }

  if (!state.detail) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="Select a conversation"
      >
        <p>
          The detail pane will show timeline, trace, and tree views for the
          selected conversation.
        </p>
      </EmptyState>
    );
  }

  const conversation = state.detail.conversation;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2.5 border-b border-[var(--line)] px-3 py-2.5 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={relationshipChipClass(conversation.relationship)}>
              {conversation.relationship}
            </span>
        <span className="[font-family:var(--mono)]">{shortId(conversation.id)}</span>
          </div>
          <h2
            className="line-clamp-2 m-0 my-[5px] overflow-hidden text-[0.98rem] leading-[1.12] tracking-normal"
            title={conversation.name}
          >
            {formatConversationTitle(conversation.name)}
          </h2>
          <p className="m-0 text-[0.76rem] text-[var(--text-soft)]">
            {renderConversationHeaderSummary(state.detail)}
          </p>
        </div>
        <div
          aria-label="Conversation views"
          className="flex flex-wrap gap-1.5"
          role="tablist"
        >
          <SubviewTab
            actions={actions}
            label="Timeline"
            selectedSubview={state.selectedSubview}
            value="timeline"
          />
          <SubviewTab
            actions={actions}
            label="Trace"
            selectedSubview={state.selectedSubview}
            value="trace"
          />
          <SubviewTab
            actions={actions}
            label="Tree"
            selectedSubview={state.selectedSubview}
            value="tree"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] px-3 py-[7px]">
        <span className={CHIP_CLASS}>
          {formatNumber(conversation.messageCount)} messages
        </span>
        <span className={CHIP_CLASS}>
          {formatNumber(conversation.toolCount)} tools
        </span>
        <span
          className={CHIP_CLASS}
          title={`${formatNumber(totalTokens(conversation))} tokens`}
        >
          {formatMetricNumber(totalTokens(conversation)).display} tokens
        </span>
        <span className={CHIP_CLASS}>{formatCost(conversation.estCost)}</span>
        <span className={CHIP_CLASS}>
          Trace {shortId(state.detail.trace.traceId)}
        </span>
      </div>

      {state.selectedConversationLoading ? (
        <div className="px-4 pt-2.5 text-[0.84rem] text-[var(--text-dim)]">
          Refreshing selected conversation...
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-[9px]">
        <SelectedSubview actions={actions} state={state} />
      </div>
    </div>
  );
}

function SubviewTab({
  actions,
  label,
  selectedSubview,
  value,
}: {
  actions: DesktopShellActions;
  label: string;
  selectedSubview: DesktopConversationSubview;
  value: DesktopConversationSubview;
}) {
  const selected = selectedSubview === value;
  return (
    <button
      aria-selected={selected}
      className={cx(
        "cursor-pointer rounded-[var(--radius-control)] border border-[var(--line)] bg-white/[0.03] px-2 py-[5px] text-[0.78rem] text-[var(--text)] transition-colors hover:border-[var(--line-strong)]",
        selected &&
          "border-[rgba(137,180,255,0.24)] bg-[rgba(137,180,255,0.1)] text-[var(--accent-strong)]",
      )}
      onClick={() => actions.selectSubview(value)}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function SelectedSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedSubview === "trace") {
    return <TraceSubview actions={actions} state={state} />;
  }

  if (state.selectedSubview === "tree") {
    return <TreeSubview actions={actions} state={state} />;
  }

  return <TimelineSubview detail={state.detail!} />;
}

function TimelineSubview({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  if (detail.messages.length === 0) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="No messages recorded"
      >
        <p>
          This conversation exists in the trace graph but currently has no
          stored message timeline.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-1.5">
      {detail.messages.map((message) => (
        <MessageCard key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  const metadata = messageMetadata(message);

  return (
    <article className="rounded-[10px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] px-[9px] py-2 shadow-none">
      <div className="mb-[5px] flex justify-between gap-2.5">
        <div className={messageRoleClass(message.role)}>{message.role}</div>
        {metadata.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-1.5 text-[0.68rem] text-[var(--text-dim)]">
            {metadata.map((entry) => (
              <span key={entry}>{entry}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="text-[0.88rem] leading-normal text-[var(--text-soft)]">
        <PreformattedText value={message.content} />
      </div>
      {message.thinkingContent ? <ThinkingBlock message={message} /> : null}
      {message.toolUses.length > 0 ? (
        <div className="mt-[9px] grid gap-1.5">
          {message.toolUses.map((tool) => (
            <ToolCallBlock
              input={tool.input}
              isError={tool.isError}
              key={tool.id}
              name={tool.name}
              output={tool.output}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ThinkingBlock({ message }: { message: Message }) {
  return (
    <details className="mt-0 rounded-[10px] border border-[var(--line)] bg-white/[0.025] px-2.5 py-2">
      <summary className="cursor-pointer text-[0.86rem] font-semibold text-[var(--text)]">
        Thinking {message.thinkingTokens > 0 ? `(${formatNumber(message.thinkingTokens)} tok)` : ""}
      </summary>
      <div className="mt-1.5 leading-[1.55] text-[var(--text-soft)]">
        <PreformattedText value={message.thinkingContent} />
      </div>
    </details>
  );
}

function ToolCallBlock({
  input,
  isError,
  name,
  output,
}: {
  input: string;
  isError: boolean;
  name: string;
  output: string;
}) {
  return (
    <details
      className={cx(
        "rounded-[10px] border border-[var(--line)] bg-white/[0.025] px-2.5 py-2",
        isError && "border-[rgba(255,143,132,0.22)]",
      )}
    >
      <summary className="cursor-pointer text-[0.86rem] font-semibold text-[var(--text)]">
        {name}
        {isError ? " - error" : ""}
      </summary>
      {input ? (
        <>
          <div className="mt-2.5 text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
            Input
          </div>
          <div className="mt-1.5 leading-[1.55] text-[var(--text-soft)]">
            <PreformattedText value={input} />
          </div>
        </>
      ) : null}
      {output ? (
        <>
          <div className="mt-2.5 text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
            Output
          </div>
          <div className="mt-1.5 leading-[1.55] text-[var(--text-soft)]">
            <PreformattedText value={output} />
          </div>
        </>
      ) : null}
    </details>
  );
}

function TraceSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const trace = state.trace;
  if (!trace || trace.conversations.length === 0) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="No trace graph available"
      >
        <p>
          The selected conversation has no related trace conversations to
          display.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-h-0 gap-1.5 overflow-auto" data-trace-list>
      {trace.conversations.map((entry) => {
        const conversation = entry.conversation;
        const selected = conversation.id === state.selectedConversationId;
        return (
          <button
            className={cx(ROW_BASE_CLASS, "min-h-[70px]", selected && ROW_SELECTED_CLASS)}
            data-trace-row={conversation.id}
            key={conversation.id}
            onClick={() => void actions.openConversation(conversation.id)}
            type="button"
          >
            <div className={ROW_TOP_CLASS}>
              <div className={ROW_TITLE_CLASS} title={conversation.name}>
                {formatConversationTitle(conversation.name)}
              </div>
              <span className={relationshipChipClass(conversation.relationship)}>
                {conversation.relationship}
              </span>
            </div>
            <div className={ROW_META_CLASS}>
              <span>{conversation.adapterId}</span>
              <span>{formatNumber(conversation.messageCount)} msg</span>
              <span>{formatNumber(conversation.toolCount)} tools</span>
              <span>{formatDate(conversation.startedAt)}</span>
            </div>
            <div className={ROW_FOOT_CLASS}>
              <span className="[font-family:var(--mono)]">{shortId(conversation.id)}</span>
              <span>{conversation.model || "unknown model"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TreeSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const tree = state.tree?.tree ?? null;
  if (!tree) {
    return (
      <EmptyState
        className="flex min-h-[260px] flex-col justify-center p-[18px]"
        title="No tree view available"
      >
        <p>
          The selected conversation trace does not currently resolve to a rooted
          tree.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-2">
      <TreeNode
        onOpen={actions.openConversation}
        node={tree}
        selectedConversationId={state.selectedConversationId}
      />
    </div>
  );
}

function TreeNode({
  depth = 0,
  node,
  onOpen,
  selectedConversationId,
}: {
  depth?: number;
  node: NonNullable<DesktopTreeView["tree"]>;
  onOpen(conversationId: string): MaybePromise;
  selectedConversationId: string | null;
}) {
  const selected = node.conversation.id === selectedConversationId;

  return (
    <div className="grid gap-2">
      <button
        className={cx(
          ROW_BASE_CLASS,
          "min-h-14",
          treeDepthClass(depth),
          selected && ROW_SELECTED_CLASS,
        )}
        data-tree-node={node.conversation.id}
        onClick={() => void onOpen(node.conversation.id)}
        type="button"
      >
        <div className={ROW_TOP_CLASS}>
          <span className={ROW_TITLE_CLASS} title={node.conversation.name}>
            {formatConversationTitle(node.conversation.name)}
          </span>
          <span className={relationshipChipClass(node.conversation.relationship)}>
            {node.conversation.relationship}
          </span>
        </div>
        <div className={ROW_META_CLASS}>
          <span>{node.conversation.adapterId}</span>
          <span>{formatNumber(node.conversation.messageCount)} msg</span>
          <span>{formatDate(node.conversation.startedAt)}</span>
        </div>
      </button>
      {node.children.length > 0 ? (
        <div className="grid gap-2">
          {node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              key={child.conversation.id}
              onOpen={onOpen}
              node={child}
              selectedConversationId={selectedConversationId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConversationInspector({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const detail = state.detail;
  if (!detail) {
    return (
      <div className="flex min-h-[260px] flex-col justify-center rounded-[var(--radius-panel)] p-[18px]">
        <button
          aria-label="Collapse metadata inspector"
          className={ICON_BUTTON_CLASS}
          onClick={() => actions.toggleInspector()}
          title="Collapse metadata inspector"
          type="button"
        >
          <PanelRightClose aria-hidden="true" />
        </button>
        <h3 className="my-2.5 mb-2 text-[1.2rem] tracking-normal">
          Metadata inspector
        </h3>
        <p className="m-0 leading-[1.55] text-[var(--text-soft)]">
          Select a conversation to inspect identity, trace linkage, tokens,
          cost, and project metadata.
        </p>
      </div>
    );
  }

  const { conversation } = detail;

  return (
    <div className="flex h-full min-h-0 flex-col gap-[3px] overflow-auto">
      <PanelHeader
        actions={
          <>
          <PanelMeta>{conversation.adapterId}</PanelMeta>
          <button
            aria-label="Collapse metadata inspector"
            className={ICON_BUTTON_CLASS}
            onClick={() => actions.toggleInspector()}
            title="Collapse metadata inspector"
            type="button"
          >
            <PanelRightClose aria-hidden="true" />
          </button>
          </>
        }
        className="mb-3"
      >
        <Eyebrow>Inspector</Eyebrow>
        <PanelTitle>Metadata</PanelTitle>
      </PanelHeader>

      <InspectorSection title="Identity">
        <InspectorRow label="Conversation ID" mono value={shortId(conversation.id)} />
        <InspectorRow label="Trace ID" mono value={shortId(detail.trace.traceId)} />
        <InspectorRow label="Root ID" mono value={shortId(detail.trace.rootId)} />
        <InspectorRow label="Relationship" value={conversation.relationship} />
      </InspectorSection>

      <InspectorSection title="Runtime">
        <InspectorRow label="Model" value={conversation.model || "unknown"} />
        <InspectorRow label="Started" value={formatDate(conversation.startedAt)} />
        <InspectorRow
          label="Ended"
          value={formatDate(conversation.endedAt || conversation.startedAt)}
        />
        <InspectorRow
          label="Duration"
          value={formatDuration(conversation.durationMs)}
        />
      </InspectorSection>

      <InspectorSection title="Usage">
        <InspectorRow
          label="Messages"
          value={formatNumber(conversation.messageCount)}
        />
        <InspectorRow
          label="Tool calls"
          value={formatNumber(conversation.toolCount)}
        />
        <InspectorRow
          label="Display tokens"
          value={formatMetricNumber(conversation.inputTokens + conversation.outputTokens).display}
        />
        <InspectorRow
          label="Cache tokens"
          value={formatMetricNumber(conversation.cacheRead + conversation.cacheWrite).display}
        />
        <InspectorRow
          label="Estimated cost"
          value={formatCost(conversation.estCost)}
        />
      </InspectorSection>

      <InspectorSection title="Lineage">
        <InspectorRow
          label="Parent"
          value={detail.parent ? detail.parent.name : "None"}
        />
        <InspectorRow
          label="Children"
          value={
            detail.children.length === 0
              ? "None"
              : detail.children.map((child) => child.name).join(", ")
          }
        />
        <InspectorRow
          label="Trace size"
          value={`${formatNumber(detail.trace.conversationCount)} conversations`}
        />
      </InspectorSection>

      <InspectorSection title="Project">
        <InspectorRow
          label="Remote"
          value={conversation.gitRemote || "local / unlinked"}
        />
        <InspectorRow label="Branch" value={conversation.branch || "unknown"} />
        <InspectorRow
          label="Path"
          value={conversation.cwd || conversation.sourcePath}
        />
        <InspectorRow label="Source format" value={conversation.sourceFormat} />
      </InspectorSection>
    </div>
  );
}

function InspectorRail({ actions }: { actions: DesktopShellActions }) {
  return (
    <aside
      className={cx(
        SURFACE_CLASS,
        "flex h-full min-h-0 items-start justify-center p-2.5 px-[7px] max-[1220px]:min-h-[54px] max-[1220px]:items-center max-[880px]:h-auto max-[880px]:min-h-[180px]",
      )}
      data-inspector-rail
    >
      <button
        aria-label="Expand metadata inspector"
        className="inline-flex h-auto min-h-28 w-full min-w-0 flex-col items-center justify-center gap-[7px] rounded-xl border border-[var(--line)] bg-white/[0.03] px-1 py-2 text-[var(--text-soft)] hover:border-[var(--line-strong)] hover:text-[var(--text)] max-[880px]:min-h-[52px] [&_svg]:h-[15px] [&_svg]:w-[15px]"
        onClick={() => actions.toggleInspector()}
        title="Expand metadata inspector"
        type="button"
      >
        <PanelRightOpen aria-hidden="true" />
        <span className="text-[0.62rem] font-bold uppercase tracking-normal text-[var(--text-dim)] [writing-mode:vertical-rl] max-[880px]:[writing-mode:horizontal-tb]">
          Metadata
        </span>
      </button>
    </aside>
  );
}

function InspectorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="border-t border-[var(--line)] bg-transparent px-0.5 pb-1.5 pt-2">
      <h3 className="m-0 mb-[7px] text-[0.72rem] tracking-normal">{title}</h3>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

function InspectorRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-[7px]">
      <span className="text-[0.62rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
        {label}
      </span>
      <strong
        className={cx(
          "break-words text-[0.74rem] text-[var(--text-soft)]",
          mono && "[font-family:var(--mono)]",
        )}
      >
        {value}
      </strong>
    </div>
  );
}

function formatConversationTitle(value: string): string {
  const compact = value
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s+#+\s+/g, " - ")
    .trim();

  return compact || "Untitled conversation";
}

function messageMetadata(message: Message): string[] {
  const metadata: string[] = [];

  if (Number.isFinite(message.turn) && message.turn >= 0) {
    metadata.push(`Turn ${message.turn}`);
  }

  metadata.push(formatDate(message.timestamp));

  const model = message.model?.trim() ?? "";
  if (model.length > 0) {
    metadata.push(model);
  }

  return metadata;
}

function renderConversationHeaderSummary(
  detail: DesktopConversationDetailView,
): string {
  const parentSummary = detail.parent
    ? `Parent ${shortId(detail.parent.id)}`
    : "Root conversation";
  const childSummary =
    detail.children.length > 0
      ? `${formatNumber(detail.children.length)} child conversation${
          detail.children.length === 1 ? "" : "s"
        }`
      : "No child conversations";

  return `${parentSummary} - ${childSummary} - ${formatNumber(
    detail.trace.conversationCount,
  )} conversations in trace`;
}

function totalTokens(conversation: Conversation): number {
  return (
    conversation.inputTokens +
    conversation.outputTokens +
    conversation.cacheRead +
    conversation.cacheWrite
  );
}

function relationshipChipClass(relationship: string): string {
  return cx(
    "inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[0.66rem] font-bold uppercase tracking-normal",
    relationship === "root" && "bg-[rgba(137,212,161,0.14)] text-[var(--success)]",
    relationship === "compacted" && "bg-[rgba(240,196,109,0.14)] text-[var(--warning)]",
    (relationship === "spawned" || relationship === "forked") &&
      "bg-[rgba(255,143,132,0.14)] text-[var(--danger)]",
    relationship !== "root" &&
      relationship !== "compacted" &&
      relationship !== "spawned" &&
      relationship !== "forked" &&
      "bg-white/[0.03] text-[var(--text-soft)]",
  );
}

function messageRoleClass(role: Message["role"]): string {
  return cx(
    "rounded-full px-2 py-[3px] text-[0.64rem] font-bold uppercase tracking-normal",
    role === "user" && "bg-[rgba(137,180,255,0.16)] text-[var(--accent-strong)]",
    role === "assistant" && "bg-[rgba(137,212,161,0.14)] text-[var(--success)]",
    role === "system" && "bg-[rgba(240,196,109,0.14)] text-[var(--warning)]",
  );
}

function treeDepthClass(depth: number): string {
  if (!Number.isFinite(depth) || depth <= 0) {
    return TREE_DEPTH_CLASSES[0];
  }

  return (
    TREE_DEPTH_CLASSES[Math.min(TREE_DEPTH_CLASS_MAX, Math.floor(depth))] ??
    TREE_DEPTH_CLASSES[0]
  );
}
