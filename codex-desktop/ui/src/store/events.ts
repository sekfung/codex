/**
 * Routing for everything the app-server pushes at us.
 *
 * Split out of `store.tsx` so the reducer, this router and the provider each
 * change for one reason. Both directions are dispatch maps rather than `if`
 * cascades: a cascade hides which methods are covered, and the coverage *is*
 * the contract here — an unrouted notification is silently lost state, and an
 * unrendered server request is a decision the user never gets to make.
 */
import * as api from "../api";
import type {
  AppServerEventEnvelope,
  McpServerRuntimeState,
  Notice,
  PendingCommandExecutionApproval,
  PendingPermissionsApproval,
  PendingUserInputRequest,
  ThreadGoal,
  ThreadItem,
  ThreadTokenUsage,
  ImportTypeResult,
  RateLimitSnapshot,
  TurnStatus,
} from "../types";
import type { Action } from "./reducer";

type Dispatch = React.Dispatch<Action>;

/** Loosely-typed notification params. Each handler narrows what it reads. */
type Params = Record<string, unknown>;

/**
 * Side effects a notification can trigger beyond a plain dispatch — kept as an
 * explicit parameter so the router stays a pure-ish function rather than
 * reaching for module-level state.
 */
export interface NotificationEffects {
  refetchAccount: () => void;
  refetchSkills: () => void;
  refetchApps: () => void;
  /**
   * Token usage arrives as raw counts; turning them into a percentage is
   * engine arithmetic, so it round-trips to Rust rather than being computed
   * here (ADR-0021). One call per usage notification, which fires per turn,
   * not per token.
   */
  computeContextUsage: (threadId: string, usage: ThreadTokenUsage) => void;
  /**
   * `ThreadQueueChangedNotification` carries only a thread id — like
   * `skills/changed` it reports *that* the queue changed, never how — so a
   * re-list is the only correct response.
   */
  refetchQueue: (threadId: string) => void;
  /**
   * `thread/settings/updated` carries the full `ThreadSettings`, so the
   * composer's indicators can be corrected from the server's own view rather
   * than left showing what this client optimistically asked for. Mapped in
   * Rust: `AskForApproval` has a `Granular { … }` variant, and the
   * approval-mode inverse belongs next to its forward direction.
   */
  applyThreadSettings: (threadId: string, settings: unknown) => void;
}

interface NotificationContext {
  method: string;
  p: Params;
  dispatch: Dispatch;
  effects: NotificationEffects;
}

type NotificationHandler = (ctx: NotificationContext) => void;

/**
 * Deltas that append to an item's `text`. All carry `delta` plus the
 * `threadId`/`turnId`/`itemId` correlation key.
 *
 * `item/commandExecution/outputDelta` is deliberately *not* here: it appends to
 * `aggregatedOutput` rather than `text`, so it gets its own action
 * (`ITEM_OUTPUT_DELTA`).
 */
const TEXT_DELTA_METHODS = [
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  // Reasoning arrives on two channels — the raw text above and the summary
  // stream here. Both land in the same accumulated item text.
  "item/reasoning/summaryTextDelta",
];

/** Notices carry no server-side id, so one is minted here for dismissal. */
export function pushNotice(
  dispatch: Dispatch,
  notice: Omit<Notice, "id"> & { details?: string | null; threadId?: string | null },
) {
  dispatch({
    type: "NOTICE_PUSHED",
    notice: { ...notice, id: `${notice.source}-${Date.now()}-${Math.random()}` },
  });
}

/** Builds the handler shared by every method in {@link TEXT_DELTA_METHODS}. */
function textDelta({ p, dispatch }: NotificationContext) {
  dispatch({
    type: "ITEM_UPSERT_DELTA",
    threadId: String(p.threadId),
    turnId: String(p.turnId),
    itemId: String(p.itemId),
    deltaText: String(p.delta ?? ""),
  });
}

/** Shared by `externalAgentConfig/import/progress` and `/completed`. */
function importProgress({ method, p, dispatch }: NotificationContext) {
  dispatch({
    type: "IMPORT_PROGRESS",
    importId: String(p.importId),
    results: (p.itemTypeResults ?? []) as ImportTypeResult[],
    done: method === "externalAgentConfig/import/completed",
  });
}

/** Shared by `thread/archived` and `thread/deleted`: both drop the row. */
function threadRemoved({ p, dispatch }: NotificationContext) {
  dispatch({ type: "THREAD_REMOVED_FROM_LIST", threadId: String(p.threadId) });
}

const NOTIFICATION_HANDLERS: Record<string, NotificationHandler> = {
  ...Object.fromEntries(TEXT_DELTA_METHODS.map((method) => [method, textDelta])),

  "item/commandExecution/outputDelta": ({ p, dispatch }) =>
    dispatch({
      type: "ITEM_OUTPUT_DELTA",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      itemId: String(p.itemId),
      deltaText: String(p.delta ?? ""),
    }),

  "item/started": ({ p, dispatch }) =>
    dispatch({
      type: "ITEM_STARTED",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      item: p.item as ThreadItem,
      startedAtMs: Number(p.startedAtMs ?? Date.now()),
    }),

  "item/completed": ({ p, dispatch }) =>
    dispatch({
      type: "ITEM_COMPLETED",
      threadId: String(p.threadId),
      turnId: String(p.turnId),
      item: p.item as ThreadItem,
    }),

  "turn/started": ({ p, dispatch }) => {
    const turn = p.turn as Params | undefined;
    dispatch({
      type: "TURN_STARTED",
      threadId: String(p.threadId),
      turnId: String(turn?.id ?? p.turnId ?? ""),
    });
  },

  "turn/completed": ({ p, dispatch }) => {
    const turn = p.turn as Params | undefined;
    dispatch({
      type: "TURN_STATUS",
      threadId: String(p.threadId),
      turnId: String(turn?.id ?? ""),
      status: String(turn?.status ?? "completed") as TurnStatus,
    });
  },

  "thread/tokenUsage/updated": ({ p, dispatch, effects }) => {
    const threadId = String(p.threadId);
    const tokenUsage = p.tokenUsage as ThreadTokenUsage;
    dispatch({ type: "TOKEN_USAGE_UPDATED", threadId, tokenUsage });
    effects.computeContextUsage(threadId, tokenUsage);
  },

  "thread/compacted": ({ p, dispatch }) =>
    dispatch({ type: "COMPACTION_FINISHED", threadId: String(p.threadId) }),

  // The queue is engine-owned: it changes both when this window edits it and
  // when the engine itself dispatches the head of it on turn completion. This
  // notification is the single source of truth for both.
  "thread/queue/changed": ({ p, effects }) => effects.refetchQueue(String(p.threadId)),

  "externalAgentConfig/import/progress": importProgress,
  "externalAgentConfig/import/completed": importProgress,

  // Fires for CLI-side changes on a shared `$CODEX_HOME` (ADR-0008) and for
  // this client's own writes; either way the payload is the authority on what
  // is actually in force.
  "thread/settings/updated": ({ p, effects }) =>
    effects.applyThreadSettings(String(p.threadId), p.threadSettings),

  "thread/goal/updated": ({ p, dispatch }) =>
    dispatch({
      type: "GOAL_LOADED",
      threadId: String(p.threadId),
      goal: p.goal as ThreadGoal,
    }),

  "thread/goal/cleared": ({ p, dispatch }) =>
    dispatch({ type: "GOAL_LOADED", threadId: String(p.threadId), goal: null }),

  // `SkillsChangedNotification` is an empty struct — it says *that* skills
  // changed, never which, so the only correct response is a re-list.
  "skills/changed": ({ effects }) => effects.refetchSkills(),

  // `AppListUpdatedNotification` carries the full list, but it is the
  // *unfiltered* catalog; re-listing keeps one code path deciding what is
  // mentionable.
  "app/list/updated": ({ effects }) => effects.refetchApps(),

  // Thread lifecycle. These are the single source of truth for sidebar list
  // changes — a rename or archive performed from the CLI arrives here exactly
  // like one performed in this window (ADR-0021).
  "thread/name/updated": ({ p, dispatch }) =>
    dispatch({
      type: "THREAD_RENAMED",
      threadId: String(p.threadId),
      // The field is optional: absent means the name was cleared.
      name: typeof p.threadName === "string" ? p.threadName : null,
    }),

  "thread/archived": threadRemoved,
  "thread/deleted": threadRemoved,

  "thread/unarchived": ({ p, dispatch }) =>
    dispatch({ type: "THREAD_REMOVED_FROM_ARCHIVE", threadId: String(p.threadId) }),

  // Account. Read-only: nothing in this app writes account or billing state.
  "account/updated": ({ p, dispatch, effects }) => {
    // The notification carries only `authMode`/`planType` — never the email —
    // so a plan change can be merged in place, but anything that could have
    // changed *which* account is signed in has to come from `account/read`.
    dispatch({
      type: "ACCOUNT_PLAN_UPDATED",
      planType: typeof p.planType === "string" ? p.planType : null,
    });
    effects.refetchAccount();
  },

  "account/rateLimits/updated": ({ p, dispatch }) =>
    dispatch({
      type: "RATE_LIMITS_MERGED",
      rateLimits: p.rateLimits as RateLimitSnapshot,
    }),

  "account/login/completed": ({ p, dispatch, effects }) => {
    // `success: false` carries the reason; either way the account itself has
    // to be re-read, since the notification never carries identity.
    dispatch({
      type: "LOGIN_COMPLETED",
      error: p.success === true ? null : String(p.error ?? "登录未完成"),
    });
    effects.refetchAccount();
  },

  // MCP startup state. The only source for this — `mcpServerStatus/list`
  // reports auth status but never whether the server actually came up.
  "mcpServer/startupStatus/updated": ({ p, dispatch }) =>
    dispatch({
      type: "MCP_RUNTIME_UPDATED",
      name: String(p.name),
      runtime: {
        status: String(p.status) as McpServerRuntimeState["status"],
        error: typeof p.error === "string" ? p.error : null,
        failureReason: typeof p.failureReason === "string" ? p.failureReason : null,
      },
    }),

  // Login result folds into the same runtime map: a failed OAuth login is
  // exactly the state the 连接 screen needs to surface.
  "mcpServer/oauthLogin/completed": ({ p, dispatch }) =>
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
    }),

  // --- Notices -------------------------------------------------------------
  // These were all previously discarded. A malformed config, a guardian
  // warning, or a silently substituted model left no trace in the UI at all.
  warning: ({ method, p, dispatch }) =>
    pushNotice(dispatch, {
      severity: "warning",
      source: method,
      message: String(p.message ?? ""),
      threadId: p.threadId == null ? null : String(p.threadId),
    }),

  guardianWarning: ({ method, p, dispatch }) =>
    pushNotice(dispatch, {
      severity: "warning",
      source: method,
      message: String(p.message ?? ""),
      threadId: String(p.threadId ?? ""),
    }),

  error: ({ method, p, dispatch }) => {
    // `willRetry` errors are transient and do not interrupt the turn, so they
    // are informational rather than failures the user must act on.
    const willRetry = p.willRetry === true;
    const error = p.error as { message?: string } | undefined;
    pushNotice(dispatch, {
      severity: willRetry ? "info" : "error",
      source: method,
      message: error?.message ?? "Codex 报告了一个错误",
      details: willRetry ? "这是暂时性错误，Codex 会自动重试。" : null,
      threadId: String(p.threadId ?? ""),
    });
  },

  configWarning: ({ method, p, dispatch }) =>
    pushNotice(dispatch, {
      severity: "warning",
      source: method,
      message: String(p.summary ?? ""),
      // The path matters here: a config warning the user can't locate is hard
      // to act on.
      details: [p.details, p.path].filter(Boolean).join(" — ") || null,
    }),

  deprecationNotice: ({ method, p, dispatch }) =>
    pushNotice(dispatch, {
      severity: "info",
      source: method,
      message: String(p.summary ?? ""),
      details: p.details == null ? null : String(p.details),
    }),

  // The model changed under the user. The composer still shows what they
  // picked, so without this there is no sign at all that a different model
  // answered.
  "model/rerouted": ({ method, p, dispatch }) =>
    pushNotice(dispatch, {
      severity: "info",
      source: method,
      message: `模型已切换：${String(p.fromModel ?? "")} → ${String(p.toModel ?? "")}`,
      details: p.reason == null ? null : String(p.reason),
      threadId: String(p.threadId ?? ""),
    }),

  // --- Notifications belonging to features this client already ships -------
  // Revert triggered from elsewhere — the CLI shares this $CODEX_HOME
  // (ADR-0008), so history can be rewritten without this client asking.
  // `revertThread` already reloads after its own call; this covers the rest.
  // Clear first: `HISTORY_LOADED` merges, so the dropped turns would otherwise
  // linger on screen.
  "thread/reverted": ({ p, dispatch }) => {
    const threadId = String(p.threadId);
    dispatch({ type: "HISTORY_CLEARED", threadId });
    void api
      .resumeThread(threadId)
      .then((response) =>
        dispatch({
          type: "HISTORY_LOADED",
          threadId,
          turns: response.thread?.turns ?? [],
          historyMode: response.thread?.historyMode ?? null,
        }),
      )
      .catch((error) => dispatch({ type: "HISTORY_FAILED", threadId, error: String(error) }));
  },
};

interface ServerRequestContext {
  requestId: unknown;
  p: Params;
  /**
   * The fields every approval card keys on. Extracted once because
   * `turnId` in particular needs care — see the comment where it is built.
   */
  base: { requestId: unknown; threadId: string; turnId: string; itemId: string };
  dispatch: Dispatch;
}

type ServerRequestHandler = (ctx: ServerRequestContext) => void;

const SERVER_REQUEST_HANDLERS: Record<string, ServerRequestHandler> = {
  "item/commandExecution/requestApproval": ({ p, base, dispatch }) =>
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
    }),

  "item/fileChange/requestApproval": ({ p, base, dispatch }) =>
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "fileChange",
        reason: p.reason as string | null | undefined,
        grantRoot: p.grantRoot as string | null | undefined,
      },
    }),

  "item/permissions/requestApproval": ({ p, base, dispatch }) =>
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
    }),

  // A tool is asking the user a question. Unhandled, this blocks the turn
  // forever with nothing on screen — it is a server *request*, so the engine
  // waits for a response rather than moving on.
  "item/tool/requestUserInput": ({ p, base, dispatch }) =>
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "userInput",
        questions: (p.questions ?? []) as PendingUserInputRequest["questions"],
        // Absent means blocking: the protocol's own deserializer defaults
        // `isBlocking` to true when the field is missing.
        isBlocking: p.isBlocking === undefined ? true : Boolean(p.isBlocking),
      },
    }),

  // An MCP server asking the user for input. Blocks the turn like the
  // approvals do; the form schema is flattened by Rust (`elicitation_view`)
  // rather than parsed here.
  "mcpServer/elicitation/request": ({ p, base, dispatch }) =>
    dispatch({
      type: "APPROVAL_REQUESTED",
      threadId: base.threadId,
      approval: {
        ...base,
        kind: "elicitation",
        serverName: String(p.serverName ?? ""),
        params: p,
      },
    }),
};

export function handleEvent(
  envelope: AppServerEventEnvelope,
  dispatch: Dispatch,
  effects: NotificationEffects,
) {
  if (envelope.kind === "notification" && envelope.notification) {
    handleNotification(envelope.notification.method, envelope.notification.params, dispatch, effects);
  } else if (envelope.kind === "request" && envelope.request) {
    handleServerRequest(envelope.requestId, envelope.request, dispatch);
  } else if (envelope.kind === "disconnected") {
    tracingWarn(`app-server disconnected: ${envelope.message ?? "unknown reason"}`);
  }
}

export function handleNotification(
  method: string,
  params: unknown,
  dispatch: Dispatch,
  effects: NotificationEffects,
) {
  const handler = NOTIFICATION_HANDLERS[method];
  if (!handler) {
    // Previously this fell through in silence, which is how
    // `item/reasoning/summaryTextDelta` went unhandled long enough to lose
    // summary text on every turn. An unrouted notification is dropped state,
    // so it should be visible even though it cannot hang anything.
    tracingWarn(`unrouted app-server notification: ${method}`);
    return;
  }
  handler({ method, p: params as Params, dispatch, effects });
}

export function handleServerRequest(
  requestId: unknown,
  request: { method: string; params: unknown },
  dispatch: Dispatch,
) {
  const p = request.params as Params;
  const base = {
    requestId,
    threadId: String(p.threadId),
    // Nullable on elicitations: MCP models them as standalone server-to-client
    // requests, so app-server can only attach a turn when it managed to
    // correlate one. `String(undefined)` would put the literal "undefined"
    // here and silently key the card to a turn that doesn't exist.
    turnId: p.turnId == null ? "" : String(p.turnId),
    itemId: String(p.itemId ?? ""),
  };

  const handler = SERVER_REQUEST_HANDLERS[request.method];
  if (!handler) {
    // The bridge answers anything unrecognized before it ever reaches the
    // webview (`src/server_requests.rs`), so this is a "we forgot to render
    // something the router forwards" bug, not a hang.
    tracingWarn(`unhandled server request forwarded by the bridge: ${request.method}`);
    return;
  }
  handler({ requestId, p, base, dispatch });
}

export function tracingWarn(message: string) {
  // eslint-disable-next-line no-console
  console.warn(message);
}
