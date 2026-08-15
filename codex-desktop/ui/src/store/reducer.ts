/**
 * State shape and the pure reducer behind it.
 *
 * Split out of `store.tsx` so the reducer, the event router
 * (`store/events.ts`) and the provider each change for one reason. Nothing
 * here touches React beyond the `Dispatch` type, and nothing here calls the
 * backend — every transition is a pure function of the previous state.
 */
import type {
  Account,
  ApprovalMode,
  BackgroundTerminalView,
  CodexConfig,
  CollaborationModePreset,
  CommandExecutionItem,
  AppInfo,
  ConfigLayerMetadata,
  ConfigRequirements,
  ContextUsage,
  FeatureFlag,
  McpServerRuntimeState,
  Model,
  Personality,
  ModelSelection,
  Notice,
  PendingApproval,
  PendingLogin,
  Project,
  QueuedSubmissionView,
  RateLimitSnapshot,
  SkillMetadata,
  ThreadGoal,
  ThreadHistoryMode,
  ThreadItem,
  ThreadSearchResult,
  ThreadSettingsIndicators,
  ThreadSummary,
  ImportProgress,
  ImportTypeResult,
  ThreadTokenUsage,
  Turn,
  TurnStatus,
} from "../types";


/**
 * Whether this thread's pre-existing history has been pulled in via
 * `thread/resume`. Threads created in this session start `loaded` (there is
 * no prior history to fetch); threads picked from the sidebar start `idle`
 * and must be resumed before their items exist locally at all.
 */
export type HistoryStatus = "idle" | "loading" | "loaded" | "error";

/**
 * One step of "I navigated into this thread from that one".
 *
 * `reason` is what the breadcrumb says, since arriving at a review thread and
 * arriving at a sub-agent thread want different words.
 */
export interface ThreadTrailEntry {
  threadId: string;
  fromThreadId: string;
  reason: "subAgent" | "review";
  /** Nickname or role when known; the raw id is a poor label. */
  label?: string;
}

export interface ThreadState {
  itemOrder: string[];
  items: Record<string, ThreadItem>;
  /**
   * item id -> the turn it belongs to. Populated from three sources so it is
   * complete regardless of how an item arrived: `turn.id` when bulk-loading
   * history, and the `turnId` on delta / `item/completed` notifications for
   * live items. Backs the per-message Fork action (ADR-0018), which needs a
   * `lastTurnId` to fork through.
   */
  itemTurnIds: Record<string, string>;
  turnStatus: Record<string, TurnStatus>;
  activeTurnId: string | null;
  /**
   * Unix ms when the active turn's first item started, taken from
   * `item/started`'s `startedAtMs`. Backs the live "working for Xs" row —
   * `Turn` carries `startedAt` but only on the resume/fork responses, never
   * on the live `turn/started` notification.
   */
  activeTurnStartedAtMs: number | null;
  pendingApprovals: PendingApproval[];
  historyStatus: HistoryStatus;
  historyError: string | null;
  /**
   * Latest `thread/tokenUsage/updated` payload. Null until the first turn
   * reports usage — a fresh thread genuinely has none, which is why the
   * indicator is absent rather than showing 100%.
   */
  tokenUsage: ThreadTokenUsage | null;
  /**
   * Context pressure derived from `tokenUsage` by the engine's own formula
   * (computed in Rust — see `src/composer.rs`), so the baseline constant
   * can't drift from the engine (ADR-0021).
   */
  contextUsage: ContextUsage | null;
  /**
   * True between `thread/compact/start` returning and `thread/compacted`
   * arriving. Compaction is not instant and rewrites history, so it needs a
   * visible running state rather than a silent pause.
   */
  compacting: boolean;
  /**
   * Submissions waiting behind the running turn (`thread/queue/list`), kept
   * current by `thread/queue/changed`. The engine owns dispatch — see the
   * note on `queueMessage` — so this is a view, never a schedule this client
   * executes.
   */
  queue: QueuedSubmissionView[];
  /**
   * Processes the agent left running (`thread/backgroundTerminals/list`).
   * Fetched on demand rather than polled: there is no notification for it,
   * and a background process is not something that changes second to second.
   */
  backgroundTerminals: BackgroundTerminalView[];
  /**
   * `thread/goal/get`. A goal persists across turns ("设置要持续追求的目标"),
   * so it is thread state rather than anything turn-scoped. `null` means the
   * thread has none, which is distinct from one with an empty objective.
   */
  goal: ThreadGoal | null;
  /**
   * The thread's persisted history contract, from `thread/resume`. `null`
   * until resumed. Revert requires `paginated`; threads created by an older
   * build of this client — or by any client that omits `historyMode` — are
   * `legacy` and can never be reverted, which is worth saying up front rather
   * than discovering by pressing the button.
   */
  historyMode: ThreadHistoryMode | null;
}

export function emptyThread(): ThreadState {
  return {
    itemOrder: [],
    items: {},
    itemTurnIds: {},
    turnStatus: {},
    activeTurnId: null,
    activeTurnStartedAtMs: null,
    pendingApprovals: [],
    tokenUsage: null,
    contextUsage: null,
    compacting: false,
    queue: [],
    backgroundTerminals: [],
    goal: null,
    historyMode: null,
    historyStatus: "idle",
    historyError: null,
  };
}

/**
 * Sidebar search is a *mode*, not a filter over the Project tree: while it's
 * active the tree is replaced by results, and exiting restores it untouched.
 * `thread/search` has no cwd filter, so results span every Project.
 */
export interface SearchState {
  term: string;
  status: "idle" | "searching" | "done" | "error";
  results: ThreadSearchResult[];
  error: string | null;
}

export interface State {
  projects: Project[];
  activeProjectPath: string | null;
  threadsByProject: Record<string, ThreadSummary[]>;
  /**
   * Archived threads are a *separate* list call: the protocol's `archived`
   * filter is tri-state (`true` = only archived, `false`/null = only
   * non-archived), with no way to ask for both at once.
   */
  archivedThreadsByProject: Record<string, ThreadSummary[]>;
  /**
   * Which Projects have their archived section expanded. Without this the
   * `thread/unarchive` RPC would be unreachable from the UI, making archive
   * a one-way trip — so the archived view exists precisely to keep the
   * action reversible.
   */
  archivedVisible: Record<string, boolean>;
  search: SearchState;
  /**
   * Read-only account state. There is deliberately no billing, upgrade or
   * top-up affordance anywhere in this app, so nothing writes these.
   */
  account: Account | null;
  requiresOpenaiAuth: boolean;
  rateLimits: RateLimitSnapshot | null;
  activeThreadId: string | null;
  /**
   * Threads navigated *into* from another thread, most recent last, each with
   * the thread it was reached from.
   *
   * Sub-agent threads and detached review threads are excluded from the
   * sidebar's `thread/list` by the protocol's `sourceKinds` default
   * (ADR-0017), so once the main pane shows one there is nothing in the
   * sidebar to click to get back — the user is stranded on a thread the app
   * cannot list. This trail is the way back, and it is desktop chrome with no
   * engine counterpart (ADR-0021's third admissible case), like the pinned
   * Project list.
   */
  threadTrail: ThreadTrailEntry[];
  threads: Record<string, ThreadState>;
  /**
   * ADR-0016 layer 1. Held app-level rather than per-thread so switching
   * threads keeps the user's chosen posture; applied to the server on thread
   * start and on change.
   *
   * This is the *session* value. Its persisted counterpart is
   * `defaultApprovalMode` — see the note on `approvalModeOverridden`.
   */
  approvalMode: ApprovalMode;
  /**
   * The value persisted in `config.toml` (ADR-0020). `null` means the config
   * holds a combination the 3-preset selector can't express (a hand-edited
   * file, or the `read-only` preset) — reported honestly rather than snapped
   * to a preset the user never chose.
   */
  defaultApprovalMode: ApprovalMode | null;
  /**
   * Set once the composer changes the mode this session. ADR-0020 makes the
   * composer an *override* of the persisted default: without this flag,
   * editing the default in Settings would silently stomp a deliberate
   * per-session choice the user made in the composer.
   */
  approvalModeOverridden: boolean;
  /**
   * Effective `config.toml` (all layers merged) and, per key, which layer it
   * came from — so a setting pinned by an org policy can say so.
   */
  config: CodexConfig | null;
  configOrigins: Record<string, ConfigLayerMetadata>;
  /** Deployment limits on allowed values; `null` when unconfigured (usual). */
  configRequirements: ConfigRequirements | null;
  /**
   * Whether the settings surface is open, and on which screen (ADR: the
   * Official App shows settings as a full-window takeover, not a modal).
   */
  settingsScreen: string | null;
  /**
   * Server-pushed notices the user should see: `warning`, `error`,
   * `guardianWarning`, `configWarning`, `deprecationNotice`, `model/rerouted`.
   * All were previously discarded, so a bad config or a silently swapped
   * model produced no visible sign at all.
   */
  notices: Notice[];
  /**
   * External-agent config imports, keyed by the `importId` the request
   * returns. The request's response carries only that id — the per-item
   * outcomes arrive on `externalAgentConfig/import/progress`/`completed`, so
   * without this the import screen could only ever say "started".
   */
  imports: Record<string, ImportProgress>;
  /**
   * Model catalog from `model/list`, loaded once at startup. Empty until it
   * resolves (or if it fails — the picker then simply has nothing to offer,
   * which is better than blocking the composer).
   */
  models: Model[];
  /** Same app-level treatment as `approvalMode`, for the same reason. */
  modelSelection: ModelSelection;
  /** Composer override tracking, mirroring `approvalModeOverridden`. */
  modelSelectionOverridden: boolean;
  /**
   * Collaboration-mode presets from `collaborationMode/list`, behind the `@`
   * menu's 计划模式 entry. Empty until it resolves, or if the experimental
   * RPC is unavailable — in which case the entry simply isn't offered.
   */
  collaborationModes: CollaborationModePreset[];
  /**
   * The mode applied to the active thread, `"default"` until changed. Kept
   * per-app rather than per-thread because a new thread starts in
   * `ModeKind::default()` anyway, which is Default.
   */
  collaborationMode: string;
  /**
   * Communication style applied to the active thread (`/personality`).
   * Per-app for the same reason as `collaborationMode`: a new thread starts
   * at the server's configured default, and this only tracks explicit
   * overrides made from the composer.
   */
  personality: Personality | null;
  /**
   * Feature-flag enablement from `experimentalFeature/list`, loaded once at
   * startup. Empty until it resolves; consumers must treat "not found" as
   * "unknown", not "disabled", or a slow load would hide working controls.
   */
  features: FeatureFlag[];
  /**
   * Live MCP startup state, keyed by server name. `mcpServerStatus/list`
   * reports auth status but not startup state, so this can only be
   * accumulated from `mcpServer/startupStatus/updated` — a server that
   * failed before this window opened has no entry here.
   */
  mcpRuntime: Record<string, McpServerRuntimeState>;
  /** In-flight ChatGPT sign-in. Cleared by `account/login/completed`. */
  pendingLogin: PendingLogin | null;
  /**
   * Every skill `skills/list` reports across the open Projects, **including
   * disabled ones**, refreshed on `skills/changed`. Empty is a legitimate
   * state (no skills installed).
   *
   * Deliberately unfiltered: the `$` typeahead wants only enabled skills and
   * filters at the point of use, but the settings screen has to show disabled
   * ones or they could never be switched back on. Filtering here instead
   * would make one consumer's needs quietly break the other's.
   */
  skills: SkillMetadata[];
  /**
   * Connectors available for `@` mentions, from `app/list`, refreshed on
   * `app/list/updated`. Only accessible+enabled entries are mentionable —
   * the filter is applied where the menu is built, mirroring
   * `is_app_mentionable`.
   */
  apps: AppInfo[];
}

export type Action =
  | { type: "SKILLS_LOADED"; skills: SkillMetadata[] }
  | { type: "APPS_LOADED"; apps: AppInfo[] }
  | { type: "TOKEN_USAGE_UPDATED"; threadId: string; tokenUsage: ThreadTokenUsage }
  | { type: "CONTEXT_USAGE_COMPUTED"; threadId: string; contextUsage: ContextUsage }
  | { type: "COMPACTION_STARTED"; threadId: string }
  | { type: "COMPACTION_FINISHED"; threadId: string }
  | { type: "QUEUE_LOADED"; threadId: string; queue: QueuedSubmissionView[] }
  | { type: "BACKGROUND_TERMINALS_LOADED"; threadId: string; terminals: BackgroundTerminalView[] }
  | { type: "GOAL_LOADED"; threadId: string; goal: ThreadGoal | null }
  | { type: "PROJECTS_LOADED"; projects: Project[] }
  | { type: "PROJECT_ADDED"; project: Project }
  | { type: "PROJECT_REMOVED"; id: string }
  | { type: "ACTIVE_PROJECT_SET"; path: string | null }
  | {
      type: "THREADS_LOADED";
      projectPath: string;
      threads: ThreadSummary[];
      archived: boolean;
    }
  | { type: "ARCHIVED_VISIBILITY_SET"; projectPath: string; visible: boolean }
  | { type: "THREAD_RENAMED"; threadId: string; name: string | null }
  | { type: "THREAD_REMOVED_FROM_LIST"; threadId: string }
  | { type: "THREAD_REMOVED_FROM_ARCHIVE"; threadId: string }
  | { type: "SEARCH_TERM_SET"; term: string }
  | { type: "SEARCH_STARTED" }
  | { type: "SEARCH_SUCCEEDED"; results: ThreadSearchResult[] }
  | { type: "SEARCH_FAILED"; error: string }
  | { type: "SEARCH_EXITED" }
  | { type: "ACCOUNT_LOADED"; account: Account | null; requiresOpenaiAuth: boolean }
  | { type: "ACCOUNT_PLAN_UPDATED"; planType: string | null }
  | { type: "RATE_LIMITS_LOADED"; rateLimits: RateLimitSnapshot }
  | { type: "RATE_LIMITS_MERGED"; rateLimits: RateLimitSnapshot }
  | { type: "ACTIVE_THREAD_SET"; threadId: string | null; keepTrail?: boolean }
  | {
      type: "THREAD_DRILLED_INTO";
      threadId: string;
      fromThreadId: string;
      reason: ThreadTrailEntry["reason"];
      label?: string;
    }
  | { type: "THREAD_TRAIL_POPPED" }
  | { type: "AGENT_INFO_LOADED"; threadId: string; label: string }
  | { type: "ITEM_UPSERT_DELTA"; threadId: string; turnId: string; itemId: string; deltaText: string }
  | {
      type: "ITEM_STARTED";
      threadId: string;
      turnId: string;
      item: ThreadItem;
      startedAtMs: number;
    }
  | {
      type: "ITEM_OUTPUT_DELTA";
      threadId: string;
      turnId: string;
      itemId: string;
      deltaText: string;
    }
  | { type: "ITEM_COMPLETED"; threadId: string; turnId: string; item: ThreadItem }
  | { type: "TURN_STARTED"; threadId: string; turnId: string }
  | { type: "TURN_STATUS"; threadId: string; turnId: string; status: TurnStatus }
  | { type: "APPROVAL_REQUESTED"; threadId: string; approval: PendingApproval }
  | { type: "APPROVAL_RESOLVED"; threadId: string; requestId: unknown }
  | { type: "HISTORY_LOADING"; threadId: string }
  | { type: "HISTORY_CLEARED"; threadId: string }
  | {
      type: "HISTORY_LOADED";
      threadId: string;
      turns: Turn[];
      historyMode: ThreadHistoryMode | null;
    }
  | { type: "HISTORY_FAILED"; threadId: string; error: string }
  | { type: "APPROVAL_MODE_SET"; mode: ApprovalMode; overrides: boolean }
  | {
      type: "THREAD_SETTINGS_APPLIED";
      threadId: string;
      indicators: ThreadSettingsIndicators;
    }
  | {
      type: "IMPORT_PROGRESS";
      importId: string;
      results: ImportTypeResult[];
      done: boolean;
    }
  | { type: "MODELS_LOADED"; models: Model[] }
  | { type: "COLLABORATION_MODES_LOADED"; modes: CollaborationModePreset[] }
  | { type: "COLLABORATION_MODE_SET"; mode: string }
  | { type: "FEATURES_LOADED"; features: FeatureFlag[] }
  | { type: "PERSONALITY_SET"; personality: Personality }
  | { type: "MODEL_SELECTION_SET"; selection: ModelSelection; overrides: boolean }
  | {
      type: "CONFIG_LOADED";
      config: CodexConfig;
      origins: Record<string, ConfigLayerMetadata>;
      defaultApprovalMode: ApprovalMode | null;
    }
  | { type: "CONFIG_REQUIREMENTS_LOADED"; requirements: ConfigRequirements | null }
  | { type: "SETTINGS_SCREEN_SET"; screen: string | null }
  | { type: "NOTICE_PUSHED"; notice: Notice }
  | { type: "NOTICE_DISMISSED"; id: string }
  | { type: "MCP_RUNTIME_UPDATED"; name: string; runtime: McpServerRuntimeState }
  | { type: "LOGIN_STARTED"; login: PendingLogin }
  | { type: "LOGIN_COMPLETED"; error: string | null };

function withThread(state: State, threadId: string, update: (thread: ThreadState) => ThreadState): State {
  const current = state.threads[threadId] ?? emptyThread();
  return { ...state, threads: { ...state.threads, [threadId]: update(current) } };
}

function emptySearch(): SearchState {
  return { term: "", status: "idle", results: [], error: null };
}

/**
 * Applies a per-thread transform across every Project's list. Notifications
 * carry only a `threadId`, never the Project it belongs to, so any update
 * has to sweep all of them.
 */
function mapThreadLists(
  lists: Record<string, ThreadSummary[]>,
  update: (thread: ThreadSummary) => ThreadSummary,
): Record<string, ThreadSummary[]> {
  return Object.fromEntries(
    Object.entries(lists).map(([path, threads]) => [path, threads.map(update)]),
  );
}

function mapThreadListsWhole(
  lists: Record<string, ThreadSummary[]>,
  update: (threads: ThreadSummary[]) => ThreadSummary[],
): Record<string, ThreadSummary[]> {
  return Object.fromEntries(
    Object.entries(lists).map(([path, threads]) => [path, update(threads)]),
  );
}

/**
 * Merges a sparse rolling rate-limit update over the last full snapshot.
 * Only `rate_limits` itself is non-optional on the notification; every field
 * inside it may be absent, and absent means "unchanged".
 */
function mergeRateLimits(
  previous: RateLimitSnapshot | null,
  update: RateLimitSnapshot,
): RateLimitSnapshot {
  if (!previous) return update;
  const merged: RateLimitSnapshot = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "PROJECTS_LOADED":
      return { ...state, projects: action.projects };
    case "PROJECT_ADDED":
      return { ...state, projects: [...state.projects, action.project] };
    case "PROJECT_REMOVED":
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
    case "ACTIVE_PROJECT_SET":
      return { ...state, activeProjectPath: action.path };
    case "THREADS_LOADED":
      return action.archived
        ? {
            ...state,
            archivedThreadsByProject: {
              ...state.archivedThreadsByProject,
              [action.projectPath]: action.threads,
            },
          }
        : {
            ...state,
            threadsByProject: { ...state.threadsByProject, [action.projectPath]: action.threads },
          };
    case "ARCHIVED_VISIBILITY_SET":
      return {
        ...state,
        archivedVisible: { ...state.archivedVisible, [action.projectPath]: action.visible },
      };
    case "THREAD_RENAMED": {
      // Applied everywhere the thread can be on screen at once. The rename may
      // not have originated here — `thread/name/updated` also fires when the
      // CLI or another surface renames it.
      const rename = (thread: ThreadSummary): ThreadSummary =>
        thread.id === action.threadId ? { ...thread, name: action.name } : thread;
      return {
        ...state,
        threadsByProject: mapThreadLists(state.threadsByProject, rename),
        archivedThreadsByProject: mapThreadLists(state.archivedThreadsByProject, rename),
        search: {
          ...state.search,
          results: state.search.results.map((result) =>
            result.thread.id === action.threadId
              ? { ...result, thread: rename(result.thread) }
              : result,
          ),
        },
      };
    }
    case "THREAD_REMOVED_FROM_LIST": {
      // Covers both archive and delete: either way the thread leaves the
      // default (non-archived) list. Search results drop it too, since they
      // are also a non-archived view.
      const drop = (threads: ThreadSummary[]) =>
        threads.filter((thread) => thread.id !== action.threadId);
      return {
        ...state,
        threadsByProject: mapThreadListsWhole(state.threadsByProject, drop),
        search: {
          ...state.search,
          results: state.search.results.filter((result) => result.thread.id !== action.threadId),
        },
        // A thread that no longer exists must not stay open in the main pane.
        activeThreadId: state.activeThreadId === action.threadId ? null : state.activeThreadId,
      };
    }
    case "THREAD_REMOVED_FROM_ARCHIVE":
      return {
        ...state,
        archivedThreadsByProject: mapThreadListsWhole(
          state.archivedThreadsByProject,
          (threads) => threads.filter((thread) => thread.id !== action.threadId),
        ),
      };
    case "SEARCH_TERM_SET":
      return { ...state, search: { ...state.search, term: action.term } };
    case "SEARCH_STARTED":
      return { ...state, search: { ...state.search, status: "searching", error: null } };
    case "SEARCH_SUCCEEDED":
      return {
        ...state,
        search: { ...state.search, status: "done", results: action.results, error: null },
      };
    case "SEARCH_FAILED":
      return {
        ...state,
        search: { ...state.search, status: "error", results: [], error: action.error },
      };
    case "SEARCH_EXITED":
      return { ...state, search: emptySearch() };
    case "ACCOUNT_LOADED":
      return {
        ...state,
        account: action.account,
        requiresOpenaiAuth: action.requiresOpenaiAuth,
      };
    case "ACCOUNT_PLAN_UPDATED":
      // `account/updated` is sparse — it carries authMode/planType but never
      // the email, so this merges rather than replacing the account.
      if (!state.account || state.account.type !== "chatgpt" || !action.planType) return state;
      return { ...state, account: { ...state.account, planType: action.planType } };
    case "RATE_LIMITS_LOADED":
      return { ...state, rateLimits: action.rateLimits };
    case "RATE_LIMITS_MERGED":
      // The protocol documents `account/rateLimits/updated` as a *sparse
      // rolling update*: absent fields mean "unchanged", not "cleared".
      return { ...state, rateLimits: mergeRateLimits(state.rateLimits, action.rateLimits) };
    case "SKILLS_LOADED":
      return { ...state, skills: action.skills };
    case "APPS_LOADED":
      return { ...state, apps: action.apps };
    case "TOKEN_USAGE_UPDATED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        tokenUsage: action.tokenUsage,
      }));
    case "CONTEXT_USAGE_COMPUTED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        contextUsage: action.contextUsage,
      }));
    case "COMPACTION_STARTED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        compacting: true,
      }));
    case "COMPACTION_FINISHED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        compacting: false,
      }));
    case "QUEUE_LOADED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        queue: action.queue,
      }));
    case "BACKGROUND_TERMINALS_LOADED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        backgroundTerminals: action.terminals,
      }));
    case "GOAL_LOADED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        goal: action.goal,
      }));
    case "ACTIVE_THREAD_SET": {
      // Selecting a thread from the sidebar, search, or a new/forked thread is
      // free navigation: the user reached somewhere they can leave again, so
      // any drill-in trail is stale and a "back" button offering to jump from
      // it would point somewhere they already left.
      //
      // `keepTrail` is set when the navigation *is* the drill-in (or the pop
      // out of one) and the trail is being managed by that action instead.
      if (action.keepTrail) {
        return { ...state, activeThreadId: action.threadId };
      }
      return { ...state, activeThreadId: action.threadId, threadTrail: [] };
    }
    case "THREAD_DRILLED_INTO": {
      // Re-entering a thread already on the trail returns to it rather than
      // stacking a second copy, so repeatedly clicking the same agent cannot
      // grow the trail without bound.
      const existing = state.threadTrail.findIndex((entry) => entry.threadId === action.threadId);
      const base =
        existing === -1 ? state.threadTrail : state.threadTrail.slice(0, existing);
      return {
        ...state,
        activeThreadId: action.threadId,
        threadTrail: [
          ...base,
          {
            threadId: action.threadId,
            fromThreadId: action.fromThreadId,
            reason: action.reason,
            label: action.label,
          },
        ],
      };
    }
    case "THREAD_TRAIL_POPPED": {
      const last = state.threadTrail.at(-1);
      if (!last) return state;
      return {
        ...state,
        activeThreadId: last.fromThreadId,
        threadTrail: state.threadTrail.slice(0, -1),
      };
    }
    case "AGENT_INFO_LOADED":
      return {
        ...state,
        threadTrail: state.threadTrail.map((entry) =>
          entry.threadId === action.threadId ? { ...entry, label: action.label } : entry,
        ),
      };
    case "ITEM_UPSERT_DELTA":
      return withThread(state, action.threadId, (thread) => {
        const existing = thread.items[action.itemId];
        // AgentMessage/Reasoning deltas accumulate `text`; item/completed
        // (below) is always authoritative and overwrites this wholesale.
        const text = (existing && "text" in existing ? existing.text : "") + action.deltaText;
        const item: ThreadItem = existing
          ? ({ ...existing, text } as ThreadItem)
          : ({ type: "agentMessage", id: action.itemId, text } as ThreadItem);
        const itemOrder = thread.itemOrder.includes(action.itemId)
          ? thread.itemOrder
          : [...thread.itemOrder, action.itemId];
        return {
          ...thread,
          items: { ...thread.items, [action.itemId]: item },
          itemTurnIds: { ...thread.itemTurnIds, [action.itemId]: action.turnId },
          itemOrder,
          activeTurnId: action.turnId,
        };
      });
    case "ITEM_STARTED":
      return withThread(state, action.threadId, (thread) => {
        // `item/started` carries the whole `ThreadItem`, so this is what makes
        // long-running work (a command execution, above all) visible while it
        // runs instead of only once it finishes — ADR-0013's "watch Codex
        // work" tier depends on it.
        //
        // If deltas raced ahead of this notification the accumulated item is
        // the more complete one; keep it rather than clobbering streamed text
        // with the empty item the server started from.
        const existing = thread.items[action.item.id];
        const item = existing ?? action.item;
        const itemOrder = thread.itemOrder.includes(action.item.id)
          ? thread.itemOrder
          : [...thread.itemOrder, action.item.id];
        return {
          ...thread,
          items: { ...thread.items, [action.item.id]: item },
          itemTurnIds: { ...thread.itemTurnIds, [action.item.id]: action.turnId },
          itemOrder,
          activeTurnId: action.turnId,
          // First item of the turn establishes the elapsed-time baseline.
          activeTurnStartedAtMs:
            thread.activeTurnId === action.turnId && thread.activeTurnStartedAtMs !== null
              ? thread.activeTurnStartedAtMs
              : action.startedAtMs,
        };
      });
    case "ITEM_OUTPUT_DELTA":
      return withThread(state, action.threadId, (thread) => {
        // Terminal output, not model text: it appends to `aggregatedOutput`,
        // which is why it can't share the `text`-oriented delta path above.
        const existing = thread.items[action.itemId];
        if (!existing || existing.type !== "commandExecution") {
          // Output for an item we haven't seen started yet; `item/completed`
          // carries the full `aggregatedOutput` anyway, so dropping the chunk
          // loses nothing permanent.
          return thread;
        }
        const command = existing as CommandExecutionItem;
        const item: ThreadItem = {
          ...command,
          aggregatedOutput: (command.aggregatedOutput ?? "") + action.deltaText,
        };
        return {
          ...thread,
          items: { ...thread.items, [action.itemId]: item },
          itemTurnIds: { ...thread.itemTurnIds, [action.itemId]: action.turnId },
        };
      });
    case "ITEM_COMPLETED":
      return withThread(state, action.threadId, (thread) => {
        const itemOrder = thread.itemOrder.includes(action.item.id)
          ? thread.itemOrder
          : [...thread.itemOrder, action.item.id];
        return {
          ...thread,
          items: { ...thread.items, [action.item.id]: action.item },
          itemTurnIds: { ...thread.itemTurnIds, [action.item.id]: action.turnId },
          itemOrder,
        };
      });
    case "TURN_STARTED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        activeTurnId: action.turnId,
        turnStatus: { ...thread.turnStatus, [action.turnId]: "inProgress" },
        // `turn/started` has no timestamp of its own; start the clock now and
        // let the first `item/started` refine it.
        activeTurnStartedAtMs: Date.now(),
      }));
    case "TURN_STATUS":
      return withThread(state, action.threadId, (thread) => {
        const stillRunning = action.status === "inProgress";
        return {
          ...thread,
          turnStatus: { ...thread.turnStatus, [action.turnId]: action.status },
          activeTurnId: stillRunning ? action.turnId : null,
          activeTurnStartedAtMs: stillRunning ? thread.activeTurnStartedAtMs : null,
        };
      });
    case "APPROVAL_REQUESTED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        pendingApprovals: [...thread.pendingApprovals, action.approval],
      }));
    case "APPROVAL_RESOLVED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        pendingApprovals: thread.pendingApprovals.filter(
          (approval) => JSON.stringify(approval.requestId) !== JSON.stringify(action.requestId),
        ),
      }));
    case "HISTORY_LOADING":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        historyStatus: "loading",
        historyError: null,
      }));
    // Drops every item this store holds for the thread, keeping the
    // thread-level state (goal, queue, terminals) that a revert doesn't touch.
    // Needed because `HISTORY_LOADED` *merges*: after `thread/revert` the
    // dropped turns would otherwise stay on screen, since a reload can only
    // add the retained ones back, never remove what is gone.
    case "HISTORY_CLEARED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        itemOrder: [],
        items: {},
        itemTurnIds: {},
        turnStatus: {},
        activeTurnId: null,
        activeTurnStartedAtMs: null,
        pendingApprovals: [],
        historyStatus: "loading",
        historyError: null,
      }));
    case "HISTORY_LOADED":
      return withThread(state, action.threadId, (thread) => {
        // Bulk-load rather than replaying through the delta path: `turn.items`
        // are already-complete items, and `turn.id` is the authoritative turn
        // id for every one of them.
        const items: Record<string, ThreadItem> = { ...thread.items };
        const itemTurnIds: Record<string, string> = { ...thread.itemTurnIds };
        const turnStatus: Record<string, TurnStatus> = { ...thread.turnStatus };
        const historyOrder: string[] = [];

        for (const turn of action.turns) {
          turnStatus[turn.id] = turn.status;
          for (const item of turn.items ?? []) {
            if (!(item.id in items)) historyOrder.push(item.id);
            items[item.id] = item;
            itemTurnIds[item.id] = turn.id;
          }
        }

        // History goes before anything that streamed in already (a live turn
        // can only ever be newer than persisted history).
        const itemOrder = [
          ...historyOrder,
          ...thread.itemOrder.filter((id) => !historyOrder.includes(id)),
        ];

        return {
          ...thread,
          items,
          itemTurnIds,
          turnStatus,
          itemOrder,
          // Keep a previously-known mode if this response omitted it, rather
          // than downgrading to "unknown" on a reload.
          historyMode: action.historyMode ?? thread.historyMode,
          historyStatus: "loaded",
          historyError: null,
        };
      });
    case "HISTORY_FAILED":
      return withThread(state, action.threadId, (thread) => ({
        ...thread,
        historyStatus: "error",
        historyError: action.error,
      }));
    case "APPROVAL_MODE_SET":
      return {
        ...state,
        approvalMode: action.mode,
        approvalModeOverridden: action.overrides || state.approvalModeOverridden,
      };
    case "IMPORT_PROGRESS":
      return {
        ...state,
        imports: {
          ...state.imports,
          [action.importId]: { results: action.results, done: action.done },
        },
      };
    case "THREAD_SETTINGS_APPLIED": {
      // The composer's indicators are app-level, so only the thread on screen
      // may drive them — a background thread's settings changing must not
      // relabel the one the user is looking at.
      if (action.threadId !== state.activeThreadId) return state;
      // `approvalMode` stays null when the thread's settings aren't one of the
      // three presets; leaving the previous label would be a worse lie than
      // leaving it alone, but there is no honest third label to show, so the
      // indicator keeps its last value and the settings screen remains the
      // place that reports the real config.
      return {
        ...state,
        approvalMode: action.indicators.approvalMode ?? state.approvalMode,
        modelSelection: {
          model: action.indicators.model,
          effort: action.indicators.effort ?? null,
        },
      };
    }
    case "MODELS_LOADED": {
      // Adopt the catalog's default as the initial selection, so the picker
      // shows what the server would actually use rather than a blank label.
      // Guarded on `model === null` so this can't overwrite a model already
      // taken from `config.toml` — the two loads race, and the persisted
      // setting must win over the catalog's generic default either way.
      const fallback = action.models.find((model) => model.isDefault) ?? action.models[0];
      const selection =
        state.modelSelection.model === null && fallback
          ? { model: fallback.model, effort: fallback.defaultReasoningEffort }
          : state.modelSelection;
      return { ...state, models: action.models, modelSelection: selection };
    }
    case "COLLABORATION_MODES_LOADED":
      return { ...state, collaborationModes: action.modes };
    case "COLLABORATION_MODE_SET":
      return { ...state, collaborationMode: action.mode };
    case "FEATURES_LOADED":
      return { ...state, features: action.features };
    case "PERSONALITY_SET":
      return { ...state, personality: action.personality };
    case "MODEL_SELECTION_SET":
      return {
        ...state,
        modelSelection: action.selection,
        modelSelectionOverridden: action.overrides || state.modelSelectionOverridden,
      };
    case "CONFIG_LOADED": {
      // The persisted defaults seed the session values, but never clobber a
      // choice the user already made in the composer this session (ADR-0020).
      const approvalMode =
        !state.approvalModeOverridden && action.defaultApprovalMode
          ? action.defaultApprovalMode
          : state.approvalMode;
      const modelSelection =
        !state.modelSelectionOverridden && action.config.model
          ? {
              model: action.config.model,
              effort: action.config.modelReasoningEffort ?? state.modelSelection.effort,
            }
          : state.modelSelection;
      return {
        ...state,
        config: action.config,
        configOrigins: action.origins,
        defaultApprovalMode: action.defaultApprovalMode,
        approvalMode,
        modelSelection,
      };
    }
    case "CONFIG_REQUIREMENTS_LOADED":
      return { ...state, configRequirements: action.requirements };
    case "SETTINGS_SCREEN_SET":
      return { ...state, settingsScreen: action.screen };
    case "NOTICE_PUSHED": {
      // Bounded: a server that emits warnings in a loop must not grow this
      // without limit. Newest first, since that is what a user looks at.
      const notices = [action.notice, ...state.notices].slice(0, 20);
      return { ...state, notices };
    }
    case "NOTICE_DISMISSED":
      return {
        ...state,
        notices: state.notices.filter((notice) => notice.id !== action.id),
      };
    case "MCP_RUNTIME_UPDATED":
      return {
        ...state,
        mcpRuntime: { ...state.mcpRuntime, [action.name]: action.runtime },
      };
    case "LOGIN_STARTED":
      return { ...state, pendingLogin: action.login };
    case "LOGIN_COMPLETED":
      // Keep the panel up with the reason on failure; clear it on success.
      return {
        ...state,
        pendingLogin: action.error
          ? state.pendingLogin
            ? { ...state.pendingLogin, error: action.error }
            : null
          : null,
      };
    default:
      return state;
  }
}

export const initialState: State = {
  projects: [],
  activeProjectPath: null,
  threadsByProject: {},
  archivedThreadsByProject: {},
  archivedVisible: {},
  search: emptySearch(),
  account: null,
  requiresOpenaiAuth: false,
  rateLimits: null,
  activeThreadId: null,
  threadTrail: [],
  threads: {},
  // Matches the Official App's default selection in the reference
  // screenshots. Replaced at startup by the persisted default from
  // `config.toml`, when that config names one of the three modes.
  approvalMode: "helpMeApprove",
  defaultApprovalMode: null,
  approvalModeOverridden: false,
  config: null,
  configOrigins: {},
  configRequirements: null,
  settingsScreen: null,
  notices: [],
  imports: {},
  models: [],
  // Null until `model/list` or `config/read` resolves; null means "let the
  // server decide".
  modelSelection: { model: null, effort: null },
  modelSelectionOverridden: false,
  collaborationModes: [],
  collaborationMode: "default",
  personality: null,
  features: [],
  mcpRuntime: {},
  pendingLogin: null,
  skills: [],
  apps: [],
};
