import {
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { GitBranch, Search, X } from "lucide-react";
import type { Conversation, Message } from "../../../src/contracts/conversations";
import type {
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopTreeView,
} from "../../../src/contracts/desktop";
import {
  conversationLibraryTotalCount,
  formatCost,
  formatDate,
  formatMetricNumber,
  formatNumber,
  hasConversationLibraryTotal,
  shortId,
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
  "w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] px-2 py-1.5 text-[var(--text)] shadow-[inset_0_1px_0_var(--control-highlight)] transition-colors hover:border-[var(--line-strong)] focus-visible:border-[var(--control-border-hover)] focus-visible:outline-none [&_option]:bg-[var(--bg-elevated)] [&_option]:text-[var(--text)]";
const FILTER_FIELD_CLASS =
  "flex flex-col gap-1.5 text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]";
const ROW_BASE_CLASS =
  "grid w-full cursor-pointer content-start overflow-hidden rounded-[11px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] px-[9px] py-2 text-left shadow-none";
const ROW_SELECTED_CLASS =
  "border-[var(--conversation-row-selected-border)] bg-[var(--conversation-row-selected-bg)] shadow-[var(--conversation-row-selected-shadow)]";
const ROW_TOP_CLASS = "flex min-w-0 items-start justify-between gap-2.5";
const ROW_TITLE_CLASS =
  "line-clamp-2 min-w-0 overflow-hidden text-[0.8rem] font-semibold leading-[1.22] tracking-normal";
const ROW_META_CLASS =
  "mt-[5px] flex flex-wrap gap-x-[9px] gap-y-1.5 text-[0.68rem] text-[var(--text-dim)]";
const ROW_FOOT_CLASS =
  "mt-[5px] grid grid-cols-[auto_minmax(0,1fr)] gap-x-[9px] gap-y-1.5 text-[0.68rem] text-[var(--text-dim)]";
const CHIP_CLASS =
  "inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--item-bg)] px-2 py-[5px] text-[0.72rem] text-[var(--text-soft)]";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [relationshipFilter, setRelationshipFilter] = useState("");
  const conversations = state.library?.conversations ?? [];
  const visibleConversations = useMemo(
    () => filterConversationIndex(conversations, searchQuery, relationshipFilter),
    [conversations, relationshipFilter, searchQuery],
  );
  const trayOpen = Boolean(
    state.detail ||
      state.selectedConversationLoading ||
      state.selectedConversationError,
  );

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
            "relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden max-[880px]:overflow-auto",
            trayOpen && "pb-[348px] max-[880px]:pb-[372px]",
          )}
          data-conversation-workspace
          data-conversation-surface="ops-index"
          data-tray-state={trayOpen ? "open" : "closed"}
        >
          <ConversationIndexPanel
            actions={actions}
            relationshipFilter={relationshipFilter}
            searchQuery={searchQuery}
            setRelationshipFilter={setRelationshipFilter}
            setSearchQuery={setSearchQuery}
            state={state}
            visibleConversations={visibleConversations}
          />
          <ConversationBottomTray actions={actions} state={state} />
        </section>
      )}
    </RuntimeStateGate>
  );
}

function ConversationIndexPanel({
  actions,
  relationshipFilter,
  searchQuery,
  setRelationshipFilter,
  setSearchQuery,
  state,
  visibleConversations,
}: {
  actions: DesktopShellActions;
  relationshipFilter: string;
  searchQuery: string;
  setRelationshipFilter(value: string): void;
  setSearchQuery(value: string): void;
  state: RendererState;
  visibleConversations: Conversation[];
}) {
  const totalLabel = renderConversationIndexCount(
    state.library,
    state.libraryLoading,
    visibleConversations.length,
  );

  return (
    <section
      className={cx(
        SURFACE_CLASS,
        "flex min-h-0 flex-col overflow-hidden",
      )}
      data-conversation-index-panel
    >
      <PanelHeader
        actions={<RelationshipMix library={state.library} />}
        className="mb-0 border-b border-[var(--line)] px-3 py-3"
      >
        <Eyebrow>Conversation Index</Eyebrow>
        <PanelTitle>All conversations</PanelTitle>
        <PanelMeta>{totalLabel}</PanelMeta>
      </PanelHeader>
      <div
        className="grid grid-cols-[minmax(260px,1fr)_minmax(420px,auto)] gap-2.5 border-b border-[var(--line)] bg-[var(--conversation-toolbar-bg)] p-3 max-[1180px]:grid-cols-1"
        data-conversation-toolbar
      >
        <label className="relative min-w-0">
          <span className="sr-only">Search conversation index</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]"
          />
          <input
            aria-label="Search conversation index"
            className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] pl-9 pr-3 text-[var(--text)] shadow-[inset_0_1px_0_var(--control-highlight)] outline-none transition-colors placeholder:text-[var(--text-dim)] hover:border-[var(--line-strong)] focus-visible:border-[var(--control-border-hover)]"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="Search name, project, trace, model..."
            value={searchQuery}
          />
        </label>
        <ConversationFilters
          actions={actions}
          relationshipFilter={relationshipFilter}
          setRelationshipFilter={setRelationshipFilter}
          state={state}
        />
      </div>
      <ConversationIndexTable
        actions={actions}
        searchQuery={searchQuery}
        state={state}
        visibleConversations={visibleConversations}
      />
    </section>
  );
}

function ConversationFilters({
  actions,
  relationshipFilter,
  setRelationshipFilter,
  state,
}: {
  actions: DesktopShellActions;
  relationshipFilter: string;
  setRelationshipFilter(value: string): void;
  state: RendererState;
}) {
  const adapterOptions = state.library?.availableAdapters ?? [];
  const relationshipOptions = relationshipOptionsFor(
    state.library?.conversations ?? [],
  );
  const adapterValue = state.libraryRequest.adapterId ?? "";
  const sinceValue = state.libraryRequest.since ?? "";

  return (
    <div className="grid grid-cols-[repeat(3,minmax(130px,1fr))] gap-[7px] max-[880px]:grid-cols-1">
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
        <span>Relationship</span>
        <select
          className={SELECT_FIELD_CLASS}
          onChange={(event) => setRelationshipFilter(event.currentTarget.value)}
          value={relationshipFilter}
        >
          <option value="">All relationships</option>
          {relationshipOptions.map((relationship) => (
            <option key={relationship} value={relationship}>
              {relationship}
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

function ConversationIndexTable({
  actions,
  searchQuery,
  state,
  visibleConversations,
}: {
  actions: DesktopShellActions;
  searchQuery: string;
  state: RendererState;
  visibleConversations: Conversation[];
}) {
  if (state.libraryLoading && !state.library) {
    return (
      <div className="p-3">
        <ListPlaceholder />
      </div>
    );
  }

  if (state.libraryError && !state.library) {
    return (
      <EmptyState
        className="m-3"
        title="Conversation library unavailable"
      >
        <p>{state.libraryError}</p>
        <Button onClick={() => void actions.refreshShell()}>Retry</Button>
      </EmptyState>
    );
  }

  const conversations = state.library?.conversations ?? [];
  if (conversations.length === 0) {
    return (
      <EmptyState
        className="m-3"
        title="No conversations match the current filters."
      >
        <p>
          Desktop is connected, but the library is empty for this adapter/range
          combination.
        </p>
      </EmptyState>
    );
  }

  if (visibleConversations.length === 0) {
    return (
      <EmptyState
        className="m-3"
        title="No conversations match this search."
      >
        <p>
          Clear the search text or relationship filter to return to the full
          conversation index.
        </p>
      </EmptyState>
    );
  }

  return (
    <div
      className={cx(
        "min-h-0 overflow-auto",
        state.detail && "pb-[360px] max-[880px]:pb-[386px]",
      )}
      data-conversation-list
      data-search-active={String(searchQuery.trim().length > 0)}
    >
      <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-[0.82rem]">
        <thead className="sticky top-0 z-10 bg-[var(--panel-alt)] text-[0.68rem] uppercase tracking-normal text-[var(--text-dim)] shadow-[0_1px_0_var(--line)]">
          <tr>
            <th className="px-3 py-2 font-semibold">Conversation</th>
            <th className="px-3 py-2 font-semibold">Project</th>
            <th className="px-3 py-2 font-semibold">Relationship</th>
            <th className="px-3 py-2 font-semibold">Adapter</th>
            <th className="px-3 py-2 text-right font-semibold">Messages</th>
            <th className="px-3 py-2 text-right font-semibold">Tools</th>
            <th className="px-3 py-2 text-right font-semibold">Tokens</th>
            <th className="px-3 py-2 text-right font-semibold">Cost</th>
            <th className="px-3 py-2 font-semibold">Ended</th>
          </tr>
        </thead>
        <tbody>
          {visibleConversations.map((conversation) => (
            <ConversationTableRow
              conversation={conversation}
              key={conversation.id}
              onOpen={actions.openConversation}
              selected={conversation.id === state.selectedConversationId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConversationTableRow({
  conversation,
  onOpen,
  selected,
}: {
  conversation: Conversation;
  onOpen(conversationId: string): MaybePromise;
  selected: boolean;
}) {
  const openConversation = () => void onOpen(conversation.id);
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openConversation();
  };

  return (
    <tr
      aria-selected={selected}
      className={cx(
        "group cursor-pointer border-b border-[var(--line)] outline-none transition-colors hover:bg-[var(--control-bg-hover)] focus-visible:bg-[var(--control-bg-hover)]",
        selected &&
          "bg-[var(--conversation-row-selected-bg)] shadow-[inset_3px_0_0_var(--picker-selected-border)]",
      )}
      data-conversation-row={conversation.id}
      onClick={openConversation}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
    >
      <td className="max-w-[360px] border-b border-[var(--line)] px-3 py-2.5 align-top">
        <div
          className="line-clamp-2 font-semibold leading-tight text-[var(--text)]"
          title={conversation.name}
        >
          {formatConversationTitle(conversation.name)}
        </div>
        <div className="mt-1 [font-family:var(--mono)] text-[0.68rem] text-[var(--text-dim)]">
          {shortId(conversation.id)}
        </div>
      </td>
      <td className="max-w-[260px] border-b border-[var(--line)] px-3 py-2.5 align-top text-[var(--text-soft)]">
        <span className="line-clamp-2">
          {formatProjectReference(conversation.gitRemote || conversation.cwd)}
        </span>
      </td>
      <td className="border-b border-[var(--line)] px-3 py-2.5 align-top">
        <span className={relationshipChipClass(conversation.relationship)}>
          {conversation.relationship}
        </span>
      </td>
      <td className="border-b border-[var(--line)] px-3 py-2.5 align-top text-[var(--text-soft)]">
        {conversation.adapterId}
      </td>
      <td className="border-b border-[var(--line)] px-3 py-2.5 text-right align-top text-[var(--text-soft)]">
        {formatNumber(conversation.messageCount)}
      </td>
      <td className="border-b border-[var(--line)] px-3 py-2.5 text-right align-top text-[var(--text-soft)]">
        {formatNumber(conversation.toolCount)}
      </td>
      <td
        className="border-b border-[var(--line)] px-3 py-2.5 text-right align-top text-[var(--text-soft)]"
        title={`${formatNumber(totalTokens(conversation))} tokens`}
      >
        {formatMetricNumber(totalTokens(conversation)).display}
      </td>
      <td className="border-b border-[var(--line)] px-3 py-2.5 text-right align-top text-[var(--text-soft)]">
        {formatCost(conversation.estCost)}
      </td>
      <td className="whitespace-nowrap border-b border-[var(--line)] px-3 py-2.5 align-top text-[var(--text-dim)]">
        {formatDate(conversation.endedAt || conversation.startedAt)}
      </td>
    </tr>
  );
}

function ConversationBottomTray({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedConversationLoading && !state.detail) {
    return (
      <aside
        className={bottomTrayClassName(state.sidebarCollapsed)}
        data-conversation-bottom-tray
        data-tray-loading="true"
      >
        <div className="grid h-full place-items-center p-6">
          <EmptyState title="Loading selected conversation">
            <p>
              Fetching detail, trace, and tree views through the typed daemon
              boundary.
            </p>
          </EmptyState>
        </div>
      </aside>
    );
  }

  if (state.selectedConversationError && !state.detail) {
    return (
      <aside
        className={bottomTrayClassName(state.sidebarCollapsed)}
        data-conversation-bottom-tray
        data-tray-error="true"
      >
        <div className="grid h-full place-items-center p-6">
          <EmptyState title="Conversation detail unavailable">
            <p>{state.selectedConversationError}</p>
            <Button onClick={() => actions.closeConversation()}>
              <X aria-hidden="true" />
              Close
            </Button>
          </EmptyState>
        </div>
      </aside>
    );
  }

  if (!state.detail) {
    return null;
  }

  const conversation = state.detail.conversation;

  return (
    <aside
      className={bottomTrayClassName(state.sidebarCollapsed)}
      data-conversation-bottom-tray
    >
      <div className="grid place-items-center pt-2">
        <span
          aria-hidden="true"
          className="h-1 w-12 rounded-full bg-[var(--control-border)]"
        />
      </div>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-[var(--line)] px-4 pb-3 pt-2 max-[980px]:grid-cols-1">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <span className={relationshipChipClass(conversation.relationship)}>
              {conversation.relationship}
            </span>
            <span className={CHIP_CLASS}>{conversation.adapterId}</span>
            <span className={CHIP_CLASS}>selected</span>
          </div>
          <h2
            className="m-0 mt-2 truncate text-[1.06rem] leading-tight tracking-normal text-[var(--text)]"
            title={conversation.name}
          >
            {formatConversationTitle(conversation.name)}
          </h2>
          <p className="m-0 mt-1 text-[0.76rem] text-[var(--text-dim)]">
            {renderConversationHeaderSummary(state.detail)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 max-[980px]:justify-start">
          <Button onClick={() => actions.selectSubview("timeline")}>
            Messages
          </Button>
          <Button onClick={() => actions.selectSubview("trace")}>
            <GitBranch aria-hidden="true" />
            Open trace
          </Button>
          <Button onClick={() => actions.closeConversation()}>
            <X aria-hidden="true" />
            Close
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-auto px-4 py-3">
        <section
          aria-label="Selected conversation metadata"
          className="grid grid-cols-6 gap-2.5 max-[1320px]:grid-cols-3 max-[760px]:grid-cols-2"
        >
          <MetadataBox label="Relationship" value={conversation.relationship} />
          <MetadataBox label="Adapter" value={conversation.adapterId} />
          <MetadataBox
            label="Messages"
            value={formatNumber(conversation.messageCount)}
          />
          <MetadataBox
            label="Tools"
            value={formatNumber(conversation.toolCount)}
          />
          <MetadataBox
            label="Tokens"
            title={`${formatNumber(totalTokens(conversation))} tokens`}
            value={formatMetricNumber(totalTokens(conversation)).display}
          />
          <MetadataBox
            label="Estimated cost"
            value={formatCost(conversation.estCost)}
          />
        </section>

        {state.selectedConversationLoading ? (
          <div className="text-[0.82rem] text-[var(--text-dim)]">
            Refreshing selected conversation...
          </div>
        ) : null}

        <div className="min-h-0">
          <SelectedTrayContent actions={actions} state={state} />
        </div>
      </div>
    </aside>
  );
}

function MetadataBox({
  label,
  title,
  value,
}: {
  label: string;
  title?: string;
  value: string;
}) {
  return (
    <div
      className="min-w-0 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2.5"
      title={title}
    >
      <span className="block text-[0.62rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
        {label}
      </span>
      <strong className="mt-1.5 block truncate text-[0.88rem] text-[var(--text)]">
        {value}
      </strong>
    </div>
  );
}

function bottomTrayClassName(sidebarCollapsed: boolean): string {
  return cx(
    "fixed bottom-4 right-4 z-30 grid max-h-[47vh] min-h-[340px] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-[var(--picker-selected-border)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] shadow-[0_-18px_50px_rgba(0,0,0,0.34),0_0_0_1px_var(--control-highlight)_inset]",
    sidebarCollapsed ? "left-[82px]" : "left-[238px]",
    "max-[880px]:bottom-3 max-[880px]:left-3 max-[880px]:right-3 max-[880px]:min-h-[360px]",
  );
}

function SelectedTrayContent({
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

  return <ConversationPreview detail={state.detail!} />;
}

function ConversationPreview({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  const previewMessages = detail.messages.slice(0, 3);

  return (
    <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-3 max-[980px]:grid-cols-1">
      <div className="grid content-start gap-2">
        {previewMessages.length > 0 ? (
          previewMessages.map((message) => (
            <MessagePreviewCard key={message.id} message={message} />
          ))
        ) : (
          <EmptyState title="No messages recorded">
            <p>
              This conversation exists in the trace graph but currently has no
              stored message timeline.
            </p>
          </EmptyState>
        )}
        {detail.toolCalls.length > 0 ? (
          <article className="rounded-[10px] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.72rem] font-bold uppercase tracking-normal text-[var(--warning)]">
                Tool activity
              </span>
              <span className="text-[0.72rem] text-[var(--text-dim)]">
                {formatNumber(detail.toolCalls.length)} calls
              </span>
            </div>
            <p className="m-0 mt-1.5 line-clamp-2 text-[0.82rem] leading-normal text-[var(--text-soft)]">
              Recent calls include {previewToolNames(detail.toolCalls)}.
            </p>
          </article>
        ) : null}
      </div>
      <TraceSummaryPanel detail={detail} />
    </section>
  );
}

function MessagePreviewCard({ message }: { message: Message }) {
  const metadata = messageMetadata(message);

  return (
    <article className="rounded-[10px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={messageRoleClass(message.role)}>{message.role}</span>
        {metadata.length > 0 ? (
          <span className="truncate text-[0.72rem] text-[var(--text-dim)]">
            {metadata.join(" · ")}
          </span>
        ) : null}
      </div>
      <p className="m-0 mt-2 line-clamp-3 text-[0.86rem] leading-normal text-[var(--text-soft)]">
        {message.content || "(empty message)"}
      </p>
    </article>
  );
}

function TraceSummaryPanel({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  const conversation = detail.conversation;
  return (
    <aside className="grid content-start gap-2">
      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2.5">
        <div className="text-[0.66rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
          Source
        </div>
        <p className="m-0 mt-1.5 break-words text-[0.82rem] leading-normal text-[var(--text-soft)]">
          {conversation.cwd || conversation.sourcePath}
        </p>
      </div>
      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2.5">
        <div className="text-[0.66rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
          Trace summary
        </div>
        <p className="m-0 mt-1.5 text-[0.82rem] leading-normal text-[var(--text-soft)]">
          {formatNumber(detail.trace.conversationCount)} conversations in trace.
          Current row is {conversation.relationship}
          {detail.children.length > 0
            ? ` with ${formatNumber(detail.children.length)} child conversation${
                detail.children.length === 1 ? "" : "s"
              }.`
            : " with no child conversations."}
        </p>
      </div>
    </aside>
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

function filterConversationIndex(
  conversations: readonly Conversation[],
  searchQuery: string,
  relationshipFilter: string,
): Conversation[] {
  const query = searchQuery.trim().toLocaleLowerCase();

  return conversations.filter((conversation) => {
    if (
      relationshipFilter &&
      conversation.relationship !== relationshipFilter
    ) {
      return false;
    }

    if (!query) {
      return true;
    }

    return conversationSearchText(conversation).includes(query);
  });
}

function conversationSearchText(conversation: Conversation): string {
  return [
    conversation.id,
    conversation.traceId,
    conversation.parentId,
    conversation.relationship,
    conversation.adapterId,
    conversation.name,
    conversation.cwd,
    conversation.gitRemote,
    conversation.branch,
    conversation.model,
    conversation.sourcePath,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function relationshipCountsFor(
  conversations: readonly Conversation[],
): Record<string, number> {
  return conversations.reduce<Record<string, number>>((counts, conversation) => {
    counts[conversation.relationship] =
      (counts[conversation.relationship] ?? 0) + 1;
    return counts;
  }, {});
}

function relationshipOptionsFor(
  conversations: readonly Conversation[],
): string[] {
  return Object.keys(relationshipCountsFor(conversations)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function renderConversationIndexCount(
  library: DesktopConversationListView | null,
  loading: boolean,
  visibleCount: number,
): string {
  if (loading && !library) {
    return "Loading...";
  }

  if (!library) {
    return "Waiting";
  }

  const loaded = library.conversations.length;
  const total = conversationLibraryTotalCount(library);
  if (visibleCount < loaded) {
    return `${formatNumber(visibleCount)} visible of ${formatNumber(loaded)} loaded`;
  }

  if (hasConversationLibraryTotal(library)) {
    return `${formatNumber(loaded)} visible of ${formatNumber(total)}`;
  }

  return `${formatNumber(loaded)} loaded`;
}

function previewToolNames(
  toolCalls: DesktopConversationDetailView["toolCalls"],
): string {
  const names = [...new Set(toolCalls.map((tool) => tool.name).filter(Boolean))];
  if (names.length === 0) {
    return "recorded tool calls";
  }

  return names.slice(0, 3).join(", ");
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
      "bg-[var(--item-bg)] text-[var(--text-soft)]",
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
