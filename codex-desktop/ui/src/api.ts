import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppServerEventEnvelope,
  ApprovalMode,
  BackgroundTerminalView,
  CollaborationModePreset,
  ComposerAttachment,
  ComposerFileRef,
  ComposerMention,
  ComposerSkill,
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  ContextUsage,
  FeatureFlag,
  FileSearchHit,
  GetAccountRateLimitsResponse,
  BranchStatus,
  GitDiffResult,
  GitRefs,
  RemoteDiffResult,
  GetAccountResponse,
  GetAccountTokenUsageResponse,
  HooksListResponse,
  ListMcpServerStatusResponse,
  LoginAccountResponse,
  MarketplaceUpgradeResponse,
  McpServerOauthLoginResponse,
  MemorySettings,
  ModelListResponse,
  Personality,
  PluginListResponse,
  AppsListResponse,
  DetectedMigrationSource,
  Project,
  QueuedSubmissionView,
  ReasoningEffort,
  ReviewDelivery,
  ReviewTargetInput,
  SettingEdit,
  SkillsListResponse,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
  ThreadGoalStatus,
  ThreadHistoryMode,
  ThreadListResponse,
  ThreadResumeResponse,
  ThreadSearchResponse,
  ThreadSettingsIndicators,
  TokenBudgetEdit,
  TurnSubmission,
  ElicitationAnswer,
  ElicitationField,
  ElicitationView,
  UserInputAnswerDraft,
} from "./types";

/**
 * `thread/fork` returns the same envelope shape as resume, plus more fields
 * we don't consume yet — only `thread.id` is needed to switch to the fork.
 */
type ThreadForkResponse = ThreadResumeResponse;

/**
 * What most commands return: the JSON-RPC result forwarded verbatim.
 *
 * `commands.rs` says so in its module doc — "request-shaped commands return
 * the raw JSON-RPC result as-is rather than a hand-mapped TypeScript-friendly
 * shape". So there is no typed contract on the Rust side to mirror here, and
 * inventing an interface for one of these would assert a shape nothing
 * validates — the exact move that put a `#[serde(tag)]` union behind a
 * `string` and blanked the window. `unknown` is the honest type for a value
 * this app is not meant to read; the alias exists so that reads as a decision
 * rather than an omission.
 *
 * The two commands whose results *are* read declare their own narrow shapes
 * below, each checked against the protocol struct it comes from.
 */
type OpaqueResult = unknown;

/**
 * The slice of `ThreadStartResponse` this app reads. `Thread.id` and
 * `Thread.history_mode` (camelCase on the wire) are both non-optional in
 * `v2/thread_data.rs`; they are optional here only because the payload is
 * forwarded untyped and a malformed one should degrade rather than throw.
 */
interface ThreadStartResult {
  thread?: { id?: string; historyMode?: ThreadHistoryMode };
}

/**
 * `ReviewStartResponse.review_thread_id` — for an inline review this is the
 * original thread, for a detached one the new review thread. Non-optional in
 * `v2/review.rs`.
 */
interface ReviewStartResult {
  reviewThreadId?: string;
}

// Mirrors `bridge::APP_SERVER_EVENT` in the Rust backend — keep in sync.
const APP_SERVER_EVENT = "codex-desktop://app-server-event";

export function onAppServerEvent(
  handler: (event: AppServerEventEnvelope) => void,
): Promise<() => void> {
  return listen<AppServerEventEnvelope>(APP_SERVER_EVENT, (event) => handler(event.payload));
}

// -- Startup -----------------------------------------------------------------

/**
 * `null` when the embedded app-server is running, the failure reason
 * otherwise. Managed unconditionally in `main.rs`, so this is answerable even
 * when nothing else is.
 */
export const startupFailure = () => invoke<string | null>("startup_failure");

// -- Projects (ADR-0012) -----------------------------------------------------

export const listProjects = () => invoke<Project[]>("list_projects");
export const addProject = (path: string) => invoke<Project>("add_project", { path });
export const removeProject = (id: string) => invoke<void>("remove_project", { id });
// Uses `@tauri-apps/plugin-dialog` directly (gated by the `dialog:default`
// capability) instead of a custom Rust command — this is the plugin's own
// well-tested IPC path, not a hand-rolled oneshot-channel wrapper around it.
export const pickProjectFolder = () => open({ directory: true, multiple: false });

// -- Threads ------------------------------------------------------------

/**
 * `archived` is the protocol's tri-state: `true` returns *only* archived
 * threads, `false`/`null` only non-archived. There is no "both", so the
 * archived view is a second call rather than a filter over one result.
 */
export const listThreads = (projectPath: string, archived?: boolean) =>
  invoke<ThreadListResponse>("list_threads", { projectPath, archived: archived ?? null });

export const setThreadName = (threadId: string, name: string) =>
  invoke<OpaqueResult>("set_thread_name", { threadId, name });
export const archiveThread = (threadId: string) =>
  invoke<OpaqueResult>("archive_thread", { threadId });
export const unarchiveThread = (threadId: string) =>
  invoke<OpaqueResult>("unarchive_thread", { threadId });
export const deleteThread = (threadId: string) =>
  invoke<OpaqueResult>("delete_thread", { threadId });

/** Searches across every Project — `thread/search` has no cwd filter. */
export const searchThreads = (searchTerm: string, limit?: number) =>
  invoke<ThreadSearchResponse>("search_threads", { searchTerm, limit: limit ?? null });

// -- Account (read-only: no billing, upgrade or top-up path exists) ----------

export const readAccount = () => invoke<GetAccountResponse>("read_account");
export const readAccountRateLimits = () =>
  invoke<GetAccountRateLimitsResponse>("read_account_rate_limits");
export const startThread = (
  cwd: string,
  approvalMode?: ApprovalMode,
  model?: string | null,
  effort?: ReasoningEffort | null,
) =>
  invoke<ThreadStartResult>("start_thread", {
    cwd,
    approvalMode: approvalMode ?? null,
    model: model ?? null,
    effort: effort ?? null,
  });
export const resumeThread = (threadId: string) =>
  invoke<ThreadResumeResponse>("resume_thread", { threadId });
export const forkThread = (threadId: string, lastTurnId?: string | null) =>
  invoke<ThreadForkResponse>("fork_thread", { threadId, lastTurnId: lastTurnId ?? null });

// ADR-0016 layer 1. The mode -> (approval policy, permission profile,
// reviewer) mapping lives in Rust (`src/approval_mode.rs`); the frontend only
// names the mode.
export const setApprovalMode = (threadId: string, approvalMode: ApprovalMode) =>
  invoke<OpaqueResult>("set_approval_mode", { threadId, approvalMode });

/**
 * Maps a `thread/settings/updated` payload onto the composer's indicators.
 * Mapped in Rust for the same reason the forward direction is.
 */
export const threadSettingsIndicators = (settings: unknown) =>
  invoke<ThreadSettingsIndicators>("thread_settings_indicators", { settings });

// Model picker, following the same two-layer shape: applied to the active
// thread here, and carried onto new threads by `startThread`.
export const listModels = () => invoke<ModelListResponse>("list_models");

export const setModel = (
  threadId: string,
  model: string | null,
  effort: ReasoningEffort | null,
) => invoke<OpaqueResult>("set_model", { threadId, model, effort });

/** `/personality` — a per-thread override, like the model above. */
export const setPersonality = (threadId: string, personality: Personality) =>
  invoke<OpaqueResult>("set_personality", { threadId, personality });

/**
 * Feature-flag enablement from `experimentalFeature/list`. Gates controls the
 * deployment may have turned off, rather than assuming they are available.
 */
export const listFeatures = () => invoke<FeatureFlag[]>("list_features");

/**
 * Persists a feature flag to `config.toml` via `config/batchWrite`, the same
 * path the TUI uses. Not `experimentalFeature/enablement/set`, which is
 * runtime-only and whose allowlist excludes every beta-stage flag — see the
 * note on `set_feature_enabled` in `src/features.rs`.
 */
export const setFeatureEnabled = (name: string, enabled: boolean) =>
  invoke<OpaqueResult>("set_feature_enabled", { name, enabled });

/**
 * `/diff` — the working-tree diff, run through `command/exec` so it obeys the
 * session's sandbox policy (never spawned locally; ADR-0021).
 */
export const gitDiff = (cwd: string) => invoke<GitDiffResult>("git_diff", { cwd });

/**
 * Branch and commit candidates for the review picker. Unlike `gitDiff` this
 * reuses `codex_git_utils` directly rather than `command/exec` — no command is
 * constructed here, so there is nothing to route through the sandbox; see the
 * module docs in `src/git_refs.rs`.
 */
export const gitRefs = (cwd: string) => invoke<GitRefs>("git_refs", { cwd });

/**
 * `gitDiffToRemote` — what is not yet on a remote. A plain RPC: the engine
 * walks the branch ancestry itself, so nothing is constructed on this side.
 */
export const gitDiffToRemote = (cwd: string) =>
  invoke<RemoteDiffResult>("git_diff_to_remote", { cwd });

/**
 * Branch name and branch-vs-default line counts, ported from the TUI status
 * line's `git-branch` and `branch-changes` items.
 */
export const branchStatus = (cwd: string) => invoke<BranchStatus>("branch_status", { cwd });

// -- Settings / config.toml (ADR-0020) ---------------------------------------
// Behavior settings live in `config.toml` so the CLI honors them too; desktop
// chrome (Project list, theme mode) stays app-local.

export const readConfig = () => invoke<ConfigReadResponse>("read_config");
export const readConfigRequirements = () =>
  invoke<ConfigRequirementsReadResponse>("read_config_requirements");

export const writeConfigValue = (edit: SettingEdit) =>
  invoke<OpaqueResult>("write_config_value", { edit });
export const writeConfigBatch = (edits: SettingEdit[]) =>
  invoke<OpaqueResult>("write_config_batch", { edits });

/**
 * The persisted *default* approval mode, as opposed to the composer's
 * per-thread override. `null` when `config.toml` holds a combination the
 * 3-preset selector can't express — the mapping lives in Rust
 * (`src/approval_mode.rs`) so the forward and reverse directions can't drift.
 */
export const readDefaultApprovalMode = () =>
  invoke<ApprovalMode | null>("read_default_approval_mode");

/**
 * Writes the default approval mode. One selector value expands to three
 * config keys, written atomically in Rust.
 */
export const setDefaultApprovalMode = (approvalMode: ApprovalMode) =>
  invoke<OpaqueResult>("set_default_approval_mode", { approvalMode });

export const configFilePath = () => invoke<string>("config_file_path");
export const openPathInOs = (path: string) => invoke<void>("open_path_in_os", { path });

// -- Turns --------------------------------------------------------------

/**
 * Attachments, skills and file references are sent as this app's own flat
 * shapes; Rust (`src/composer.rs`) maps them onto `UserInput`, orders them the
 * way the TUI does (images, text, skills), and folds `fileRefs` into the text.
 */
export const sendTurn = (
  threadId: string,
  text: string,
  attachments: ComposerAttachment[] = [],
  skills: ComposerSkill[] = [],
  fileRefs: ComposerFileRef[] = [],
  mentions: ComposerMention[] = [],
) =>
  invoke<OpaqueResult>("send_turn", { threadId, text, attachments, skills, fileRefs, mentions });

/**
 * Submits composer input, letting Rust pick steer / start / queue the way the
 * TUI does (`tui/src/app/thread_routing.rs`). Pass the turn this client
 * believes is running, or `null` if it believes the thread is idle; the
 * engine's answer decides what actually happens, and the returned outcome
 * says which.
 */
export const submitTurn = (
  threadId: string,
  activeTurnId: string | null,
  text: string,
  attachments: ComposerAttachment[] = [],
  skills: ComposerSkill[] = [],
  fileRefs: ComposerFileRef[] = [],
  mentions: ComposerMention[] = [],
) =>
  invoke<TurnSubmission>("submit_turn", {
    threadId,
    activeTurnId,
    text,
    attachments,
    skills,
    fileRefs,
    mentions,
  });

export const interruptTurn = (threadId: string, turnId: string) =>
  invoke<OpaqueResult>("interrupt_turn", { threadId, turnId });

/**
 * `thread/revert` — drops `beforeTurnId` and every later turn from the
 * thread's history. Conversation only: files the agent already wrote are
 * untouched (see `src/thread_ops.rs`).
 */
export const revertThread = (threadId: string, beforeTurnId: string) =>
  invoke<OpaqueResult>("revert_thread", { threadId, beforeTurnId });

// -- Composer capability -----------------------------------------------------

/**
 * Native image picker. Reuses the already-granted `dialog:default`
 * capability, same as the sidebar's folder picker.
 *
 * Images only, deliberately: `UserInput` has no generic file variant
 * (`Text | Image | LocalImage | Audio | LocalAudio | Skill | Mention`), so
 * there is nothing to send a document as. Referencing a non-image file is
 * what `@` mentions are for. The explicit title matters because the image
 * filter makes this dialog look empty inside a source repo — without it,
 * "only folders are selectable" reads as a bug rather than as the filter
 * working.
 */
export const pickImageFiles = () =>
  open({
    title: "选择图片（仅支持图片附件，引用其他文件请在输入框用 @）",
    multiple: true,
    directory: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
  });

/**
 * The `@` menu's 文件和文件夹 entry.
 *
 * Two dialogs, not one: `OpenDialogOptions.directory` is a boolean that
 * switches the dialog between file mode and folder mode, and the plugin
 * exposes no combined mode (nor do the native pickers underneath it on every
 * platform). So the menu offers the two as separate entries rather than
 * pretending one dialog can do both.
 */
export const pickAnyFiles = () =>
  open({ title: "选择文件", multiple: true, directory: false });

export const pickAnyFolders = () =>
  open({ title: "选择文件夹", multiple: true, directory: true });

/** `app/list` — the 插件 section of the `@` menu. */
export const listApps = () => invoke<AppsListResponse>("list_apps");

/**
 * The `@…` token for a chosen app/plugin. Derived in Rust so the slug and
 * title-case rules stay next to the engine helpers they were ported from.
 */
export const mentionToken = (mention: ComposerMention) =>
  invoke<string>("mention_token", { mention });

// -- Feedback (`feedback/upload`) --------------------------------------------

/**
 * `classification` uses the engine's own values (`bad_result`, `good_result`,
 * `bug`, `safety_check`, `other`). `includeLogs` is the consent bit.
 */
export const uploadFeedback = (
  classification: string,
  reason: string | null,
  threadId: string | null,
  includeLogs: boolean,
) => invoke<OpaqueResult>("upload_feedback", { classification, reason, threadId, includeLogs });

// -- External agent import (导入) --------------------------------------------

export const detectExternalAgentConfig = (cwds: string[]) =>
  invoke<DetectedMigrationSource[]>("detect_external_agent_config", { cwds });

/**
 * `migrationItems` must be the server's own detected objects, echoed back
 * unchanged, with the same `migrationSource` detection used.
 * Returns the `importId`. Per-item outcomes arrive separately on
 * `externalAgentConfig/import/progress` and `/completed`, correlated by it.
 */
export const importExternalAgentConfig = (migrationSource: string, migrationItems: unknown[]) =>
  invoke<string>("import_external_agent_config", { migrationSource, migrationItems });

export const listSkills = (cwds: string[] = [], forceReload = false) =>
  invoke<SkillsListResponse>("list_skills", { cwds, forceReload });

// -- Collaboration mode (`collaborationMode/list`) ---------------------------
// The engine's model is base-plus-mask, not a flag: a preset is applied on top
// of an unmasked Default mode via the engine's own `apply_mask`, in Rust.

export const listCollaborationModes = () =>
  invoke<CollaborationModePreset[]>("list_collaboration_modes");

export const setCollaborationMode = (
  threadId: string,
  mode: string,
  model: string | null,
  effort: ReasoningEffort | null,
) => invoke<OpaqueResult>("set_collaboration_mode", { threadId, mode, model, effort });

/**
 * `fuzzyFileSearch`, for the composer's `@` completions.
 *
 * `cancellationToken` is the engine's concurrency contract, not a nonce: it
 * cancels any *previous* request that used the same value, so callers pass one
 * stable token per typing session and let each keystroke supersede the last.
 */
export const searchFiles = (query: string, roots: string[], cancellationToken: string) =>
  invoke<FileSearchHit[]>("search_files", { query, roots, cancellationToken });

/** `thread/compact/start` — the TUI's `/compact`. */
export const compactThread = (threadId: string) =>
  invoke<OpaqueResult>("compact_thread", { threadId });

/** `review/start` — the CLI's `codex review`. */
export const startReview = (
  threadId: string,
  target: ReviewTargetInput,
  delivery: ReviewDelivery,
) => invoke<ReviewStartResult>("start_review", { threadId, target, delivery });

/** Context pressure, computed by the engine's formula in Rust. */
export const contextUsage = (
  lastTotalTokens: number,
  totalTokensInWindow: number,
  modelContextWindow: number | null,
) =>
  invoke<ContextUsage>("context_usage", {
    lastTotalTokens,
    totalTokensInWindow,
    modelContextWindow,
  });

// -- Approvals (ADR-0015 / ADR-0016) -----------------------------------------

export const resolveCommandExecutionApproval = (
  requestId: unknown,
  decision: Record<string, unknown>,
) => invoke<void>("resolve_command_execution_approval", { requestId, decision });

export const resolveFileChangeApproval = (
  requestId: unknown,
  decision: Record<string, unknown>,
) => invoke<void>("resolve_file_change_approval", { requestId, decision });

export const resolvePermissionsApproval = (
  requestId: unknown,
  response: Record<string, unknown>,
) => invoke<void>("resolve_permissions_approval", { requestId, response });

export const rejectApproval = (requestId: unknown, message: string) =>
  invoke<void>("reject_approval", { requestId, message });

/**
 * Answers `item/tool/requestUserInput`. Rust encodes the drafts into the
 * protocol's answer map, including the `user_note:` prefix the engine uses to
 * tell free text from a chosen option label.
 */
export const resolveUserInputRequest = (
  requestId: unknown,
  answers: UserInputAnswerDraft[],
) => invoke<void>("resolve_user_input_request", { requestId, answers });

/**
 * Flattens an MCP elicitation's form schema into renderable fields. Done in
 * Rust because the schema is a deeply nested untagged union with renamed
 * fields — see `src/elicitation.rs`.
 */
export const elicitationView = (params: Record<string, unknown>) =>
  invoke<ElicitationView>("elicitation_view", { params });

/**
 * Answers `mcpServer/elicitation/request`. `fields` go back so Rust can type
 * each answer from its declared control; `content` is only sent on accept.
 */
export const resolveElicitation = (
  requestId: unknown,
  action: "accept" | "decline" | "cancel",
  fields: ElicitationField[],
  answers: ElicitationAnswer[],
) => invoke<void>("resolve_elicitation", { requestId, action, fields, answers });

// -- MCP servers / hooks / plugins / account (settings 集成 + 编码 screens) ---
// All of these are thin client calls onto app-server RPCs (ADR-0021).

export const listMcpServers = () => invoke<ListMcpServerStatusResponse>("list_mcp_servers");
export const mcpServerLogin = (name: string) =>
  invoke<McpServerOauthLoginResponse>("mcp_server_login", { name });
export const reloadMcpServers = () => invoke<OpaqueResult>("reload_mcp_servers");

export const listHooks = () => invoke<HooksListResponse>("list_hooks");

export const listPlugins = (cwds?: string[], forceRefetch?: boolean) =>
  invoke<PluginListResponse>("list_plugins", {
    cwds: cwds ?? null,
    forceRefetch: forceRefetch ?? false,
  });
export const listInstalledPlugins = (cwds?: string[]) =>
  invoke<PluginListResponse>("list_installed_plugins", { cwds: cwds ?? null });
export const installPlugin = (
  pluginName: string,
  marketplacePath?: string | null,
  remoteMarketplaceName?: string | null,
) =>
  invoke<OpaqueResult>("install_plugin", {
    pluginName,
    marketplacePath: marketplacePath ?? null,
    remoteMarketplaceName: remoteMarketplaceName ?? null,
  });
export const uninstallPlugin = (pluginId: string) =>
  invoke<OpaqueResult>("uninstall_plugin", { pluginId });
export const addMarketplace = (source: string, refName?: string | null) =>
  invoke<OpaqueResult>("add_marketplace", { source, refName: refName ?? null });
export const removeMarketplace = (marketplaceName: string) =>
  invoke<OpaqueResult>("remove_marketplace", { marketplaceName });
export const upgradeMarketplace = (marketplaceName?: string | null) =>
  invoke<MarketplaceUpgradeResponse>("upgrade_marketplace", {
    marketplaceName: marketplaceName ?? null,
  });

export const readAccountUsage = () =>
  invoke<GetAccountTokenUsageResponse>("read_account_usage");
/**
 * Sign-in and sign-out only. Nothing here touches billing or credits —
 * `account/rateLimitResetCredit/consume` and the add-credits nudge exist in
 * the protocol and are deliberately not wrapped.
 */
export const startAccountLogin = () => invoke<LoginAccountResponse>("start_account_login");
export const cancelAccountLogin = (loginId: string) =>
  invoke<OpaqueResult>("cancel_account_login", { loginId });
export const logoutAccount = () => invoke<OpaqueResult>("logout_account");

// -- Queue (`thread/queue/*`) ------------------------------------------------
//
// The engine drains this queue itself: `QueuedItemService` auto-dispatches the
// head of the queue whenever a thread goes idle for any cause except an
// interrupt (`ext/queue/src/service.rs`). So nothing here calls `queueStart`
// on turn completion — that would race the engine's own dispatch. It is only
// correct after an interrupt, which is the case the engine deliberately skips.

export const queueAdd = (
  threadId: string,
  text: string,
  attachments: ComposerAttachment[] = [],
  skills: ComposerSkill[] = [],
  fileRefs: ComposerFileRef[] = [],
  mentions: ComposerMention[] = [],
) =>
  invoke<OpaqueResult>("queue_add", { threadId, text, attachments, skills, fileRefs, mentions });

export const queueList = (threadId: string) =>
  invoke<QueuedSubmissionView[]>("queue_list", { threadId });

export const queueUpdate = (threadId: string, queuedSubmissionId: string, text: string) =>
  invoke<OpaqueResult>("queue_update", { threadId, queuedSubmissionId, text });

export const queueDelete = (threadId: string, queuedSubmissionId: string) =>
  invoke<OpaqueResult>("queue_delete", { threadId, queuedSubmissionId });

/**
 * `thread/queue/reorder` expressed as a move. The RPC wants a complete
 * ordering; deriving it from a move is index arithmetic that is quietly wrong
 * at the ends, so it lives in Rust under test (`reorder_ids`).
 */
export const queueMove = (
  threadId: string,
  queuedSubmissionIds: string[],
  queuedSubmissionId: string,
  delta: number,
) => invoke<OpaqueResult>("queue_move", { threadId, queuedSubmissionIds, queuedSubmissionId, delta });

/**
 * Manual dispatch. Only meaningful when the thread is idle *and* the engine
 * skipped its own dispatch, i.e. after an interrupt.
 */
export const queueStart = (threadId: string, queuedSubmissionId?: string | null) =>
  invoke<OpaqueResult>("queue_start", { threadId, queuedSubmissionId: queuedSubmissionId ?? null });

// -- Background terminals (`thread/backgroundTerminals/*`) -------------------

export const backgroundTerminalsList = (threadId: string) =>
  invoke<BackgroundTerminalView[]>("background_terminals_list", { threadId });

export const backgroundTerminalTerminate = (threadId: string, processId: string) =>
  invoke<OpaqueResult>("background_terminal_terminate", { threadId, processId });

export const backgroundTerminalsClean = (threadId: string) =>
  invoke<OpaqueResult>("background_terminals_clean", { threadId });

// -- Thread goal (`thread/goal/*`) -------------------------------------------

export const goalGet = (threadId: string) =>
  invoke<ThreadGoalGetResponse>("goal_get", { threadId });

export const goalSet = (
  threadId: string,
  objective?: string | null,
  status?: ThreadGoalStatus | null,
  tokenBudget?: TokenBudgetEdit | null,
) =>
  invoke<ThreadGoalSetResponse>("goal_set", {
    threadId,
    objective: objective ?? null,
    status: status ?? null,
    tokenBudget: tokenBudget ?? null,
  });

export const goalClear = (threadId: string) => invoke<OpaqueResult>("goal_clear", { threadId });

// -- Memories ----------------------------------------------------------------

export const readMemorySettings = () => invoke<MemorySettings>("read_memory_settings");

/**
 * `generateChanged` mirrors the TUI: the per-thread memory mode is only
 * pushed when the write-path setting actually changed, because that is the
 * one that affects the thread already running.
 */
export const setMemorySettings = (
  settings: MemorySettings,
  threadId: string | null,
  generateChanged: boolean,
) => invoke<OpaqueResult>("set_memory_settings", { settings, threadId, generateChanged });

/** Irreversible and global to this `$CODEX_HOME` — see `src/memories.rs`. */
export const resetMemories = () => invoke<OpaqueResult>("reset_memories");

/**
 * `skills/config/write`. Returns the server's `effectiveEnabled`, which can
 * differ from the requested value when a higher config layer pins the skill.
 */
export const setSkillEnabled = (path: string, enabled: boolean) =>
  invoke<boolean>("set_skill_enabled", { path, enabled });
