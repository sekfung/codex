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
  FileSearchHit,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  GetAccountTokenUsageResponse,
  HooksListResponse,
  ListMcpServerStatusResponse,
  LoginAccountResponse,
  MarketplaceUpgradeResponse,
  McpServerOauthLoginResponse,
  ModelListResponse,
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
  ThreadListResponse,
  ThreadResumeResponse,
  ThreadSearchResponse,
  TokenBudgetEdit,
  TurnSubmission,
  UserInputAnswerDraft,
} from "./types";

/// `thread/fork` returns the same envelope shape as resume, plus more fields
/// we don't consume yet — only `thread.id` is needed to switch to the fork.
type ThreadForkResponse = ThreadResumeResponse;

// Mirrors `bridge::APP_SERVER_EVENT` in the Rust backend — keep in sync.
const APP_SERVER_EVENT = "codex-desktop://app-server-event";

export function onAppServerEvent(
  handler: (event: AppServerEventEnvelope) => void,
): Promise<() => void> {
  return listen<AppServerEventEnvelope>(APP_SERVER_EVENT, (event) => handler(event.payload));
}

// -- Projects (ADR-0012) -----------------------------------------------------

export const listProjects = () => invoke<Project[]>("list_projects");
export const addProject = (path: string) => invoke<Project>("add_project", { path });
export const removeProject = (id: string) => invoke<void>("remove_project", { id });
// Uses `@tauri-apps/plugin-dialog` directly (gated by the `dialog:default`
// capability) instead of a custom Rust command — this is the plugin's own
// well-tested IPC path, not a hand-rolled oneshot-channel wrapper around it.
export const pickProjectFolder = () => open({ directory: true, multiple: false });

// -- Threads ------------------------------------------------------------

/// `archived` is the protocol's tri-state: `true` returns *only* archived
/// threads, `false`/`null` only non-archived. There is no "both", so the
/// archived view is a second call rather than a filter over one result.
export const listThreads = (projectPath: string, archived?: boolean) =>
  invoke<ThreadListResponse>("list_threads", { projectPath, archived: archived ?? null });

export const setThreadName = (threadId: string, name: string) =>
  invoke<unknown>("set_thread_name", { threadId, name });
export const archiveThread = (threadId: string) =>
  invoke<unknown>("archive_thread", { threadId });
export const unarchiveThread = (threadId: string) =>
  invoke<unknown>("unarchive_thread", { threadId });
export const deleteThread = (threadId: string) =>
  invoke<unknown>("delete_thread", { threadId });

/// Searches across every Project — `thread/search` has no cwd filter.
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
  invoke<unknown>("start_thread", {
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
  invoke<unknown>("set_approval_mode", { threadId, approvalMode });

// Model picker, following the same two-layer shape: applied to the active
// thread here, and carried onto new threads by `startThread`.
export const listModels = () => invoke<ModelListResponse>("list_models");

export const setModel = (
  threadId: string,
  model: string | null,
  effort: ReasoningEffort | null,
) => invoke<unknown>("set_model", { threadId, model, effort });

// -- Settings / config.toml (ADR-0020) ---------------------------------------
// Behavior settings live in `config.toml` so the CLI honors them too; desktop
// chrome (Project list, theme mode) stays app-local.

export const readConfig = () => invoke<ConfigReadResponse>("read_config");
export const readConfigRequirements = () =>
  invoke<ConfigRequirementsReadResponse>("read_config_requirements");

export const writeConfigValue = (edit: SettingEdit) =>
  invoke<unknown>("write_config_value", { edit });
export const writeConfigBatch = (edits: SettingEdit[]) =>
  invoke<unknown>("write_config_batch", { edits });

/// The persisted *default* approval mode, as opposed to the composer's
/// per-thread override. `null` when `config.toml` holds a combination the
/// 3-preset selector can't express — the mapping lives in Rust
/// (`src/approval_mode.rs`) so the forward and reverse directions can't drift.
export const readDefaultApprovalMode = () =>
  invoke<ApprovalMode | null>("read_default_approval_mode");

/// Writes the default approval mode. One selector value expands to three
/// config keys, written atomically in Rust.
export const setDefaultApprovalMode = (approvalMode: ApprovalMode) =>
  invoke<unknown>("set_default_approval_mode", { approvalMode });

export const configFilePath = () => invoke<string>("config_file_path");
export const openPathInOs = (path: string) => invoke<void>("open_path_in_os", { path });

// -- Turns --------------------------------------------------------------

/// Attachments, skills and file references are sent as this app's own flat
/// shapes; Rust (`src/composer.rs`) maps them onto `UserInput`, orders them the
/// way the TUI does (images, text, skills), and folds `fileRefs` into the text.
export const sendTurn = (
  threadId: string,
  text: string,
  attachments: ComposerAttachment[] = [],
  skills: ComposerSkill[] = [],
  fileRefs: ComposerFileRef[] = [],
  mentions: ComposerMention[] = [],
) =>
  invoke<unknown>("send_turn", { threadId, text, attachments, skills, fileRefs, mentions });

/// Submits composer input, letting Rust pick steer / start / queue the way the
/// TUI does (`tui/src/app/thread_routing.rs`). Pass the turn this client
/// believes is running, or `null` if it believes the thread is idle; the
/// engine's answer decides what actually happens, and the returned outcome
/// says which.
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
  invoke<unknown>("interrupt_turn", { threadId, turnId });

/// `thread/revert` — drops `beforeTurnId` and every later turn from the
/// thread's history. Conversation only: files the agent already wrote are
/// untouched (see `src/thread_ops.rs`).
export const revertThread = (threadId: string, beforeTurnId: string) =>
  invoke<unknown>("revert_thread", { threadId, beforeTurnId });

// -- Composer capability -----------------------------------------------------

/// Native image picker. Reuses the already-granted `dialog:default`
/// capability, same as the sidebar's folder picker.
///
/// Images only, deliberately: `UserInput` has no generic file variant
/// (`Text | Image | LocalImage | Audio | LocalAudio | Skill | Mention`), so
/// there is nothing to send a document as. Referencing a non-image file is
/// what `@` mentions are for. The explicit title matters because the image
/// filter makes this dialog look empty inside a source repo — without it,
/// "only folders are selectable" reads as a bug rather than as the filter
/// working.
export const pickImageFiles = () =>
  open({
    title: "选择图片（仅支持图片附件，引用其他文件请在输入框用 @）",
    multiple: true,
    directory: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
  });

/// The `@` menu's 文件和文件夹 entry.
///
/// Two dialogs, not one: `OpenDialogOptions.directory` is a boolean that
/// switches the dialog between file mode and folder mode, and the plugin
/// exposes no combined mode (nor do the native pickers underneath it on every
/// platform). So the menu offers the two as separate entries rather than
/// pretending one dialog can do both.
export const pickAnyFiles = () =>
  open({ title: "选择文件", multiple: true, directory: false });

export const pickAnyFolders = () =>
  open({ title: "选择文件夹", multiple: true, directory: true });

/// `app/list` — the 插件 section of the `@` menu.
export const listApps = () => invoke<AppsListResponse>("list_apps");

/// The `@…` token for a chosen app/plugin. Derived in Rust so the slug and
/// title-case rules stay next to the engine helpers they were ported from.
export const mentionToken = (mention: ComposerMention) =>
  invoke<string>("mention_token", { mention });

// -- Feedback (`feedback/upload`) --------------------------------------------

/// `classification` uses the engine's own values (`bad_result`, `good_result`,
/// `bug`, `safety_check`, `other`). `includeLogs` is the consent bit.
export const uploadFeedback = (
  classification: string,
  reason: string | null,
  threadId: string | null,
  includeLogs: boolean,
) => invoke<unknown>("upload_feedback", { classification, reason, threadId, includeLogs });

// -- External agent import (导入) --------------------------------------------

export const detectExternalAgentConfig = (cwds: string[]) =>
  invoke<DetectedMigrationSource[]>("detect_external_agent_config", { cwds });

/// `migrationItems` must be the server's own detected objects, echoed back
/// unchanged, with the same `migrationSource` detection used.
export const importExternalAgentConfig = (migrationSource: string, migrationItems: unknown[]) =>
  invoke<unknown>("import_external_agent_config", { migrationSource, migrationItems });

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
) => invoke<unknown>("set_collaboration_mode", { threadId, mode, model, effort });

/// `fuzzyFileSearch`, for the composer's `@` completions.
///
/// `cancellationToken` is the engine's concurrency contract, not a nonce: it
/// cancels any *previous* request that used the same value, so callers pass one
/// stable token per typing session and let each keystroke supersede the last.
export const searchFiles = (query: string, roots: string[], cancellationToken: string) =>
  invoke<FileSearchHit[]>("search_files", { query, roots, cancellationToken });

/// `thread/compact/start` — the TUI's `/compact`.
export const compactThread = (threadId: string) =>
  invoke<unknown>("compact_thread", { threadId });

/// `review/start` — the CLI's `codex review`.
export const startReview = (
  threadId: string,
  target: ReviewTargetInput,
  delivery: ReviewDelivery,
) => invoke<unknown>("start_review", { threadId, target, delivery });

/// Context pressure, computed by the engine's formula in Rust.
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

/// Answers `item/tool/requestUserInput`. Rust encodes the drafts into the
/// protocol's answer map, including the `user_note:` prefix the engine uses to
/// tell free text from a chosen option label.
export const resolveUserInputRequest = (
  requestId: unknown,
  answers: UserInputAnswerDraft[],
) => invoke<void>("resolve_user_input_request", { requestId, answers });

// -- MCP servers / hooks / plugins / account (settings 集成 + 编码 screens) ---
// All of these are thin client calls onto app-server RPCs (ADR-0021).

export const listMcpServers = () => invoke<ListMcpServerStatusResponse>("list_mcp_servers");
export const mcpServerLogin = (name: string) =>
  invoke<McpServerOauthLoginResponse>("mcp_server_login", { name });
export const reloadMcpServers = () => invoke<unknown>("reload_mcp_servers");

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
  invoke<unknown>("install_plugin", {
    pluginName,
    marketplacePath: marketplacePath ?? null,
    remoteMarketplaceName: remoteMarketplaceName ?? null,
  });
export const uninstallPlugin = (pluginId: string) =>
  invoke<unknown>("uninstall_plugin", { pluginId });
export const addMarketplace = (source: string, refName?: string | null) =>
  invoke<unknown>("add_marketplace", { source, refName: refName ?? null });
export const removeMarketplace = (marketplaceName: string) =>
  invoke<unknown>("remove_marketplace", { marketplaceName });
export const upgradeMarketplace = (marketplaceName?: string | null) =>
  invoke<MarketplaceUpgradeResponse>("upgrade_marketplace", {
    marketplaceName: marketplaceName ?? null,
  });

export const readAccountUsage = () =>
  invoke<GetAccountTokenUsageResponse>("read_account_usage");
/// Sign-in and sign-out only. Nothing here touches billing or credits —
/// `account/rateLimitResetCredit/consume` and the add-credits nudge exist in
/// the protocol and are deliberately not wrapped.
export const startAccountLogin = () => invoke<LoginAccountResponse>("start_account_login");
export const cancelAccountLogin = (loginId: string) =>
  invoke<unknown>("cancel_account_login", { loginId });
export const logoutAccount = () => invoke<unknown>("logout_account");

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
  invoke<unknown>("queue_add", { threadId, text, attachments, skills, fileRefs, mentions });

export const queueList = (threadId: string) =>
  invoke<QueuedSubmissionView[]>("queue_list", { threadId });

export const queueUpdate = (threadId: string, queuedSubmissionId: string, text: string) =>
  invoke<unknown>("queue_update", { threadId, queuedSubmissionId, text });

export const queueDelete = (threadId: string, queuedSubmissionId: string) =>
  invoke<unknown>("queue_delete", { threadId, queuedSubmissionId });

/// `thread/queue/reorder` expressed as a move. The RPC wants a complete
/// ordering; deriving it from a move is index arithmetic that is quietly wrong
/// at the ends, so it lives in Rust under test (`reorder_ids`).
export const queueMove = (
  threadId: string,
  queuedSubmissionIds: string[],
  queuedSubmissionId: string,
  delta: number,
) => invoke<unknown>("queue_move", { threadId, queuedSubmissionIds, queuedSubmissionId, delta });

/// Manual dispatch. Only meaningful when the thread is idle *and* the engine
/// skipped its own dispatch, i.e. after an interrupt.
export const queueStart = (threadId: string, queuedSubmissionId?: string | null) =>
  invoke<unknown>("queue_start", { threadId, queuedSubmissionId: queuedSubmissionId ?? null });

// -- Background terminals (`thread/backgroundTerminals/*`) -------------------

export const backgroundTerminalsList = (threadId: string) =>
  invoke<BackgroundTerminalView[]>("background_terminals_list", { threadId });

export const backgroundTerminalTerminate = (threadId: string, processId: string) =>
  invoke<unknown>("background_terminal_terminate", { threadId, processId });

export const backgroundTerminalsClean = (threadId: string) =>
  invoke<unknown>("background_terminals_clean", { threadId });

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

export const goalClear = (threadId: string) => invoke<unknown>("goal_clear", { threadId });
