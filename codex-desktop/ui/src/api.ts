import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppServerEventEnvelope,
  ApprovalMode,
  ComposerAttachment,
  ComposerSkill,
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  ContextUsage,
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
  Project,
  ReasoningEffort,
  ReviewDelivery,
  ReviewTargetInput,
  SettingEdit,
  SkillsListResponse,
  ThreadListResponse,
  ThreadResumeResponse,
  ThreadSearchResponse,
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

/// Attachments and skills are sent as this app's own flat shapes; Rust
/// (`src/composer.rs`) maps them onto `UserInput` and orders them the way the
/// TUI does (images, text, skills).
export const sendTurn = (
  threadId: string,
  text: string,
  attachments: ComposerAttachment[] = [],
  skills: ComposerSkill[] = [],
) => invoke<unknown>("send_turn", { threadId, text, attachments, skills });
export const interruptTurn = (threadId: string, turnId: string) =>
  invoke<unknown>("interrupt_turn", { threadId, turnId });

// -- Composer capability -----------------------------------------------------

/// Native image picker. Reuses the already-granted `dialog:default`
/// capability, same as the sidebar's folder picker.
export const pickImageFiles = () =>
  open({
    multiple: true,
    directory: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
  });

export const listSkills = (cwds: string[] = [], forceReload = false) =>
  invoke<SkillsListResponse>("list_skills", { cwds, forceReload });

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
