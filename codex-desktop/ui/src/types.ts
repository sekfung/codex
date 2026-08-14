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

/// `FileUpdateChange` (v2/item.rs): `{ path, kind, diff }`.
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
export interface CollabAgentToolCallItem extends BaseItem {
  type: "collabAgentToolCall";
  senderThreadId: string;
  receiverThreadIds: string[];
  status: string;
  [key: string]: unknown;
}

export interface SubAgentActivityItem extends BaseItem {
  type: "subAgentActivity";
  agentThreadId: string;
  kind: string;
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

/// A turn as returned inside `thread/resume`'s `thread.turns` (only populated
/// on resume/rollback/fork/read responses — empty everywhere else).
export interface Turn {
  id: string;
  items: ThreadItem[];
  status: TurnStatus;
  itemsView?: "notLoaded" | "summary" | "full";
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export interface ThreadResumeResponse {
  thread: { id: string; turns?: Turn[] };
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
}

export interface ModelListResponse {
  data: Model[];
  nextCursor?: string | null;
}

/// What the composer's picker has selected. `null` model means "server
/// default" — we never invent a model id the catalog didn't give us.
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
  /// Not a named field on `v2::Config` — arrives through the flattened extras,
  /// hence snake_case (see the note above).
  default_permissions?: string | null;
  [key: string]: unknown;
}

/// Which config layer a key's effective value came from. Used to tell the user
/// a setting is pinned by their organization rather than editable here.
export interface ConfigLayerMetadata {
  name: string;
  version: string;
}

export interface ConfigReadResponse {
  config: CodexConfig;
  origins: Record<string, ConfigLayerMetadata>;
}

/// Deployment-imposed limits (`requirements.toml` / MDM). `requirements` is
/// null when nothing is configured, which is the usual case.
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

/// One `config.toml` edit. `keyPath` is a dotted **snake_case TOML** path
/// (`model_reasoning_effort`), not the camelCase JSON field name.
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
  /// Echoed back verbatim on `acceptWithExecpolicyAmendment` — never
  /// synthesized client-side.
  proposedExecpolicyAmendment?: ExecPolicyAmendment | null;
  proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[] | null;
  /// When present, the server is telling us exactly which decisions to offer;
  /// absent means "no constraint stated" and we fall back to the full set.
  availableDecisions?: Array<{ type: string }> | null;
}

export interface PendingFileChangeApproval extends PendingApprovalBase {
  kind: "fileChange";
  reason?: string | null;
  /// UNSTABLE per the protocol: "allow writes under this root for the
  /// remainder of the session."
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
  /// What the agent is asking for. Granting echoes this back (possibly
  /// scoped) — the card must show it so the decision is informed.
  permissions?: PermissionProfile;
}

export type PendingApproval =
  | PendingCommandExecutionApproval
  | PendingFileChangeApproval
  | PendingPermissionsApproval;

// -- Raw app-server event envelope (see bridge.rs's `emit_event`) ----------

export interface AppServerEventEnvelope {
  kind: "notification" | "request" | "lagged" | "disconnected";
  notification?: { method: string; params: unknown };
  requestId?: unknown;
  request?: { method: string; id: unknown; params: unknown };
  skipped?: number;
  message?: string;
}
