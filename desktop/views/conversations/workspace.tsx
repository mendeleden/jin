import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  Search,
  X,
} from "lucide-react";
import {
  CONVERSATION_RELATIONSHIPS,
  type Conversation,
  type Message,
} from "../../../src/contracts/conversations";
import type {
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopTreeView,
} from "../../../src/contracts/desktop";
import {
  conversationLibraryHasMore,
  conversationLibraryTotalCount,
  formatCost,
  formatDate,
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
  SegmentedControl,
} from "../../ui/primitives";
import { formatProjectReference } from "../../ui/project-reference";

const DETAIL_TABS: Array<{
  label: string;
  value: DesktopConversationSubview;
}> = [
  { label: "Messages", value: "timeline" },
  { label: "Trace", value: "trace" },
  { label: "Tree", value: "tree" },
];

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
  "h-9 w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] px-2 text-[0.82rem] font-semibold text-[var(--text)] shadow-[inset_0_1px_0_var(--control-highlight)] transition-colors hover:border-[var(--line-strong)] focus-visible:border-[var(--control-border-hover)] focus-visible:outline-none [&_option]:bg-[var(--bg-elevated)] [&_option]:text-[var(--text)]";
const FILTER_FIELD_CLASS =
  "flex flex-col gap-1 text-[0.66rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]";
const TABLE_HEAD_CELL_CLASS =
  "px-2.5 py-2 text-[0.66rem] font-semibold uppercase tracking-normal";
const TABLE_HEAD_NUMERIC_CELL_CLASS = `${TABLE_HEAD_CELL_CLASS} text-right`;
const TABLE_CELL_CLASS =
  "border-b border-[var(--line)] px-2.5 py-2 align-top";
const TABLE_NUMERIC_CELL_CLASS = `${TABLE_CELL_CLASS} text-right`;
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
  const detailRoute = state.conversationRoute === "detail";
  const trayOpen = Boolean(
    !detailRoute &&
      (state.detail ||
        state.selectedConversationLoading ||
        state.selectedConversationError),
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
          data-conversation-surface={detailRoute ? "detail" : "ops-index"}
          data-tray-state={trayOpen ? "open" : "closed"}
        >
          {detailRoute ? (
            <ConversationDetailRoute actions={actions} state={state} />
          ) : (
            <>
              <ConversationIndexPanel
                actions={actions}
                state={state}
              />
              <ConversationBottomTray actions={actions} state={state} />
            </>
          )}
        </section>
      )}
    </RuntimeStateGate>
  );
}

function ConversationIndexPanel({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const totalLabel = renderConversationIndexCount(
    state.library,
    state.libraryLoading,
  );
  const searchQuery = state.libraryRequest.search ?? "";

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
        className="grid grid-cols-[minmax(280px,1fr)_minmax(520px,auto)] items-end gap-2.5 border-b border-[var(--line)] bg-[var(--conversation-toolbar-bg)] px-3 py-2.5 max-[1180px]:grid-cols-1"
        data-conversation-toolbar
      >
        <label className="relative min-w-0">
          <span className="sr-only">Search conversation index</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]"
          />
          <input
            aria-label="Search conversation index"
            className="h-9 w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] pl-8 pr-3 text-[0.9rem] text-[var(--text)] shadow-[inset_0_1px_0_var(--control-highlight)] outline-none transition-colors placeholder:text-[var(--text-dim)] hover:border-[var(--line-strong)] focus-visible:border-[var(--control-border-hover)]"
            onChange={(event) =>
              void actions.setConversationSearch(event.currentTarget.value)
            }
            placeholder="Search name, project, trace, model..."
            value={searchQuery}
          />
        </label>
        <ConversationFilters
          actions={actions}
          state={state}
        />
      </div>
      <ConversationIndexTable
        actions={actions}
        searchQuery={searchQuery}
        state={state}
      />
    </section>
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
  const repositoryOptions = repositoryOptionsForLibrary(state.library);
  const relationshipOptions = relationshipOptionsForLibrary(state.library);
  const adapterValue = state.libraryRequest.adapterId ?? "";
  const repositoryFilter = state.libraryRequest.repository ?? "";
  const relationshipFilter = state.libraryRequest.relationship ?? "";
  const sinceValue = state.libraryRequest.since ?? "";

  return (
    <div className="grid grid-cols-[repeat(4,minmax(120px,1fr))] gap-2 max-[1080px]:grid-cols-2 max-[640px]:grid-cols-1">
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
        <span>Repository</span>
        <select
          className={SELECT_FIELD_CLASS}
          onChange={(event) =>
            void actions.setRepositoryFilter(event.currentTarget.value)
          }
          value={repositoryFilter}
        >
          <option value="">All repositories</option>
          {repositoryOptions.map((remote) => (
            <option key={remote} title={remote} value={remote}>
              {formatProjectReference(remote)}
            </option>
          ))}
        </select>
      </label>
      <label className={FILTER_FIELD_CLASS}>
        <span>Relationship</span>
        <select
          className={SELECT_FIELD_CLASS}
          onChange={(event) =>
            void actions.setRelationshipFilter(event.currentTarget.value)
          }
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
}: {
  actions: DesktopShellActions;
  searchQuery: string;
  state: RendererState;
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

  const library = state.library;
  const conversations = library?.conversations ?? [];
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

  return (
    <div
      className={cx(
        "min-h-0 overflow-auto",
        state.detail && "pb-[360px] max-[880px]:pb-[386px]",
      )}
      data-conversation-list
      data-search-active={String(searchQuery.trim().length > 0)}
      onScroll={(event) => {
        const target = event.currentTarget;
        if (
          target.scrollHeight - target.scrollTop - target.clientHeight < 360
        ) {
          void actions.loadMoreConversations();
        }
      }}
    >
      <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-[0.8rem]">
        <thead className="sticky top-0 z-10 bg-[var(--panel-alt)] text-[var(--text-dim)] shadow-[0_1px_0_var(--line)]">
          <tr>
            <th className={TABLE_HEAD_CELL_CLASS}>Conversation</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Project</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Relationship</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Adapter</th>
            <th className={TABLE_HEAD_NUMERIC_CELL_CLASS}>Messages</th>
            <th className={TABLE_HEAD_NUMERIC_CELL_CLASS}>Tools</th>
            <th className={TABLE_HEAD_NUMERIC_CELL_CLASS}>Tokens</th>
            <th className={TABLE_HEAD_NUMERIC_CELL_CLASS}>Cost</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Started</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Ended</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation) => (
            <ConversationTableRow
              conversation={conversation}
              key={conversation.id}
              onOpen={actions.previewConversation}
              selected={conversation.id === state.selectedConversationId}
            />
          ))}
          <ConversationTableLoadState
            actions={actions}
            library={library}
            loadingMore={state.libraryLoadingMore}
          />
        </tbody>
      </table>
    </div>
  );
}

function ConversationTableLoadState({
  actions,
  library,
  loadingMore,
}: {
  actions: DesktopShellActions;
  library: DesktopConversationListView | null;
  loadingMore: boolean;
}) {
  if (!library) {
    return null;
  }

  const hasMore = conversationLibraryHasMore(library);
  const loaded = library.conversations.length;
  const total = conversationLibraryTotalCount(library);

  return (
    <tr data-conversation-list-window>
      <td
        className="px-3 py-3 text-center text-[0.78rem] text-[var(--text-dim)]"
        colSpan={10}
      >
        {hasMore ? (
          <Button
            disabled={loadingMore}
            onClick={() => void actions.loadMoreConversations()}
          >
            {loadingMore
              ? "Loading more..."
              : `Load more (${formatNumber(loaded)} of ${formatNumber(total)} shown)`}
          </Button>
        ) : (
          <span>{`${formatNumber(loaded)} matching conversations loaded`}</span>
        )}
      </td>
    </tr>
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
      <td className={cx(TABLE_CELL_CLASS, "max-w-[340px]")}>
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
      <td className={cx(TABLE_CELL_CLASS, "max-w-[230px] text-[var(--text-soft)]")}>
        <span className="line-clamp-2">
          {formatProjectReference(conversation.gitRemote || conversation.cwd)}
        </span>
      </td>
      <td className={TABLE_CELL_CLASS}>
        <span className={relationshipChipClass(conversation.relationship)}>
          {conversation.relationship}
        </span>
      </td>
      <td className={cx(TABLE_CELL_CLASS, "text-[var(--text-soft)]")}>
        {conversation.adapterId}
      </td>
      <td className={cx(TABLE_NUMERIC_CELL_CLASS, "text-[var(--text-soft)]")}>
        {formatNumber(conversation.messageCount)}
      </td>
      <td className={cx(TABLE_NUMERIC_CELL_CLASS, "text-[var(--text-soft)]")}>
        {formatNumber(conversation.toolCount)}
      </td>
      <td
        className={cx(TABLE_NUMERIC_CELL_CLASS, "text-[var(--text-soft)]")}
        title={`${formatNumber(totalTokens(conversation))} tokens`}
      >
        {formatMetricNumber(totalTokens(conversation)).display}
      </td>
      <td className={cx(TABLE_NUMERIC_CELL_CLASS, "text-[var(--text-soft)]")}>
        {formatCost(conversation.estCost)}
      </td>
      <td className={cx(TABLE_CELL_CLASS, "whitespace-nowrap text-[var(--text-dim)]")}>
        {formatDate(conversation.startedAt)}
      </td>
      <td className={cx(TABLE_CELL_CLASS, "whitespace-nowrap text-[var(--text-dim)]")}>
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
          <Button onClick={() => void actions.openConversation(conversation.id)}>
            <ExternalLink aria-hidden="true" />
            Open conversation
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
          <ConversationSubviewContent
            actions={actions}
            mode="preview"
            state={state}
          />
        </div>
      </div>
    </aside>
  );
}

function ConversationDetailRoute({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedConversationLoading && !state.detail) {
    return (
      <section
        className={cx(SURFACE_CLASS, "grid min-h-0 place-items-center p-6")}
        data-conversation-detail-route
        data-detail-loading="true"
      >
        <EmptyState title="Loading conversation">
          <p>
            Fetching the selected conversation, trace graph, and tree from the
            local daemon.
          </p>
        </EmptyState>
      </section>
    );
  }

  if (state.selectedConversationError && !state.detail) {
    return (
      <section
        className={cx(SURFACE_CLASS, "grid min-h-0 place-items-center p-6")}
        data-conversation-detail-route
        data-detail-error="true"
      >
        <EmptyState title="Conversation detail unavailable">
          <p>{state.selectedConversationError}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => actions.showConversationIndex()}>
              <ArrowLeft aria-hidden="true" />
              Back to index
            </Button>
            {state.selectedConversationId ? (
              <Button
                onClick={() =>
                  void actions.openConversation(state.selectedConversationId!)
                }
                variant="primary"
              >
                Retry
              </Button>
            ) : null}
          </div>
        </EmptyState>
      </section>
    );
  }

  if (!state.detail) {
    return (
      <section
        className={cx(SURFACE_CLASS, "grid min-h-0 place-items-center p-6")}
        data-conversation-detail-route
      >
        <EmptyState title="No conversation selected">
          <p>Select a row from the index before opening a conversation tab.</p>
          <Button onClick={() => actions.showConversationIndex()}>
            <ArrowLeft aria-hidden="true" />
            Back to index
          </Button>
        </EmptyState>
      </section>
    );
  }

  const conversation = state.detail.conversation;

  return (
    <section
      className={cx(
        SURFACE_CLASS,
        "grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] overflow-hidden",
      )}
      data-conversation-detail-route
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--line)] px-4 py-3 max-[980px]:grid-cols-1">
        <Button onClick={() => actions.showConversationIndex()}>
          <ArrowLeft aria-hidden="true" />
          Index
        </Button>
        <div className="min-w-0">
          <Eyebrow>Open Conversation</Eyebrow>
          <h2
            className="m-0 mt-1 truncate text-[1.18rem] leading-tight tracking-normal text-[var(--text)]"
            title={conversation.name}
          >
            {formatConversationTitle(conversation.name)}
          </h2>
          <p className="m-0 mt-1 text-[0.78rem] text-[var(--text-dim)]">
            {renderConversationHeaderSummary(state.detail)}
          </p>
        </div>
        <Button onClick={() => actions.closeConversation()}>
          <X aria-hidden="true" />
          Close
        </Button>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--line)] bg-[var(--conversation-toolbar-bg)] px-4 py-3 max-[980px]:grid-cols-1">
        <section
          aria-label="Conversation metadata"
          className="grid min-w-0 grid-cols-6 gap-2 max-[1320px]:grid-cols-3 max-[760px]:grid-cols-2"
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
        <SegmentedControl
          ariaLabel="Conversation detail tabs"
          className="justify-self-end max-[980px]:justify-self-start"
          onChange={(value) => actions.selectSubview(value)}
          options={DETAIL_TABS}
          value={state.selectedSubview}
        />
      </div>

      <div className="border-b border-[var(--line)] px-4 py-3">
        <ConversationCopyStrip detail={state.detail} />
      </div>

      <div className="min-h-0 overflow-auto p-4" data-conversation-detail-tab>
        <ConversationSubviewContent actions={actions} mode="detail" state={state} />
      </div>
    </section>
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
    "fixed bottom-4 right-4 z-30 grid max-h-[47vh] min-h-[340px] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-[var(--picker-selected-border)] [background:var(--overlay-panel-bg)] shadow-[0_-18px_50px_rgba(0,0,0,0.34),0_0_0_1px_var(--control-highlight)_inset]",
    sidebarCollapsed ? "left-[82px]" : "left-[238px]",
    "max-[880px]:bottom-3 max-[880px]:left-3 max-[880px]:right-3 max-[880px]:min-h-[360px]",
  );
}

function ConversationSubviewContent({
  actions,
  mode,
  state,
}: {
  actions: DesktopShellActions;
  mode: "detail" | "preview";
  state: RendererState;
}) {
  if (state.selectedSubview === "trace") {
    return <TraceSubview actions={actions} state={state} />;
  }

  if (state.selectedSubview === "tree") {
    return <TreeSubview actions={actions} state={state} />;
  }

  return mode === "detail" ? (
    <ConversationMessagesView detail={state.detail!} />
  ) : (
    <ConversationPreview detail={state.detail!} />
  );
}

function ConversationPreview({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  return (
    <section className="grid min-h-0 gap-2">
      {detail.messages.length > 0 ? (
        detail.messages.map((message) => (
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
      <ToolActivityCard detail={detail} />
    </section>
  );
}

function ConversationMessagesView({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  const [collapsedMessageIds, setCollapsedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setCollapsedMessageIds(new Set());
  }, [detail.conversation.id]);

  const toggleMessage = (messageId: string) => {
    setCollapsedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  return (
    <section
      className="grid min-h-0 gap-3"
      data-conversation-messages-view
    >
      <MessageRoleSummary messages={detail.messages} />
      <div className="grid min-w-0 content-start gap-2">
        {detail.messages.length > 0 ? (
          detail.messages.map((message) => (
            <MessagePreviewCard
              collapsed={collapsedMessageIds.has(message.id)}
              key={message.id}
              message={message}
              onToggleCollapsed={() => toggleMessage(message.id)}
              variant="detail"
            />
          ))
        ) : (
          <EmptyState title="No messages recorded">
            <p>
              This conversation exists in the trace graph but currently has no
              stored message timeline.
            </p>
          </EmptyState>
        )}
        <ToolActivityCard detail={detail} />
      </div>
    </section>
  );
}

function ConversationCopyStrip({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const items = useMemo(
    () =>
      [
        {
          key: "conversation-id",
          label: "Conversation ID",
          value: detail.conversation.id,
        },
        {
          key: "trace-id",
          label: "Trace ID",
          value: detail.trace.traceId,
        },
        detail.parent
          ? {
              key: "parent-id",
              label: "Parent ID",
              value: detail.parent.id,
            }
          : null,
        {
          key: "source-path",
          label: "Source",
          value: detail.conversation.sourcePath,
        },
      ].filter((item): item is { key: string; label: string; value: string } =>
        Boolean(item?.value),
      ),
    [detail],
  );

  const copyValue = async (key: string, value: string) => {
    await copyTextToClipboard(value);
    setCopiedKey(key);
    globalThis.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1400);
  };

  return (
    <div
      className="grid gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2"
      data-conversation-copy-strip
    >
      <span className="text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
        Identifiers
      </span>
      <div className="grid gap-1.5 min-[980px]:grid-cols-2">
        {items.map((item) => {
          const copied = copiedKey === item.key;
          return (
            <button
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] px-2.5 py-2 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--control-bg-hover)] focus-visible:border-[var(--control-border-hover)] focus-visible:outline-none"
              data-copy-field={item.key}
              key={item.key}
              onClick={() => void copyValue(item.key, item.value)}
              title={`Copy ${item.label}: ${item.value}`}
              type="button"
            >
              <span className="grid min-w-0 gap-1">
                <span className="text-[0.64rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
                  {item.label}
                </span>
                <code className="truncate [font-family:var(--mono)] text-[0.72rem] text-[var(--text-soft)]">
                  {item.value}
                </code>
              </span>
              {copied ? (
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 text-[var(--success)]"
                />
              ) : (
                <Copy
                  aria-hidden="true"
                  className="h-4 w-4 text-[var(--text-dim)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageRoleSummary({ messages }: { messages: Message[] }) {
  const counts = countMessagesByRole(messages);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--item-bg)] px-3 py-2"
      data-message-role-summary
    >
      <span className="text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]">
        Timeline
      </span>
      <div className="flex flex-wrap gap-1.5 text-[0.72rem] text-[var(--text-soft)]">
        <MessageRoleChip label="total" value={messages.length} />
        <MessageRoleChip label="user" value={counts.user} />
        <MessageRoleChip label="assistant" value={counts.assistant} />
        <MessageRoleChip label="system" value={counts.system} />
      </div>
    </div>
  );
}

function MessageRoleChip({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="rounded-full border border-[var(--line)] bg-[var(--control-bg)] px-2 py-0.5">
      <strong className="text-[var(--text)]">{formatNumber(value)}</strong>{" "}
      {label}
    </span>
  );
}

function ToolActivityCard({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  if (detail.toolCalls.length === 0) {
    return null;
  }

  return (
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
  );
}

function MessagePreviewCard({
  collapsed = false,
  message,
  onToggleCollapsed,
  variant = "preview",
}: {
  collapsed?: boolean;
  message: Message;
  onToggleCollapsed?(): void;
  variant?: "detail" | "preview";
}) {
  const metadata = messageMetadata(message);
  const canCollapse = variant === "detail" && onToggleCollapsed;

  return (
    <article
      className="min-w-0 rounded-[10px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-alt),var(--panel))] px-3 py-2.5"
      data-message-card={message.id}
      data-message-collapsed={String(collapsed)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {canCollapse ? (
            <button
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand message" : "Collapse message"}
              className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--field-bg)] text-[var(--text-soft)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text)] focus-visible:border-[var(--control-border-hover)] focus-visible:outline-none [&_svg]:h-4 [&_svg]:w-4"
              onClick={onToggleCollapsed}
              title={collapsed ? "Expand message" : "Collapse message"}
              type="button"
            >
              {collapsed ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
            </button>
          ) : null}
          <span className={messageRoleClass(message.role)}>{message.role}</span>
        </div>
        {metadata.length > 0 ? (
          <span className="truncate text-[0.72rem] text-[var(--text-dim)]">
            {metadata.join(" · ")}
          </span>
        ) : null}
      </div>
      <p
        className={cx(
          "m-0 mt-2 text-[0.86rem] leading-normal text-[var(--text-soft)]",
          collapsed
            ? "line-clamp-1"
            : variant === "detail"
              ? "whitespace-pre-wrap break-words"
              : "line-clamp-3",
        )}
      >
        {message.content || "(empty message)"}
      </p>
    </article>
  );
}

async function copyTextToClipboard(value: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the textarea copy path below.
  }

  if (typeof document === "undefined") {
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
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
          <article
            className={cx(
              ROW_BASE_CLASS,
              "min-h-[70px] cursor-default",
              selected && ROW_SELECTED_CLASS,
            )}
            data-trace-row={conversation.id}
            data-trace-row-selected={String(selected)}
            key={conversation.id}
          >
            <div className={ROW_TOP_CLASS}>
              <div className={ROW_TITLE_CLASS} title={conversation.name}>
                {formatConversationTitle(conversation.name)}
              </div>
              <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                <span className={relationshipChipClass(conversation.relationship)}>
                  {conversation.relationship}
                </span>
                <Button
                  data-trace-action={conversation.id}
                  onClick={() => void actions.openConversation(conversation.id)}
                >
                  <ExternalLink aria-hidden="true" />
                  View conversation
                </Button>
              </div>
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
          </article>
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

function renderConversationIndexCount(
  library: DesktopConversationListView | null,
  loading: boolean,
): string {
  if (loading && !library) {
    return "Loading...";
  }

  if (!library) {
    return "Waiting";
  }

  const loaded = library.conversations.length;
  const filtered = conversationLibraryTotalCount(library);
  const total = Number.isFinite(library.totalCount)
    ? library.totalCount
    : filtered;

  if (filtered !== total) {
    return `${formatNumber(loaded)} shown of ${formatNumber(filtered)} matches (${formatNumber(total)} total)`;
  }

  if (conversationLibraryHasMore(library)) {
    return `${formatNumber(loaded)} shown of ${formatNumber(filtered)}`;
  }

  return `${formatNumber(loaded)} loaded`;
}

function relationshipOptionsForLibrary(
  library: DesktopConversationListView | null,
): string[] {
  const relationships = new Set(
    library?.relationshipMix.map((entry) => entry.relationship) ?? [],
  );

  if (library?.filters.relationship) {
    relationships.add(library.filters.relationship);
  }

  return [...relationships].sort((left, right) => {
    const leftIndex = CONVERSATION_RELATIONSHIPS.indexOf(
      left as (typeof CONVERSATION_RELATIONSHIPS)[number],
    );
    const rightIndex = CONVERSATION_RELATIONSHIPS.indexOf(
      right as (typeof CONVERSATION_RELATIONSHIPS)[number],
    );
    return (
      (leftIndex === -1 ? 99 : leftIndex) -
      (rightIndex === -1 ? 99 : rightIndex)
    );
  });
}

function repositoryOptionsForLibrary(
  library: DesktopConversationListView | null,
): string[] {
  const repositories = new Set(library?.availableRepositories ?? []);
  if (library?.filters.repository) {
    repositories.add(library.filters.repository);
  }

  return [...repositories].sort((left, right) =>
    formatProjectReference(left).localeCompare(formatProjectReference(right)),
  );
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

function countMessagesByRole(
  messages: readonly Message[],
): Record<Message["role"], number> {
  return messages.reduce<Record<Message["role"], number>>(
    (counts, message) => {
      counts[message.role] += 1;
      return counts;
    },
    { assistant: 0, system: 0, user: 0 },
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
