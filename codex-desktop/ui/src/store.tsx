import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import * as api from "./api";
import type {
  Account,
  AppServerEventEnvelope,
  ApprovalMode,
  CodexConfig,
  CommandExecutionItem,
  ConfigLayerMetadata,
  ConfigRequirements,
  Model,
  ModelSelection,
  PendingApproval,
  PendingCommandExecutionApproval,
  PendingPermissionsApproval,
  Project,
  RateLimitSnapshot,
  SettingEdit,
  ThreadItem,
  ThreadSearchResult,
  ThreadSummary,
  Turn,
  TurnStatus,
  McpServerRuntimeState,
  PendingLogin,
} from "./types";

/// Whether this thread's pre-existing history has been pulled in via
/// `thread/resume`. Threads created in this session start `loaded` (there is
/// no prior history to fetch); threads picked from the sidebar start `idle`
/// and must be resumed before their items exist locally at all.
type HistoryStatus = "idle" | "loading" | "loaded" | "error";

export interface ThreadState {
  itemOrder: string[];
  items: Record<string, ThreadItem>;
  /// item id -> the turn it belongs to. Populated from three sources so it is
  /// complete regardless of how an item arrived: `turn.id` when bulk-loading
  /// history, and the `turnId` on delta / `item/completed` notifications for
  /// live items. Backs the per-message Fork action (ADR-0018), which needs a
  /// `lastTurnId` to fork through.
  itemTurnIds: Record<string, string>;
  turnStatus: Record<string, TurnStatus>;
  activeTurnId: string | null;
  /// Unix ms when the active turn's first item started, taken from
  /// `item/started`'s `startedAtMs`. Backs the live "working for Xs" row —
  /// `Turn` carries `startedAt` but only on the resume/fork responses, never
  /// on the live `turn/started` notification.
  activeTurnStartedAtMs: number | null;
  pendingApprovals: PendingApproval[];
  historyStatus: HistoryStatus;
  historyError: string | null;
}

function emptyThread(): ThreadState {
  return {
    itemOrder: [],
    items: {},
    itemTurnIds: {},
    turnStatus: {},
    activeTurnId: null,
    activeTurnStartedAtMs: null,
    pendingApprovals: [],
    historyStatus: "idle",
    historyError: null,
  };
}

/// Sidebar search is a *mode*, not a filter over the Project tree: while it's
/// active the tree is replaced by results, and exiting restores it untouched.
/// `thread/search` has no cwd filter, so results span every Project.
interface SearchState {
  term: string;
  status: "idle" | "searching" | "done" | "error";
  results: ThreadSearchResult[];
  error: string | null;
}

interface State {
  projects: Project[];
  activeProjectPath: string | null;
  threadsByProject: Record<string, ThreadSummary[]>;
  /// Archived threads are a *separate* list call: the protocol's `archived`
  /// filter is tri-state (`true` = only archived, `false`/null = only
  /// non-archived), with no way to ask for both at once.
  archivedThreadsByProject: Record<string, ThreadSummary[]>;
  /// Which Projects have their archived section expanded. Without this the
  /// `thread/unarchive` RPC would be unreachable from the UI, making archive
  /// a one-way trip — so the archived view exists precisely to keep the
  /// action reversible.
  archivedVisible: Record<string, boolean>;
  search: SearchState;
  /// Read-only account state. There is deliberately no billing, upgrade or
  /// top-up affordance anywhere in this app, so nothing writes these.
  account: Account | null;
  requiresOpenaiAuth: boolean;
  rateLimits: RateLimitSnapshot | null;
  activeThreadId: string | null;
  threads: Record<string, ThreadState>;
  /// ADR-0016 layer 1. Held app-level rather than per-thread so switching
  /// threads keeps the user's chosen posture; applied to the server on thread
  /// start and on change.
  ///
  /// This is the *session* value. Its persisted counterpart is
  /// `defaultApprovalMode` — see the note on `approvalModeOverridden`.
  approvalMode: ApprovalMode;
  /// The value persisted in `config.toml` (ADR-0020). `null` means the config
  /// holds a combination the 3-preset selector can't express (a hand-edited
  /// file, or the `read-only` preset) — reported honestly rather than snapped
  /// to a preset the user never chose.
  defaultApprovalMode: ApprovalMode | null;
  /// Set once the composer changes the mode this session. ADR-0020 makes the
  /// composer an *override* of the persisted default: without this flag,
  /// editing the default in Settings would silently stomp a deliberate
  /// per-session choice the user made in the composer.
  approvalModeOverridden: boolean;
  /// Effective `config.toml` (all layers merged) and, per key, which layer it
  /// came from — so a setting pinned by an org policy can say so.
  config: CodexConfig | null;
  configOrigins: Record<string, ConfigLayerMetadata>;
  /// Deployment limits on allowed values; `null` when unconfigured (usual).
  configRequirements: ConfigRequirements | null;
  /// Whether the settings surface is open, and on which screen (ADR: the
  /// Official App shows settings as a full-window takeover, not a modal).
  settingsScreen: string | null;
  /// Model catalog from `model/list`, loaded once at startup. Empty until it
  /// resolves (or if it fails — the picker then simply has nothing to offer,
  /// which is better than blocking the composer).
  models: Model[];
  /// Same app-level treatment as `approvalMode`, for the same reason.
  modelSelection: ModelSelection;
  /// Composer override tracking, mirroring `approvalModeOverridden`.
  modelSelectionOverridden: boolean;
  /// Live MCP startup state, keyed by server name. `mcpServerStatus/list`
  /// reports auth status but not startup state, so this can only be
  /// accumulated from `mcpServer/startupStatus/updated` — a server that
  /// failed before this window opened has no entry here.
  mcpRuntime: Record<string, McpServerRuntimeState>;
  /// In-flight ChatGPT sign-in. Cleared by `account/login/completed`.
  pendingLogin: PendingLogin | null;
}

type Action =
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
  | { type: "ACTIVE_THREAD_SET"; threadId: string | null }
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
  | { type: "HISTORY_LOADED"; threadId: string; turns: Turn[] }
  | { type: "HISTORY_FAILED"; threadId: string; error: string }
  | { type: "APPROVAL_MODE_SET"; mode: ApprovalMode; overrides: boolean }
  | { type: "MODELS_LOADED"; models: Model[] }
  | { type: "MODEL_SELECTION_SET"; selection: ModelSelection; overrides: boolean }
  | {
      type: "CONFIG_LOADED";
      config: CodexConfig;
      origins: Record<string, ConfigLayerMetadata>;
      defaultApprovalMode: ApprovalMode | null;
    }
  | { type: "CONFIG_REQUIREMENTS_LOADED"; requirements: ConfigRequirements | null }
  | { type: "SETTINGS_SCREEN_SET"; screen: string | null }
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

/// Applies a per-thread transform across every Project's list. Notifications
/// carry only a `threadId`, never the Project it belongs to, so any update
/// has to sweep all of them.
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

/// Merges a sparse rolling rate-limit update over the last full snapshot.
/// Only `rate_limits` itself is non-optional on the notification; every field
/// inside it may be absent, and absent means "unchanged".
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

function reducer(state: State, action: Action): State {
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
    case "ACTIVE_THREAD_SET":
      return { ...state, activeThreadId: action.threadId };
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

const initialState: State = {
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
  models: [],
  // Null until `model/list` or `config/read` resolves; null means "let the
  // server decide".
  modelSelection: { model: null, effort: null },
  modelSelectionOverridden: false,
  mcpRuntime: {},
  pendingLogin: null,
};

interface StoreValue {
  state: State;
  dispatch: React.Dispatch<Action>;
  setActiveProject: (path: string | null) => Promise<void>;
  setActiveThread: (threadId: string | null) => Promise<void>;
  addProject: (path: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  startNewThread: (cwd: string) => Promise<void>;
  sendMessage: (threadId: string, text: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string) => Promise<void>;
  /// Thread management. Each is a thin call onto a `thread/*` RPC (ADR-0021);
  /// the resulting list changes arrive as server notifications rather than
  /// being assumed locally.
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  setArchivedVisible: (projectPath: string, visible: boolean) => Promise<void>;
  setSearchTerm: (term: string) => void;
  exitSearch: () => void;
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  setModelSelection: (selection: ModelSelection) => Promise<void>;
  interruptActiveTurn: (threadId: string) => Promise<void>;
  openSettings: (screen?: string) => void;
  closeSettings: () => void;
  /// Settings-screen writers (ADR-0020): these persist to `config.toml`,
  /// unlike their composer counterparts above which are session-only.
  setDefaultApprovalMode: (mode: ApprovalMode) => Promise<void>;
  writeSetting: (edit: SettingEdit) => Promise<void>;
  reloadConfig: () => Promise<void>;
  /// Account sign-in / sign-out (账户 screen). Read-only elsewhere: this app
  /// has no billing, upgrade or credit-purchase path anywhere.
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAccount: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

// Deltas that append to an item's `text`. All carry `delta` plus the
// `threadId`/`turnId`/`itemId` correlation key.
//
// `item/commandExecution/outputDelta` is deliberately *not* here: it appends to
// `aggregatedOutput` rather than `text`, so it gets its own action
// (`ITEM_OUTPUT_DELTA`) below.
const TEXT_DELTA_METHODS = new Set([
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  // Reasoning arrives on two channels — the raw text above and the summary
  // stream here. Both land in the same accumulated item text.
  "item/reasoning/summaryTextDelta",
]);

const COMMAND_OUTPUT_DELTA_METHOD = "item/commandExecution/outputDelta";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeProjectPathRef = useRef<string | null>(null);
  activeProjectPathRef.current = state.activeProjectPath;
  // Read inside callbacks that must not re-create on every thread-state
  // change (they'd otherwise re-run effects that depend on their identity).
  const threadsRef = useRef<Record<string, ThreadState>>({});
  threadsRef.current = state.threads;
  const approvalModeRef = useRef<ApprovalMode>(initialState.approvalMode);
  approvalModeRef.current = state.approvalMode;
  const activeThreadIdRef = useRef<string | null>(null);
  activeThreadIdRef.current = state.activeThreadId;

  const modelSelectionRef = useRef<ModelSelection>(initialState.modelSelection);
  modelSelectionRef.current = state.modelSelection;
  // Read at call time so cancelling targets the login that is actually in
  // flight, not one captured when the callback was created.
  const pendingLoginRef = useRef<PendingLogin | null>(null);
  pendingLoginRef.current = state.pendingLogin;

  useEffect(() => {
    api.listProjects().then((projects) => dispatch({ type: "PROJECTS_LOADED", projects }));
  }, []);

  useEffect(() => {
    api
      .listModels()
      .then((response) => dispatch({ type: "MODELS_LOADED", models: response.data ?? [] }))
      // A missing catalog leaves the picker empty rather than breaking the
      // composer; threads then run at whatever the server defaults to.
      .catch((error) => tracingWarn(`model/list failed: ${String(error)}`));
  }, []);

  /// Loads `config.toml` and seeds the session's approval mode / model from
  /// the persisted defaults (ADR-0020). Also used to refresh after a write, so
  /// the screens always show the server's view rather than an optimistic one.
  const reloadConfig = useCallback(async () => {
    const [read, defaultApprovalMode] = await Promise.all([
      api.readConfig(),
      // Mapped in Rust so the forward/reverse approval-mode mapping stays in
      // one place; `null` means "config isn't one of the three presets".
      api.readDefaultApprovalMode(),
    ]);
    dispatch({
      type: "CONFIG_LOADED",
      config: read.config ?? {},
      origins: read.origins ?? {},
      defaultApprovalMode,
    });
  }, []);

  useEffect(() => {
    // Config failing to load leaves the app on its built-in defaults rather
    // than blocking startup; the settings screens surface the error.
    reloadConfig().catch((error) => tracingWarn(`config/read failed: ${String(error)}`));
    api
      .readConfigRequirements()
      .then((response) =>
        dispatch({
          type: "CONFIG_REQUIREMENTS_LOADED",
          requirements: response.requirements ?? null,
        }),
      )
      .catch((error) => tracingWarn(`configRequirements/read failed: ${String(error)}`));
  }, [reloadConfig]);

  /// Read-only account state for the sidebar footer. A failure here leaves the
  /// footer showing nothing identifying rather than blocking the app — being
  /// signed in is not a precondition for the UI to render.
  const refetchAccount = useCallback(() => {
    api
      .readAccount()
      .then((response) =>
        dispatch({
          type: "ACCOUNT_LOADED",
          account: response.account ?? null,
          requiresOpenaiAuth: response.requiresOpenaiAuth ?? false,
        }),
      )
      .catch((error) => tracingWarn(`account/read failed: ${String(error)}`));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onAppServerEvent((envelope) => handleEvent(envelope, dispatch, { refetchAccount }))
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [refetchAccount]);

  useEffect(() => {
    refetchAccount();
    api
      .readAccountRateLimits()
      .then((response) =>
        dispatch({ type: "RATE_LIMITS_LOADED", rateLimits: response.rateLimits }),
      )
      .catch((error) => tracingWarn(`account/rateLimits/read failed: ${String(error)}`));
  }, [refetchAccount]);

  // Debounced search. Runs off the committed term rather than per keystroke,
  // and a stale in-flight response is discarded so fast typing can't let an
  // earlier query overwrite a later one.
  const searchTerm = state.search.term;
  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      dispatch({ type: "SEARCH_SUCCEEDED", results: [] });
      return;
    }
    let cancelled = false;
    dispatch({ type: "SEARCH_STARTED" });
    const timer = setTimeout(() => {
      api
        .searchThreads(term, 40)
        .then((response) => {
          if (!cancelled) {
            dispatch({ type: "SEARCH_SUCCEEDED", results: response.data ?? [] });
          }
        })
        .catch((error) => {
          if (!cancelled) dispatch({ type: "SEARCH_FAILED", error: String(error) });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const setActiveProject = useCallback(async (path: string | null) => {
    dispatch({ type: "ACTIVE_PROJECT_SET", path });
    dispatch({ type: "ACTIVE_THREAD_SET", threadId: null });
    if (!path) return;
    const response = await api.listThreads(path);
    dispatch({
      type: "THREADS_LOADED",
      projectPath: path,
      threads: response.data ?? [],
      archived: false,
    });
  }, []);

  // Threads picked from the sidebar have no items in this store yet — the
  // store is otherwise purely event-driven, so a thread that predates this app
  // session would render as a blank pane. `thread/resume` both loads the
  // thread server-side (so turns can be sent to it) and returns its full
  // history in `thread.turns`.
  const setActiveThread = useCallback(async (threadId: string | null) => {
    dispatch({ type: "ACTIVE_THREAD_SET", threadId });
    if (!threadId) return;

    const existing = threadsRef.current[threadId];
    if (existing && (existing.historyStatus === "loaded" || existing.historyStatus === "loading")) {
      return;
    }

    dispatch({ type: "HISTORY_LOADING", threadId });
    try {
      const response = await api.resumeThread(threadId);
      dispatch({ type: "HISTORY_LOADED", threadId, turns: response.thread?.turns ?? [] });
    } catch (error) {
      // Surfaced in the main pane rather than swallowed — a silently blank
      // pane is exactly the failure this path exists to prevent.
      dispatch({ type: "HISTORY_FAILED", threadId, error: String(error) });
    }
  }, []);

  const addProject = useCallback(async (path: string) => {
    const project = await api.addProject(path);
    dispatch({ type: "PROJECT_ADDED", project });
  }, []);

  const removeProject = useCallback(async (id: string) => {
    await api.removeProject(id);
    dispatch({ type: "PROJECT_REMOVED", id });
  }, []);

  const startNewThread = useCallback(async (cwd: string) => {
    const selection = modelSelectionRef.current;
    const response = (await api.startThread(
      cwd,
      approvalModeRef.current,
      selection.model,
      selection.effort,
    )) as {
      thread?: { id?: string };
    };
    const threadId = response.thread?.id;
    if (!threadId) return;
    dispatch({ type: "ACTIVE_THREAD_SET", threadId });
    // Brand new thread: there is no prior history to fetch, so mark it loaded
    // rather than letting `setActiveThread` resume an empty thread later.
    dispatch({ type: "HISTORY_LOADED", threadId, turns: [] });
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  const sendMessage = useCallback(async (threadId: string, text: string) => {
    await api.sendTurn(threadId, text);
  }, []);

  /// ADR-0018's Fork action. `thread/fork` returns the new thread, which
  /// becomes active; its history comes back through the normal resume path.
  const forkThreadFromTurn = useCallback(async (threadId: string, turnId: string) => {
    const response = await api.forkThread(threadId, turnId);
    const forkedId = response.thread?.id;
    if (!forkedId) return;
    dispatch({ type: "ACTIVE_THREAD_SET", threadId: forkedId });
    dispatch({ type: "HISTORY_LOADED", threadId: forkedId, turns: response.thread?.turns ?? [] });
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  // --- Thread management (all via `thread/*` RPCs — ADR-0021) ---------------
  //
  // These deliberately do not patch the sidebar optimistically. The server
  // broadcasts `thread/name/updated` / `thread/archived` / `thread/deleted`
  // for every one of them, and letting that notification be the single source
  // of the list update means a change made from the CLI lands identically to
  // one made here.

  const renameThread = useCallback(async (threadId: string, name: string) => {
    await api.setThreadName(threadId, name);
  }, []);

  const archiveThread = useCallback(async (threadId: string) => {
    await api.archiveThread(threadId);
  }, []);

  const unarchiveThread = useCallback(async (threadId: string) => {
    await api.unarchiveThread(threadId);
    // No `thread/unarchived` handler can refresh the *non*-archived list on
    // its own — it only knows the thread id, not which Project list to add it
    // back to — so re-list the active Project here.
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    await api.deleteThread(threadId);
  }, []);

  /// Expanding the archived section lazily fetches it — a second `thread/list`
  /// call, since the protocol's `archived` filter can't return both states at
  /// once.
  const setArchivedVisible = useCallback(async (projectPath: string, visible: boolean) => {
    dispatch({ type: "ARCHIVED_VISIBILITY_SET", projectPath, visible });
    if (!visible) return;
    const list = await api.listThreads(projectPath, true);
    dispatch({
      type: "THREADS_LOADED",
      projectPath,
      threads: list.data ?? [],
      archived: true,
    });
  }, []);

  const setSearchTerm = useCallback((term: string) => {
    dispatch({ type: "SEARCH_TERM_SET", term });
  }, []);

  const exitSearch = useCallback(() => {
    dispatch({ type: "SEARCH_EXITED" });
  }, []);

  /// ADR-0016 layer 1, composer side. Applied to the active thread
  /// immediately and carried onto later threads by `startNewThread`, but
  /// deliberately *not* written to `config.toml`: ADR-0020 makes this an
  /// override of the persisted default, not a way to silently rewrite it.
  const setApprovalMode = useCallback(async (mode: ApprovalMode) => {
    dispatch({ type: "APPROVAL_MODE_SET", mode, overrides: true });
    const threadId = activeThreadIdRef.current;
    if (threadId) await api.setApprovalMode(threadId, mode);
  }, []);

  /// Same shape as `setApprovalMode`, and the same override semantics.
  const setModelSelection = useCallback(async (selection: ModelSelection) => {
    dispatch({ type: "MODEL_SELECTION_SET", selection, overrides: true });
    const threadId = activeThreadIdRef.current;
    if (threadId) await api.setModel(threadId, selection.model, selection.effort);
  }, []);

  /// Settings side of the same setting: persists to `config.toml`, then
  /// reloads so the session value follows unless the composer overrode it.
  const setDefaultApprovalMode = useCallback(
    async (mode: ApprovalMode) => {
      await api.setDefaultApprovalMode(mode);
      await reloadConfig();
    },
    [reloadConfig],
  );

  /// Generic single-key writer behind the settings controls. Reloads rather
  /// than optimistically patching local state: the server may normalize the
  /// value, or refuse it because a managed layer pins the key.
  const writeSetting = useCallback(
    async (edit: SettingEdit) => {
      await api.writeConfigValue(edit);
      await reloadConfig();
    },
    [reloadConfig],
  );

  const openSettings = useCallback((screen = "general") => {
    dispatch({ type: "SETTINGS_SCREEN_SET", screen });
  }, []);

  const closeSettings = useCallback(() => {
    dispatch({ type: "SETTINGS_SCREEN_SET", screen: null });
  }, []);

  /// Stops the thread's running turn. Reads `activeTurnId` at call time rather
  /// than from a captured render, so a turn that finished between paint and
  /// click is a no-op instead of an interrupt aimed at a stale turn id.
  const interruptActiveTurn = useCallback(async (threadId: string) => {
    const thread = threadsRef.current[threadId];
    const turnId = thread?.activeTurnId;
    if (!turnId || thread?.turnStatus[turnId] !== "inProgress") return;
    await api.interruptTurn(threadId, turnId);
  }, []);

  /// Starts ChatGPT sign-in and opens the returned URL. `account/login/start`
  /// only *begins* the flow — completion arrives as
  /// `account/login/completed`, which is what clears `pendingLogin`.
  const startLogin = useCallback(async () => {
    const response = await api.startAccountLogin();
    if (response.type === "chatgpt") {
      dispatch({
        type: "LOGIN_STARTED",
        login: { loginId: response.loginId, authUrl: response.authUrl, error: null },
      });
      // Reuses the OS handler already used for `config.toml`; `open`/`start`/
      // `xdg-open` all take URLs as readily as paths.
      await api.openPathInOs(response.authUrl);
      return;
    }
    if (response.type === "chatgptDeviceCode") {
      dispatch({
        type: "LOGIN_STARTED",
        login: {
          loginId: response.loginId,
          authUrl: response.verificationUrl,
          error: `请在浏览器中输入代码：${response.userCode}`,
        },
      });
      await api.openPathInOs(response.verificationUrl);
      return;
    }
    // The remaining arms complete server-side with no URL to visit.
    dispatch({ type: "LOGIN_COMPLETED", error: null });
    refetchAccount();
  }, [refetchAccount]);

  const cancelLogin = useCallback(async () => {
    const loginId = pendingLoginRef.current?.loginId;
    if (!loginId) return;
    await api.cancelAccountLogin(loginId);
    dispatch({ type: "LOGIN_COMPLETED", error: null });
  }, []);

  const logout = useCallback(async () => {
    await api.logoutAccount();
    refetchAccount();
  }, [refetchAccount]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      dispatch,
      setActiveProject,
      setActiveThread,
      addProject,
      removeProject,
      startNewThread,
      sendMessage,
      forkThreadFromTurn,
      renameThread,
      archiveThread,
      unarchiveThread,
      deleteThread,
      setArchivedVisible,
      setSearchTerm,
      exitSearch,
      setApprovalMode,
      setModelSelection,
      interruptActiveTurn,
      openSettings,
      closeSettings,
      setDefaultApprovalMode,
      writeSetting,
      reloadConfig,
      startLogin,
      cancelLogin,
      logout,
      refreshAccount: refetchAccount,
    }),
    [
      state,
      setActiveProject,
      setActiveThread,
      addProject,
      removeProject,
      startNewThread,
      sendMessage,
      forkThreadFromTurn,
      renameThread,
      archiveThread,
      unarchiveThread,
      deleteThread,
      setArchivedVisible,
      setSearchTerm,
      exitSearch,
      setApprovalMode,
      setModelSelection,
      interruptActiveTurn,
      openSettings,
      closeSettings,
      setDefaultApprovalMode,
      writeSetting,
      reloadConfig,
      startLogin,
      cancelLogin,
      logout,
      refetchAccount,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used within StoreProvider");
  return value;
}

function handleEvent(
  envelope: AppServerEventEnvelope,
  dispatch: React.Dispatch<Action>,
  effects: NotificationEffects,
) {
  if (envelope.kind === "notification" && envelope.notification) {
    handleNotification(
      envelope.notification.method,
      envelope.notification.params,
      dispatch,
      effects,
    );
  } else if (envelope.kind === "request" && envelope.request) {
    handleServerRequest(envelope.requestId, envelope.request, dispatch);
  } else if (envelope.kind === "disconnected") {
    tracingWarn(`app-server disconnected: ${envelope.message ?? "unknown reason"}`);
  }
}

/// Side effects a notification can trigger beyond a plain dispatch — kept as
/// an explicit parameter so `handleNotification` stays a pure-ish function
/// rather than reaching for module-level state.
interface NotificationEffects {
  refetchAccount: () => void;
}

function handleNotification(
  method: string,
  params: unknown,
  dispatch: React.Dispatch<Action>,
  effects: NotificationEffects,
) {
  const p = params as Record<string, unknown>;
  if (TEXT_DELTA_METHODS.has(method)) {
    dispatch({
      type: "ITEM_UPSERT_DELTA",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      itemId: String(p.itemId),
      deltaText: String(p.delta ?? ""),
    });
    return;
  }
  if (method === COMMAND_OUTPUT_DELTA_METHOD) {
    dispatch({
      type: "ITEM_OUTPUT_DELTA",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      itemId: String(p.itemId),
      deltaText: String(p.delta ?? ""),
    });
    return;
  }
  if (method === "item/started") {
    dispatch({
      type: "ITEM_STARTED",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      item: p.item as ThreadItem,
      startedAtMs: Number(p.startedAtMs ?? Date.now()),
    });
    return;
  }
  if (method === "item/completed") {
    dispatch({
      type: "ITEM_COMPLETED",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      item: p.item as ThreadItem,
    });
    return;
  }
  if (method === "turn/started") {
    const turn = p.turn as Record<string, unknown> | undefined;
    dispatch({
      type: "TURN_STARTED",
      threadId: String(p.threadId),
      turnId: String(turn?.id ?? p.turnId ?? ""),
    });
    return;
  }
  if (method === "turn/completed") {
    const turn = p.turn as Record<string, unknown> | undefined;
    const status = String(turn?.status ?? "completed") as TurnStatus;
    dispatch({
      type: "TURN_STATUS",
      threadId: String(p.threadId),
      turnId: String(turn?.id ?? ""),
      status,
    });
    return;
  }

  // Thread lifecycle. These are the single source of truth for sidebar list
  // changes — a rename or archive performed from the CLI arrives here exactly
  // like one performed in this window (ADR-0021).
  if (method === "thread/name/updated") {
    dispatch({
      type: "THREAD_RENAMED",
      threadId: String(p.threadId),
      // The field is optional: absent means the name was cleared.
      name: typeof p.threadName === "string" ? p.threadName : null,
    });
    return;
  }
  if (method === "thread/archived" || method === "thread/deleted") {
    dispatch({ type: "THREAD_REMOVED_FROM_LIST", threadId: String(p.threadId) });
    return;
  }
  if (method === "thread/unarchived") {
    dispatch({ type: "THREAD_REMOVED_FROM_ARCHIVE", threadId: String(p.threadId) });
    return;
  }

  // Account. Read-only: nothing in this app writes account or billing state.
  if (method === "account/updated") {
    // The notification carries only `authMode`/`planType` — never the email —
    // so a plan change can be merged in place, but anything that could have
    // changed *which* account is signed in has to come from `account/read`.
    dispatch({
      type: "ACCOUNT_PLAN_UPDATED",
      planType: typeof p.planType === "string" ? p.planType : null,
    });
    effects.refetchAccount();
    return;
  }
  if (method === "account/rateLimits/updated") {
    dispatch({
      type: "RATE_LIMITS_MERGED",
      rateLimits: p.rateLimits as RateLimitSnapshot,
    });
    return;
  }
  if (method === "account/login/completed") {
    // `success: false` carries the reason; either way the account itself has
    // to be re-read, since the notification never carries identity.
    dispatch({
      type: "LOGIN_COMPLETED",
      error: p.success === true ? null : String(p.error ?? "登录未完成"),
    });
    effects.refetchAccount();
    return;
  }

  // MCP startup state. The only source for this — `mcpServerStatus/list`
  // reports auth status but never whether the server actually came up.
  if (method === "mcpServer/startupStatus/updated") {
    dispatch({
      type: "MCP_RUNTIME_UPDATED",
      name: String(p.name),
      runtime: {
        status: String(p.status) as McpServerRuntimeState["status"],
        error: typeof p.error === "string" ? p.error : null,
        failureReason: typeof p.failureReason === "string" ? p.failureReason : null,
      },
    });
    return;
  }
  if (method === "mcpServer/oauthLogin/completed") {
    // Login result folds into the same runtime map: a failed OAuth login is
    // exactly the state the 连接 screen needs to surface.
    dispatch({
      type: "MCP_RUNTIME_UPDATED",
      name: String(p.name),
      runtime:
        p.success === true
          ? { status: "ready", error: null, failureReason: null }
          : {
              status: "failed",
              error: String(p.error ?? "OAuth 登录失败"),
              failureReason: null,
            },
    });
  }
}

function handleServerRequest(
  requestId: unknown,
  request: { method: string; params: unknown },
  dispatch: React.Dispatch<Action>,
) {
  const p = request.params as Record<string, unknown>;
  const base = {
    requestId,
    threadId: String(p.threadId),
    turnId: String(p.turnId),
    itemId: String(p.itemId ?? ""),
  };
  if (request.method === "item/commandExecution/requestApproval") {
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "commandExecution",
        command: p.command as string | undefined,
        cwd: p.cwd as string | undefined,
        reason: p.reason as string | null | undefined,
        // Carried through so the card can show, and echo back verbatim, what
        // the server actually proposed (never a synthesized amendment).
        proposedExecpolicyAmendment:
          p.proposedExecpolicyAmendment as PendingCommandExecutionApproval["proposedExecpolicyAmendment"],
        proposedNetworkPolicyAmendments:
          p.proposedNetworkPolicyAmendments as PendingCommandExecutionApproval["proposedNetworkPolicyAmendments"],
        availableDecisions:
          p.availableDecisions as PendingCommandExecutionApproval["availableDecisions"],
      },
    });
  } else if (request.method === "item/fileChange/requestApproval") {
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "fileChange",
        reason: p.reason as string | null | undefined,
        grantRoot: p.grantRoot as string | null | undefined,
      },
    });
  } else if (request.method === "item/permissions/requestApproval") {
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "permissions",
        reason: p.reason as string | null | undefined,
        cwd: p.cwd as string | undefined,
        // The whole point of the permissions card: show what's requested.
        permissions: p.permissions as PendingPermissionsApproval["permissions"],
      },
    });
  }
}

function tracingWarn(message: string) {
  // eslint-disable-next-line no-console
  console.warn(message);
}
