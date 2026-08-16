// Loosely typed to match the Rust backend's camelCase JSON (see
// `codex-desktop/src/commands.rs` — most responses are forwarded raw rather
// than hand-mapped, per that file's module doc). Fields we don't render yet
// are typed `unknown`/omitted rather than guessed at.

export interface Project {
  id: string;
  path: string;
  name: string;
  addedAtMs: number;
}

// -- ThreadItem (ADR-0013's tiers) ------------------------------------------
// `#[serde(tag = "type", rename_all = "camelCase")]` on the Rust enum, so
// every item is `{ type: "<variantName in camelCase>", id, ...fields }`.

export interface BaseItem {
  id: string;
}

export interface UserMessageItem extends BaseItem {
  type: "userMessage";
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface AgentMessageItem extends BaseItem {
  type: "agentMessage";
  text: string;
}

export interface ReasoningItem extends BaseItem {
  type: "reasoning";
  summary: string[];
  content: string[];
}

export interface CommandExecutionItem extends BaseItem {
  type: "commandExecution";
  command: string;
  cwd: string;
  status: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

/** `FileUpdateChange` (v2/item.rs): `{ path, kind, diff }`. */
export interface FileUpdateChange {
  path: string;
  kind: { type: "add" | "delete" | "update"; movePath?: string | null };
  diff: string;
}

export interface FileChangeItem extends BaseItem {
  type: "fileChange";
  changes: FileUpdateChange[];
  status: string;
}

// Generic-fallback tier (ADR-0013): rendered with one shared minimal card.
export interface GenericToolItem extends BaseItem {
  type:
    | "mcpToolCall"
    | "webSearch"
    | "imageGeneration"
    | "enteredReviewMode"
    | "exitedReviewMode";
  [key: string]: unknown;
}

// Multi-agent (ADR-0014).
/** `CollabAgentTool` — which collab operation the parent invoked. */
export type CollabAgentTool =
  | "spawnAgent"
  | "sendInput"
  | "resumeAgent"
  | "wait"
  | "closeAgent";

export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed";

/** `CollabAgentStatus` — last known liveness of a target agent. */
export type CollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

/** `CollabAgentState`: a status plus, for completed/errored, its message. */
export interface CollabAgentState {
  status: CollabAgentStatus;
  message?: string | null;
}

export interface CollabAgentToolCallItem extends BaseItem {
  type: "collabAgentToolCall";
  tool: CollabAgentTool;
  status: CollabAgentToolCallStatus;
  senderThreadId: string;
  /** For a spawn, the newly spawned agent; otherwise the targets. */
  receiverThreadIds: string[];
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  /** Keyed by thread id. Populated for `wait` and `resumeAgent` outcomes. */
  agentsStates: Record<string, CollabAgentState>;
  [key: string]: unknown;
}

export type SubAgentActivityKind = "started" | "interacted" | "interrupted";

export interface SubAgentActivityItem extends BaseItem {
  type: "subAgentActivity";
  agentThreadId: string;
  kind: SubAgentActivityKind;
  /** The agent definition's path, which is what the TUI names in its summary. */
  agentPath: string;
  [key: string]: unknown;
}

// Skip tier (ADR-0013) — still typed so the item store can hold them, but no
// dedicated component renders them.
export interface SkippedItem extends BaseItem {
  type:
    | "dynamicToolCall"
    | "sleep"
    | "imageView"
    | "contextCompaction"
    | "hookPrompt"
    | "plan";
  [key: string]: unknown;
}

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | GenericToolItem
  | CollabAgentToolCallItem
  | SubAgentActivityItem
  | SkippedItem;

// -- Turn -------------------------------------------------------------------

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

/**
 * A turn as returned inside `thread/resume`'s `thread.turns` (only populated
 * on resume/rollback/fork/read responses — empty everywhere else).
 */
export interface Turn {
  id: string;
  items: ThreadItem[];
  status: TurnStatus;
  itemsView?: "notLoaded" | "summary" | "full";
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

/**
 * The persisted history contract chosen when a thread was created
 * (`Thread.historyMode`, experimental — this client sets `experimental_api`).
 * `thread/revert` is rejected outright for anything but `paginated`, so the
 * UI needs this to tell "you can't revert this thread" apart from a failure.
 */
export type ThreadHistoryMode = "legacy" | "paginated";

export interface ThreadResumeResponse {
  thread: { id: string; turns?: Turn[]; historyMode?: ThreadHistoryMode };
}

// -- Thread list / search ---------------------------------------------------

/**
 * The subset of `v2::Thread` the sidebar reads. `thread/list` and
 * `thread/search` both return full `Thread` objects; everything not named
 * here is ignored rather than guessed at.
 */
export interface ThreadSummary {
  id: string;
  /**
   * User-assigned title (`thread/name/set`). Null until someone names it,
   * which is why `preview` is the fallback.
   */
  name?: string | null;
  /** Usually the thread's first user message. */
  preview?: string;
  cwd?: string;
  updatedAt?: number;
  recencyAt?: number | null;
}

export interface ThreadListResponse {
  data: ThreadSummary[];
  nextCursor?: string | null;
}

/** `thread/search` returns each hit wrapped with the matching excerpt. */
export interface ThreadSearchResult {
  thread: ThreadSummary;
  snippet: string;
}

export interface ThreadSearchResponse {
  data: ThreadSearchResult[];
  nextCursor?: string | null;
}

/**
 * What the sidebar shows for a thread: an explicit name wins, then the
 * first-message preview, then a placeholder. Kept here so the list, the
 * search results and the rename dialog can't disagree about it.
 */
export function threadTitle(thread: ThreadSummary): string {
  return thread.name?.trim() || thread.preview?.trim() || "(未命名)";
}

// -- Account (read-only; no billing/upgrade surface anywhere) ----------------
// `v2::Account` is `#[serde(tag = "type")]` over three auth kinds.

export type PlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "pro_lite"
  | "team"
  | "business"
  | "enterprise"
  | string;

export type Account =
  | { type: "apiKey" }
  | { type: "chatgpt"; email?: string | null; planType: PlanType }
  | { type: "amazonBedrock"; usesCodexManagedCredentials?: boolean };

export interface GetAccountResponse {
  account?: Account | null;
  requiresOpenaiAuth: boolean;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  /** Unix **seconds** (`resets_at` on the Rust side), not milliseconds. */
  resetsAt?: number | null;
}

export interface CreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string | null;
}

/**
 * Why the backend says usage is blocked. Reported by the server — this app
 * never derives exhaustion from a percentage threshold of its own.
 */
export type RateLimitReachedType =
  | "rateLimitReached"
  | "workspaceOwnerCreditsDepleted"
  | "workspaceMemberCreditsDepleted"
  | "workspaceOwnerUsageLimitReached"
  | "workspaceMemberUsageLimitReached";

export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: CreditsSnapshot | null;
  /** `null` means "unavailable", not "false" — see the Rust doc comment. */
  spendControlReached?: boolean | null;
  planType?: PlanType | null;
  rateLimitReachedType?: RateLimitReachedType | null;
}

export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
}

// -- Model picker (same two-layer pattern as the approval selector) ----------
// `Model` / `ReasoningEffortOption` (v2/model.rs). `ReasoningEffort` is a
// plain string on the wire (its Rust enum has hand-written Serialize/Deserialize
// impls and `#[ts(type = "string")]`), including the `Custom(String)` escape
// hatch — so `string` here is the honest type, not a widening.
export type ReasoningEffort = string;

export interface ReasoningEffortOption {
  reasoningEffort: ReasoningEffort;
  description: string;
}

export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: ReasoningEffortOption[];
  defaultReasoningEffort: ReasoningEffort;
  modelSpecialty?: string | null;
  /**
   * Whether this model honours a personality. The TUI refuses to open its
   * personality picker when false, since the setting would be inert.
   */
  supportsPersonality?: boolean;
}

/**
 * Communication style (`/personality`). Lowercase on the wire —
 * `Personality` is `rename_all = "lowercase"` while its camelCase siblings
 * are not, so the values are spelled out rather than derived.
 */
export type Personality = "none" | "friendly" | "pragmatic";

/**
 * One feature flag from `experimentalFeature/list`. The engine returns the
 * whole feature table, not just experimental entries, which is what makes it
 * usable for gating a stable flag like `personality`.
 */
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  defaultEnabled: boolean;
  stage: "beta" | "underDevelopment" | "stable" | "deprecated" | "removed";
  /**
   * Non-null only for beta-stage features — the engine's own signal for
   * "this belongs in a user-facing experimental-features list".
   */
  displayName?: string | null;
  description?: string | null;
}

/**
 * Result of `/diff`. `isGitRepo: false` is distinct from an empty diff: one
 * means "not a repository", the other "no changes".
 */
export interface GitDiffResult {
  isGitRepo: boolean;
  diff: string;
}

/**
 * Lines added and removed on this branch since it left the default branch —
 * committed work only, so it does not overlap with the working-tree diff.
 */
export interface BranchChangeStats {
  additions: number;
  deletions: number;
}

/**
 * The TUI status line's `git-branch` and `branch-changes` items. Every field
 * is optional because every probe is best-effort: a detached HEAD has no
 * branch, a repository with no default branch has no comparison.
 */
export interface BranchStatus {
  isGitRepo: boolean;
  branch?: string | null;
  defaultBranch?: string | null;
  changes?: BranchChangeStats | null;
}

/**
 * Why a remote comparison is unavailable. Both are ordinary states, not
 * faults — a repository with no remote is not an error to report.
 */
export type RemoteDiffUnavailable = "notAGitRepo" | "noRemote";

/**
 * Result of `gitDiffToRemote` — work not yet on a remote, including commits
 * made locally but never pushed. `unavailable` being null is the only case
 * where `sha`/`diff` mean anything; an empty `diff` then means "everything
 * local is already pushed".
 */
export interface RemoteDiffResult {
  unavailable?: RemoteDiffUnavailable | null;
  sha: string;
  diff: string;
}

/**
 * One candidate in the review commit picker. `timestampSeconds` is named for
 * its unit on purpose — the Rust side re-shapes `CommitLogEntry`'s bare
 * `timestamp` so the seconds-vs-milliseconds mistake cannot be made here.
 */
export interface GitCommitOption {
  sha: string;
  timestampSeconds: number;
  subject: string;
}

/**
 * Candidates for `review/start`'s target picker. As with `GitDiffResult`,
 * `isGitRepo: false` means "not a repository" — the branch and commit targets
 * are hidden entirely rather than offered empty.
 */
/** Which system's review targets the picker should offer. */
export type PickerVcs = "git" | "subversion" | "none";

export interface GitRefs {
  vcs: PickerVcs;
  isGitRepo: boolean;
  branches: string[];
  currentBranch?: string | null;
  commits: GitCommitOption[];
}

export interface ModelListResponse {
  data: Model[];
  nextCursor?: string | null;
}

/**
 * What the composer's picker has selected. `null` model means "server
 * default" — we never invent a model id the catalog didn't give us.
 */
export interface ModelSelection {
  model: string | null;
  effort: ReasoningEffort | null;
}

// -- config.toml settings (ADR-0020) ----------------------------------------
// `config/read` returns the *effective* config plus which layer each key came
// from. Only the keys the settings screens actually edit are named here.
//
// Serde subtlety, worth knowing before adding fields: `v2::Config` is
// `rename_all = "camelCase"` for its named fields, but anything not named on
// that struct falls into a `#[serde(flatten)]` map whose keys pass through
// verbatim. So `approvalPolicy` is camelCase while `default_permissions` —
// which the struct doesn't name — stays snake_case in the same object.

export type AskForApproval = "untrusted" | "on-request" | "never" | Record<string, unknown>;
export type ApprovalsReviewer = "user" | "auto_review";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type WebSearchMode = "disabled" | "cached" | "indexed" | "live";
export type Verbosity = "low" | "medium" | "high";
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

export interface CodexConfig {
  model?: string | null;
  modelProvider?: string | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxMode?: SandboxMode | null;
  webSearch?: WebSearchMode | null;
  modelReasoningEffort?: ReasoningEffort | null;
  modelReasoningSummary?: ReasoningSummary | null;
  modelVerbosity?: Verbosity | null;
  /**
   * Not a named field on `v2::Config` — arrives through the flattened extras,
   * hence snake_case (see the note above).
   */
  default_permissions?: string | null;
  [key: string]: unknown;
}

/**
 * Which config layer a key's effective value came from. Used to tell the user
 * a setting is pinned by their organization rather than editable here.
 *
 * `name` is NOT a string: `ConfigLayerSource` is an internally-tagged enum
 * (`#[serde(tag = "type")]`), so it arrives as e.g.
 * `{type: "user", file: "…", profile: null}` or `{type: "system", file: "…"}`.
 * Typing it as a string is what made `OriginNote` render a raw object and
 * crash the whole tree ("Objects are not valid as a React child").
 */
export type ConfigLayerSource =
  | { type: "packagedDefaults"; file: string }
  | { type: "mdm"; domain: string; key: string }
  | { type: "system"; file: string }
  | { type: "enterpriseManaged"; id: string; name: string }
  | { type: "user"; file: string; profile?: string | null }
  | { type: "project"; dotCodexFolder: string }
  | { type: "sessionFlags" }
  | { type: "legacyManagedConfigTomlFromFile"; file: string }
  | { type: "legacyManagedConfigTomlFromMdm" }
  // Forward compatibility: an unrecognized variant must degrade, not crash.
  | { type: string; [key: string]: unknown };

export interface ConfigLayerMetadata {
  name: ConfigLayerSource;
  version: string;
}

/**
 * Human label for a config layer, or `null` for the layers that aren't worth
 * annotating (the user's own file and the packaged defaults — those are the
 * normal, editable cases).
 */
export function configLayerLabel(source: ConfigLayerSource): string | null {
  switch (source.type) {
    case "user":
    case "packagedDefaults":
      return null;
    case "system":
      return "系统";
    case "mdm":
    case "legacyManagedConfigTomlFromMdm":
      return "设备管理 (MDM)";
    case "enterpriseManaged":
      return typeof source.name === "string" ? `企业配置 “${source.name}”` : "企业配置";
    case "project":
      return "项目 .codex";
    case "sessionFlags":
      return "本次启动参数";
    case "legacyManagedConfigTomlFromFile":
      return "托管配置文件";
    default:
      return source.type;
  }
}

export interface ConfigReadResponse {
  config: CodexConfig;
  origins: Record<string, ConfigLayerMetadata>;
}

/**
 * Deployment-imposed limits (`requirements.toml` / MDM). `requirements` is
 * null when nothing is configured, which is the usual case.
 */
export interface ConfigRequirements {
  allowedApprovalPolicies?: AskForApproval[] | null;
  allowedApprovalsReviewers?: ApprovalsReviewer[] | null;
  allowedSandboxModes?: SandboxMode[] | null;
  allowedWebSearchModes?: WebSearchMode[] | null;
  allowedPermissionProfiles?: Record<string, boolean> | null;
  defaultPermissions?: string | null;
  [key: string]: unknown;
}

export interface ConfigRequirementsReadResponse {
  requirements?: ConfigRequirements | null;
}

/**
 * One `config.toml` edit. `keyPath` is a dotted **snake_case TOML** path
 * (`model_reasoning_effort`), not the camelCase JSON field name.
 */
export interface SettingEdit {
  keyPath: string;
  value: unknown;
}

// -- Approval-mode selector (ADR-0016 layer 1) -------------------------------
// Serialized form of the Rust `ApprovalMode` enum (`src/approval_mode.rs`),
// which owns the mapping onto built-in approval presets + permission profile
// ids. Keep these three literals in sync with that enum's camelCase variants.
export type ApprovalMode = "requestApproval" | "helpMeApprove" | "fullAccess";

// -- Pending approval requests (ADR-0016 layer 2) ----------------------------

export type RequestId = { type: "integer"; value: number } | number | string;

export interface PendingApprovalBase {
  requestId: unknown; // echoed back verbatim to resolve/reject commands
  threadId: string;
  turnId: string;
  itemId: string;
}

// `ExecPolicyAmendment` / `NetworkPolicyAmendment` (v2/permissions.rs) — both
// small enough to render honestly rather than as an opaque blob.
export interface ExecPolicyAmendment {
  command: string[];
}

export interface NetworkPolicyAmendment {
  host: string;
  action: "allow" | "deny";
}

export interface PendingCommandExecutionApproval extends PendingApprovalBase {
  kind: "commandExecution";
  command?: string;
  cwd?: string;
  reason?: string | null;
  /**
   * Echoed back verbatim on `acceptWithExecpolicyAmendment` — never
   * synthesized client-side.
   */
  proposedExecpolicyAmendment?: ExecPolicyAmendment | null;
  proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[] | null;
  /**
   * When present, the server is telling us exactly which decisions to offer;
   * absent means "no constraint stated" and we fall back to the full set.
   */
  availableDecisions?: Array<{ type: string }> | null;
}

export interface PendingFileChangeApproval extends PendingApprovalBase {
  kind: "fileChange";
  reason?: string | null;
  /**
   * UNSTABLE per the protocol: "allow writes under this root for the
   * remainder of the session."
   */
  grantRoot?: string | null;
}

// `RequestPermissionProfile` / `GrantedPermissionProfile` share one shape
// (v2/permissions.rs): both are `{ network?, fileSystem? }`.
export interface AdditionalNetworkPermissions {
  enabled?: boolean | null;
}

export type FileSystemPath =
  | { kind: "path"; path: string }
  | { kind: "glob_pattern"; pattern: string }
  | { kind: "special"; value: unknown };

export interface FileSystemSandboxEntry {
  path: FileSystemPath;
  access: "read" | "write" | "deny";
}

export interface AdditionalFileSystemPermissions {
  read?: string[] | null;
  write?: string[] | null;
  entries?: FileSystemSandboxEntry[] | null;
  globScanMaxDepth?: number | null;
}

export interface PermissionProfile {
  network?: AdditionalNetworkPermissions | null;
  fileSystem?: AdditionalFileSystemPermissions | null;
}

export interface PendingPermissionsApproval extends PendingApprovalBase {
  kind: "permissions";
  reason?: string | null;
  cwd?: string;
  /**
   * What the agent is asking for. Granting echoes this back (possibly
   * scoped) — the card must show it so the decision is informed.
   */
  permissions?: PermissionProfile;
}

/** `ToolRequestUserInputOption` (v2/item.rs). */
export interface UserInputOption {
  label: string;
  description: string;
}

/**
 * `ToolRequestUserInputQuestion` (v2/item.rs). A question is free text when
 * `options` is absent or empty; `isOther` adds a free-text answer *alongside*
 * options rather than replacing them.
 */
export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  /** Answer should be masked in the UI. */
  isSecret?: boolean;
  options?: UserInputOption[] | null;
}

/**
 * `item/tool/requestUserInput` — a tool asking the user a question.
 *
 * It rides in the same list as the approvals because it is the same class of
 * thing: a server request that blocks the turn until this client answers.
 * That also means it inherits the composer's pending-decision affordance,
 * which ADR-0016 called for.
 */
export interface PendingUserInputRequest extends PendingApprovalBase {
  kind: "userInput";
  questions: UserInputQuestion[];
  /** False for advisory requests the turn does not wait on. */
  isBlocking: boolean;
}

/**
 * One question's answer as collected in the UI. Rust encodes this into the
 * protocol's `{answers: {[id]: {answers: string[]}}}` shape, including the
 * `user_note:` prefix convention — see `src/user_input.rs`.
 */
export interface UserInputAnswerDraft {
  questionId: string;
  selectedLabel?: string | null;
  note?: string | null;
}

/**
 * A server-pushed notice the user should see.
 *
 * Covers `warning`, `error`, `guardianWarning`, `configWarning`,
 * `deprecationNotice` and `model/rerouted` — all notifications that were
 * previously dropped on the floor, so a malformed config or a silently
 * substituted model left no trace in the UI at all.
 */
export interface Notice {
  /** Client-side id, for dismissal. The protocol carries no notice id. */
  id: string;
  severity: "info" | "warning" | "error";
  /** Which notification produced it, so the source stays identifiable. */
  source: string;
  message: string;
  details?: string | null;
  threadId?: string | null;
}

/**
 * One control in an elicitation form, already flattened by Rust.
 *
 * The wire schema is four `#[serde(untagged)]` layers deep with renamed
 * fields throughout; `src/elicitation.rs` collapses it so nothing here has to
 * know that shape. These values round-trip back unchanged when answering, so
 * Rust can type each answer from its declared control.
 */
export type ElicitationControl =
  | {
      kind: "text";
      default?: string | null;
      format?: string | null;
      minLength?: number | null;
      maxLength?: number | null;
    }
  | {
      kind: "number";
      integer: boolean;
      default?: number | null;
      minimum?: number | null;
      maximum?: number | null;
    }
  | { kind: "boolean"; default?: boolean | null }
  | { kind: "select"; options: ElicitationOption[]; default?: string | null }
  | {
      kind: "multiSelect";
      options: ElicitationOption[];
      default: string[];
      minItems?: number | null;
      maxItems?: number | null;
    };

export interface ElicitationOption {
  value: string;
  label: string;
}

export interface ElicitationField {
  key: string;
  label: string;
  description?: string | null;
  required: boolean;
  control: ElicitationControl;
}

export interface ElicitationView {
  message: string;
  mode: string;
  url?: string | null;
  fields: ElicitationField[];
  /**
   * Set when the form cannot be rendered by this build. The card explains it
   * and offers only decline/cancel rather than pretending to collect input.
   */
  unrenderableReason?: string | null;
}

/**
 * One answer as the UI collects it. Rust types it against the field's
 * declared control before sending — a number field must answer `3`, not
 * `"3"`, or a server validating its own schema rejects the response.
 */
export interface ElicitationAnswer {
  key: string;
  value?: string | null;
  checked?: boolean | null;
  values?: string[] | null;
}

/**
 * `mcpServer/elicitation/request` — an MCP server asking the user for input.
 *
 * Same class as the tool user-input request: a server request that blocks
 * until this client answers, so it shares the pending list and therefore the
 * composer's pending-decision affordance (ADR-0016).
 */
export interface PendingElicitationRequest extends PendingApprovalBase {
  kind: "elicitation";
  serverName: string;
  /** Raw params, handed back to `elicitation_view` for flattening. */
  params: Record<string, unknown>;
}

export type PendingApproval =
  | PendingCommandExecutionApproval
  | PendingFileChangeApproval
  | PendingPermissionsApproval
  | PendingUserInputRequest
  | PendingElicitationRequest;

/**
 * What `submit_turn` did with a message. Steering is not a separate user
 * intent in the engine's model — the client picks steer/start/queue from live
 * state and the server's answer — so the UI reports the outcome instead of
 * asking the user to choose up front.
 */
export type TurnSubmission =
  | { outcome: "steered"; turnId: string }
  | { outcome: "started" }
  | { outcome: "queued" };

// -- Raw app-server event envelope (see bridge.rs's `emit_event`) ----------

export interface AppServerEventEnvelope {
  kind: "notification" | "request" | "lagged" | "disconnected";
  notification?: { method: string; params: unknown };
  requestId?: unknown;
  request?: { method: string; id: unknown; params: unknown };
  skipped?: number;
  message?: string;
}

// -- MCP servers (连接) ------------------------------------------------------

/**
 * `mcpServerStatus/list` reports auth state but *not* startup state — that
 * arrives only via `mcpServer/startupStatus/updated`, so a server that failed
 * to start before this window opened looks healthy until it is retried.
 */
export type McpAuthStatus = "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oauth";

export type McpServerStartupState = "starting" | "ready" | "failed" | "cancelled";

export interface McpServerStatus {
  name: string;
  pluginId?: string | null;
  serverInfo?: { name?: string; version?: string; title?: string | null } | null;
  /** Tool name -> tool descriptor. Only the count and names are rendered. */
  tools: Record<string, unknown>;
  resources: unknown[];
  resourceTemplates: unknown[];
  authStatus: McpAuthStatus;
}

export interface ListMcpServerStatusResponse {
  data: McpServerStatus[];
  nextCursor?: string | null;
}

/** Live startup state, accumulated from notifications rather than fetched. */
export interface McpServerRuntimeState {
  status: McpServerStartupState;
  error?: string | null;
  failureReason?: string | null;
}

export interface McpServerOauthLoginResponse {
  authorizationUrl: string;
}

// -- Hooks (钩子) ------------------------------------------------------------

export type HookTrustStatus = "managed" | "untrusted" | "trusted" | "modified";

export interface HookMetadata {
  key: string;
  eventName: string;
  handlerType: string;
  executionMode: string;
  matcher?: string | null;
  command?: string | null;
  timeoutSec: number;
  statusMessage?: string | null;
  sourcePath: string;
  source: string;
  pluginId?: string | null;
  displayOrder: number;
  enabled: boolean;
  isManaged: boolean;
  trustStatus: HookTrustStatus;
}

export interface HooksListEntry {
  cwd: string;
  hooks: HookMetadata[];
  warnings: string[];
  errors: { path: string; message: string }[];
}

export interface HooksListResponse {
  data: HooksListEntry[];
}

// -- Plugins (插件) ----------------------------------------------------------

export type PluginAvailability = string;
export type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";

export interface PluginSummary {
  id: string;
  name: string;
  remotePluginId?: string | null;
  version?: string | null;
  localVersion?: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: PluginInstallPolicy;
  availability?: PluginAvailability;
  /**
   * Present when plugin-service says the plugin can't be used. Surfaced as
   * plain text — this app has no upgrade or purchase path to offer.
   */
  disabledReason?: string | null;
  interface?: { displayName?: string | null; description?: string | null } | null;
  keywords?: string[];
}

export interface PluginMarketplaceEntry {
  name: string;
  path?: string | null;
  interface?: { displayName?: string | null } | null;
  plugins: PluginSummary[];
}

export interface PluginListResponse {
  marketplaces: PluginMarketplaceEntry[];
  marketplaceLoadErrors?: { marketplacePath: string; message: string }[];
  featuredPluginIds?: string[];
}

export interface MarketplaceUpgradeResponse {
  selectedMarketplaces: string[];
  upgradedRoots: string[];
  errors: { marketplaceName: string; message: string }[];
}

// -- Account (账户) ----------------------------------------------------------

export interface AccountTokenUsageSummary {
  lifetimeTokens?: number | null;
  peakDailyTokens?: number | null;
  longestRunningTurnSec?: number | null;
  currentStreakDays?: number | null;
  longestStreakDays?: number | null;
}

export interface GetAccountTokenUsageResponse {
  summary: AccountTokenUsageSummary;
  dailyUsageBuckets?: { startDate: string; tokens: number }[] | null;
}

/**
 * `account/login/start` is a tagged union; only the `chatgpt` arm is used
 * here. Both URL-bearing arms are kept so a device-code response can't be
 * silently mistaken for a failure.
 */
export type LoginAccountResponse =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { type: "apiKey" }
  | { type: "chatgptAuthTokens" }
  | { type: "amazonBedrock" };

export interface PendingLogin {
  loginId: string;
  authUrl: string;
  error?: string | null;
}

// -- Composer input (item 1 & 2) --------------------------------------------
// The wire shapes for `UserInput` are built in Rust (`src/composer.rs`), not
// here: it is a `#[serde(tag = "type")]` union whose variants carry
// differently-named fields, and hand-writing that in TS is the bug class that
// blanked the window once already. These types are this app's *own* IPC
// payloads, which Rust maps onto the protocol.

export type ComposerAttachment =
  | { kind: "localImage"; path: string }
  | { kind: "remoteImage"; url: string };

/**
 * A skill referenced as `$name`. Both halves are required by
 * `UserInput::Skill { name, path }`.
 */
export interface ComposerSkill {
  name: string;
  path: string;
}

/**
 * A file or folder added via the `@` menu's 文件和文件夹 entry, shown as a
 * chip. Presentation only: Rust folds `path` into the message text, since a
 * file reference has no structured `UserInput` variant.
 */
export interface ComposerFileRef {
  path: string;
}

/**
 * An app or plugin referenced from the `@` menu's 插件 section.
 *
 * Unlike a file, these *are* structured mentions. The `app://` / `plugin://`
 * URI the engine matches on is built in Rust (`src/composer.rs`), not here —
 * a wrong prefix does not error, it silently fails to resolve.
 */
export type ComposerMention =
  | { kind: "app"; id: string; name: string }
  | { kind: "plugin"; id: string; name: string };

// -- Apps (`app/list`) -------------------------------------------------------

/**
 * `v2::AppInfo`, narrowed to what the `@` menu renders.
 *
 * `isAccessible`/`isEnabled` are the engine's own mentionability gate
 * (`tui/src/chatwidget/skills.rs::is_app_mentionable`), not a display
 * preference.
 */
export interface AppInfo {
  id: string;
  name: string;
  description?: string | null;
  isAccessible: boolean;
  isEnabled: boolean;
}

export interface AppsListResponse {
  data: AppInfo[];
  nextCursor?: string | null;
}

// -- External agent import (`externalAgentConfig/*`) -------------------------
// Flattened by `detect_external_agent_config` in `src/integrations.rs`, which
// keeps each item's original server object in `raw` for echo-back:
// `ExternalAgentConfigMigrationItemType` is SCREAMING_CASE among camelCase
// siblings, so the frontend never constructs it.

export interface DetectedMigrationItem {
  itemType: string;
  description: string;
  /** Null/empty means home-scoped; non-empty means repo-scoped. */
  cwd?: string | null;
  raw: unknown;
}

export interface DetectedMigrationSource {
  /** Passed back to import unchanged, as the protocol requires. */
  source: string;
  label: string;
  items: DetectedMigrationItem[];
  error?: string | null;
}

// -- Collaboration modes (`collaborationMode/list`) --------------------------
// Flattened by `list_collaboration_modes` in `src/composer.rs`. The wire type
// `v2::CollaborationModeMask` carries `#[serde(rename = "reasoning_effort")]`
// — snake_case among camelCase siblings — so it is normalized in Rust rather
// than mirrored here.

export interface CollaborationModePreset {
  name: string;
  /** `"plan"` / `"default"`, or absent when the preset leaves the mode alone. */
  mode?: string | null;
  model?: string | null;
  /**
   * Mirrors the engine's `TUI_VISIBLE_COLLABORATION_MODES`, so this client
   * offers the same set the TUI does.
   */
  visible: boolean;
}

// -- File search (`fuzzyFileSearch`) -----------------------------------------

/**
 * One `@` completion candidate, already flattened by `search_files` in
 * `src/composer.rs`. Deliberately not a mirror of `FuzzyFileSearchResult`:
 * that type is the one nearby with no `rename_all`, so it is snake_case on
 * the wire while its neighbours are camelCase. Rust normalizes it.
 */
export interface FileSearchHit {
  /** Relative to `root`; this is the text inserted into the message. */
  path: string;
  fileName: string;
  root: string;
  isDirectory: boolean;
}

// -- Skills (`skills/list`) --------------------------------------------------
// `SkillMetadata` / `SkillsListEntry` (v2/plugin.rs), `rename_all = "camelCase"`.

export interface SkillInterface {
  displayName?: string;
  shortDescription?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: SkillInterface;
  path: string;
  scope: string;
  enabled: boolean;
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillMetadata[];
  errors: unknown[];
}

export interface SkillsListResponse {
  data: SkillsListEntry[];
}

/**
 * The one-line label for a skill in the typeahead: the SKILL.json interface
 * wins, then the legacy short description, then the full description.
 */
export function skillSummary(skill: SkillMetadata): string {
  return (
    skill.interface?.shortDescription?.trim() ||
    skill.shortDescription?.trim() ||
    skill.description?.trim() ||
    ""
  );
}

// -- Token usage (`thread/tokenUsage/updated`) -------------------------------
// `ThreadTokenUsage` / `TokenUsageBreakdown` (v2/thread.rs). Note
// `modelContextWindow` is `Option<i64>` — genuinely absent for some models,
// which is why the indicator has a no-percentage fallback.

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

/**
 * Computed in Rust by the engine's own formula — never derived here, since it
 * depends on an engine-owned baseline constant (ADR-0021).
 */
export interface ContextUsage {
  percentRemaining: number | null;
  usedTokens: number;
}

// -- Review (`review/start`) -------------------------------------------------
// Flattened for IPC; `src/composer.rs` rebuilds the tagged `ReviewTarget`.

/**
 * Where the review runs. The Official App's Git settings call this
 * "代码审查发送方式" (在此聊天中进行 / 独立).
 */
export type ReviewDelivery = "inline" | "detached";

export type ReviewTargetInput =
  | { kind: "uncommittedChanges" }
  | { kind: "baseBranch"; branch: string }
  | { kind: "commit"; sha: string; title?: string | null }
  /** Subversion's counterpart to `commit` — a revision number, not a hash. */
  | { kind: "revision"; revision: string; title?: string | null }
  | { kind: "custom"; instructions: string };

// -- Queue (`thread/queue/*`) ------------------------------------------------
// Flattened by `src/thread_ops.rs`: a queued submission carries the same
// `Vec<UserInput>` a turn does, and that union is not hand-written here.

export interface QueuedSubmissionView {
  id: string;
  text: string;
  attachmentCount: number;
  skillNames: string[];
}

// -- Background terminals (`thread/backgroundTerminals/*`) -------------------

export interface BackgroundTerminalView {
  processId: string;
  itemId: string;
  command: string;
  cwd: string;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: number | null;
}

// -- Thread goal (`thread/goal/*`) -------------------------------------------

/**
 * The engine's own lifecycle for a goal — `usageLimited`/`budgetLimited` are
 * set by the engine when a goal exhausts its allowance, not chosen by a user.
 */
export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalGetResponse {
  goal: ThreadGoal | null;
}

export interface ThreadGoalSetResponse {
  goal: ThreadGoal;
}

/**
 * `ThreadGoalSetParams::token_budget` is an `Option<Option<i64>>`: absent
 * means "leave alone" and an explicit null means "clear". JSON `null` alone
 * cannot express both, so the intent is named instead and `src/thread_ops.rs`
 * maps it back onto the double option.
 */
export type TokenBudgetEdit =
  | { kind: "unchanged" }
  | { kind: "clear" }
  | { kind: "set"; tokens: number };

// -- Memories (`config.toml` + `thread/memoryMode/set` + `memory/reset`) ------
// The two settings the TUI exposes, out of the many `MemoriesToml` carries —
// only these two have a user-facing control anywhere in this repo
// (`tui/src/bottom_pane/memories_settings_view.rs`). Read and written in Rust
// (`src/memories.rs`): `memories` is not a named field on `v2::Config`, so it
// arrives in the flattened map with snake_case children among camelCase
// siblings.

export interface MemorySettings {
  /**
   * Read path. The TUI's own wording is "Applied at next thread" — it does
   * not change the running one.
   */
  useMemories: boolean;
  /**
   * Write path. Applies to the current thread too, which is exactly why
   * `thread/memoryMode/set` exists.
   */
  generateMemories: boolean;
}

/**
 * Composer indicators derived from a `thread/settings/updated` payload.
 *
 * Mapped in Rust (`commands.rs::thread_settings_indicators`): `AskForApproval`
 * has a `Granular { … }` variant, and the approval-mode inverse belongs beside
 * its forward direction in `approval_mode.rs`. `approvalMode` is null when the
 * thread's settings aren't one of the three presets.
 */
export interface ThreadSettingsIndicators {
  approvalMode: ApprovalMode | null;
  model: string;
  effort: ReasoningEffort | null;
}

/**
 * Per-item outcome of an external-agent config import
 * (`externalAgentConfig/import/progress` and `/completed`).
 *
 * The import request returns only an `importId`; these results arrive later,
 * so without them the screen can only ever say "started".
 */
export interface ImportTypeResult {
  itemType: string;
  successes: unknown[];
  failures: { itemType: string; errorType?: string | null }[];
}

export interface ImportProgress {
  results: ImportTypeResult[];
  done: boolean;
}

// -- Self-update (ADR-0007) --------------------------------------------------

/**
 * Result of `check_for_update`. A tagged union rather than a nullable update,
 * because "we could not check" and "there is nothing to install" must not
 * collapse into the same rendering — shipping unconfigured and reporting
 * "up to date" would be the dishonest degradation ADR-0007 warns against.
 * Built in Rust (`src/updater.rs`); these literals mirror its serde tags.
 */
export type UpdateStatus =
  | { status: "notConfigured"; reason: string }
  | { status: "upToDate"; currentVersion: string }
  | { status: "available"; currentVersion: string; version: string; notes?: string | null };
