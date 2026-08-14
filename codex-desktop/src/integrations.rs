//! Commands behind the 连接 / 钩子 / 插件 / 账户 settings screens.
//!
//! Split out of `commands.rs` purely for size; the contract is identical —
//! thin wrappers that forward to an app-server RPC and hand the raw JSON-RPC
//! result to the frontend (ADR-0021: this crate adds no behavior of its own).
//!
//! Everything here is a client call. Nothing reads `auth.json`, parses
//! `config.toml`, walks a plugin directory, or shells out to `codex`.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::HooksListParams;
use codex_app_server_protocol::ListMcpServerStatusParams;
use codex_app_server_protocol::LoginAccountParams;
use codex_app_server_protocol::MarketplaceAddParams;
use codex_app_server_protocol::MarketplaceRemoveParams;
use codex_app_server_protocol::MarketplaceUpgradeParams;
use codex_app_server_protocol::McpServerOauthLoginParams;
use codex_app_server_protocol::McpServerStatusDetail;
use codex_app_server_protocol::PluginInstallParams;
use codex_app_server_protocol::PluginInstalledParams;
use codex_app_server_protocol::PluginListParams;
use codex_app_server_protocol::PluginUninstallParams;
use serde_json::Value as JsonValue;
use tauri::State;

use crate::bridge::AppServerBridge;

type CmdResult<T> = Result<T, String>;

// --- MCP servers (连接) -----------------------------------------------------

/// Lists configured MCP servers with their auth status and advertised tools.
///
/// `ToolsAndAuthOnly` rather than `Full`: the settings screen shows tool
/// counts and auth state, and does not render resources or resource
/// templates, so fetching them would be dead weight on every open.
///
/// `threadId` is left `None` — this is the global server inventory, not a
/// thread-scoped view.
#[tauri::command]
pub async fn list_mcp_servers(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::McpServerStatusList {
            request_id: bridge.next_request_id(),
            params: ListMcpServerStatusParams {
                cursor: None,
                limit: None,
                detail: Some(McpServerStatusDetail::ToolsAndAuthOnly),
                thread_id: None,
            },
        })
        .await
}

/// Starts the OAuth flow for a server whose `authStatus` is `notLoggedIn`.
///
/// Returns `{ authorizationUrl }`; the *caller* must open it. Completion
/// arrives later as the `mcpServer/oauthLogin/completed` notification, so this
/// resolving is not the same as being logged in.
#[tauri::command]
pub async fn mcp_server_login(
    bridge: State<'_, AppServerBridge>,
    name: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::McpServerOauthLogin {
            request_id: bridge.next_request_id(),
            params: McpServerOauthLoginParams {
                name,
                thread_id: None,
                // Omitted so app-server performs its normal automatic
                // discovery; pinning a registration strategy here would be
                // this crate deciding policy it has no basis to decide.
                client_registration: None,
                scopes: None,
                timeout_secs: None,
            },
        })
        .await
}

/// Re-reads the MCP registry after a config change (`config/mcpServer/reload`).
#[tauri::command]
pub async fn reload_mcp_servers(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::McpServerRefresh {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

// --- Hooks (钩子) -----------------------------------------------------------

/// Lists configured hooks. Read-only by necessity: `hooks/list` has no write
/// counterpart anywhere in the protocol, so the screen sends users to
/// `config.toml` rather than this crate growing a hook editor (ADR-0021).
///
/// `cwds` empty means "the current session working directory" per the param's
/// own documentation.
#[tauri::command]
pub async fn list_hooks(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::HooksList {
            request_id: bridge.next_request_id(),
            params: HooksListParams { cwds: Vec::new() },
        })
        .await
}

// --- Plugins (插件) ---------------------------------------------------------

/// Browsable catalog: every marketplace this machine can see, each with its
/// plugins. `cwds` carries the open Projects so repo-local marketplaces are
/// discovered too.
#[tauri::command]
pub async fn list_plugins(
    bridge: State<'_, AppServerBridge>,
    cwds: Option<Vec<String>>,
    force_refetch: Option<bool>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::PluginList {
            request_id: bridge.next_request_id(),
            params: PluginListParams {
                cwds: parse_cwds(cwds)?,
                // Omitted: app-server then queries local marketplaces plus the
                // default remote catalog when its feature flag allows it.
                marketplace_kinds: None,
                force_refetch: force_refetch.unwrap_or(false),
            },
        })
        .await
}

/// The installed subset. A separate RPC from `plugin/list` rather than a
/// filter over it, and — worth knowing — `plugin/installed` is a *request*,
/// not a notification: there is no push signal after an install, so callers
/// re-list.
#[tauri::command]
pub async fn list_installed_plugins(
    bridge: State<'_, AppServerBridge>,
    cwds: Option<Vec<String>>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::PluginInstalled {
            request_id: bridge.next_request_id(),
            params: PluginInstalledParams {
                cwds: parse_cwds(cwds)?,
                install_suggestion_plugin_names: None,
            },
        })
        .await
}

#[tauri::command]
pub async fn install_plugin(
    bridge: State<'_, AppServerBridge>,
    plugin_name: String,
    marketplace_path: Option<String>,
    remote_marketplace_name: Option<String>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::PluginInstall {
            request_id: bridge.next_request_id(),
            params: PluginInstallParams {
                marketplace_path: marketplace_path.map(parse_absolute_path).transpose()?,
                remote_marketplace_name,
                install_attempt_id: None,
                plugin_name,
            },
        })
        .await
}

#[tauri::command]
pub async fn uninstall_plugin(
    bridge: State<'_, AppServerBridge>,
    plugin_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::PluginUninstall {
            request_id: bridge.next_request_id(),
            params: PluginUninstallParams { plugin_id },
        })
        .await
}

#[tauri::command]
pub async fn add_marketplace(
    bridge: State<'_, AppServerBridge>,
    source: String,
    ref_name: Option<String>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::MarketplaceAdd {
            request_id: bridge.next_request_id(),
            params: MarketplaceAddParams {
                source,
                ref_name,
                sparse_paths: None,
            },
        })
        .await
}

#[tauri::command]
pub async fn remove_marketplace(
    bridge: State<'_, AppServerBridge>,
    marketplace_name: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::MarketplaceRemove {
            request_id: bridge.next_request_id(),
            params: MarketplaceRemoveParams { marketplace_name },
        })
        .await
}

/// Upgrades one marketplace, or every marketplace when `marketplaceName` is
/// omitted. The response reports per-marketplace errors alongside successes,
/// so a partial failure is visible rather than swallowed.
#[tauri::command]
pub async fn upgrade_marketplace(
    bridge: State<'_, AppServerBridge>,
    marketplace_name: Option<String>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::MarketplaceUpgrade {
            request_id: bridge.next_request_id(),
            params: MarketplaceUpgradeParams { marketplace_name },
        })
        .await
}

// --- Account (账户) ---------------------------------------------------------
//
// Read plus sign-in/sign-out. There is deliberately no billing, upgrade or
// credit-purchase call here: `account/rateLimitResetCredit/consume` and
// `account/sendAddCreditsNudgeEmail` exist in the protocol and are
// intentionally not wrapped.

/// Aggregate token usage. Distinct from `account/rateLimits/read`, which is
/// about current limits; this is lifetime/daily history.
#[tauri::command]
pub async fn read_account_usage(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::GetAccountTokenUsage {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

/// Begins ChatGPT sign-in. Returns `{ loginId, authUrl }`; the caller opens
/// `authUrl` and waits for the `account/login/completed` notification.
///
/// `codexStreamlinedLogin` and `useHostedLoginSuccessPage` are left at their
/// defaults, and `appBrand` unset — Codex Desktop has no hosted success page
/// of its own to point at.
#[tauri::command]
pub async fn start_account_login(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::LoginAccount {
            request_id: bridge.next_request_id(),
            params: LoginAccountParams::Chatgpt {
                codex_streamlined_login: false,
                use_hosted_login_success_page: false,
                app_brand: None,
            },
        })
        .await
}

#[tauri::command]
pub async fn cancel_account_login(
    bridge: State<'_, AppServerBridge>,
    login_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::CancelLoginAccount {
            request_id: bridge.next_request_id(),
            params: codex_app_server_protocol::CancelLoginAccountParams { login_id },
        })
        .await
}

#[tauri::command]
pub async fn logout_account(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::LogoutAccount {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

// --- helpers ---------------------------------------------------------------

fn parse_absolute_path(path: String) -> CmdResult<codex_utils_absolute_path::AbsolutePathBuf> {
    codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path(std::path::PathBuf::from(&path))
        .map_err(|err| format!("`{path}` is not an absolute path: {err}"))
}

fn parse_cwds(
    cwds: Option<Vec<String>>,
) -> CmdResult<Option<Vec<codex_utils_absolute_path::AbsolutePathBuf>>> {
    cwds.map(|paths| paths.into_iter().map(parse_absolute_path).collect())
        .transpose()
}
