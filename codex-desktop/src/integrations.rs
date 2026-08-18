//! Commands behind the 连接 / 钩子 / 插件 settings screens.
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
use crate::cmd::CmdResult;

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

// --- External agent config import (导入) ------------------------------------

/// The migration sources the TUI probes, in its order
/// (`tui/src/external_agent_config_migration/source.rs::ALL`).
const MIGRATION_SOURCES: [(&str, &str); 2] = [("claude-code", "Claude Code"), ("cursor", "Cursor")];

/// One detected migration item, flattened for display while keeping the
/// original for echo-back.
///
/// `raw` matters: `externalAgentConfig/import` takes `migrationItems` of the
/// same shape detection produced, and `ExternalAgentConfigMigrationItemType`
/// is `#[serde(rename = "AGENTS_MD")]`-style SCREAMING_CASE among camelCase
/// siblings. Round-tripping the server's own object means the frontend never
/// constructs that enum and cannot get it wrong.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedMigrationItem {
    /// Wire value of `itemType`, for display and grouping only.
    pub item_type: String,
    pub description: String,
    /// Null/empty means home-scoped; non-empty means repo-scoped.
    pub cwd: Option<String>,
    /// The server's object, passed back to `import` untouched.
    pub raw: JsonValue,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedMigrationSource {
    /// `migrationSource` selector — must be passed back to `import` unchanged,
    /// as the protocol doc requires.
    pub source: String,
    pub label: String,
    pub items: Vec<DetectedMigrationItem>,
    /// Detection failed for this source; the others may still have results.
    pub error: Option<String>,
}

/// `externalAgentConfig/detect`, once per known source.
///
/// `includeHome: true` and the open Projects as `cwds`, mirroring the TUI,
/// which passes its own cwd. Detection is read-only.
#[tauri::command]
pub async fn detect_external_agent_config(
    bridge: State<'_, AppServerBridge>,
    cwds: Vec<String>,
) -> CmdResult<Vec<DetectedMigrationSource>> {
    let cwds: Vec<std::path::PathBuf> = cwds.into_iter().map(std::path::PathBuf::from).collect();
    let mut sources = Vec::new();

    for (source, label) in MIGRATION_SOURCES {
        let response = bridge
            .request(ClientRequest::ExternalAgentConfigDetect {
                request_id: bridge.next_request_id(),
                params: codex_app_server_protocol::ExternalAgentConfigDetectParams {
                    include_home: true,
                    cwds: Some(cwds.clone()),
                    max_session_age_days: None,
                    max_sessions: None,
                    source: None,
                    migration_source: Some(source.to_string()),
                },
            })
            .await;

        // One source failing must not hide the others — the TUI logs and
        // continues here too.
        let (items, error) = match response {
            Ok(value) => (parse_detected_items(&value), None),
            Err(err) => (Vec::new(), Some(err)),
        };

        sources.push(DetectedMigrationSource {
            source: source.to_string(),
            label: label.to_string(),
            items,
            error,
        });
    }

    Ok(sources)
}

fn parse_detected_items(value: &JsonValue) -> Vec<DetectedMigrationItem> {
    value
        .get("items")
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| DetectedMigrationItem {
                    item_type: item
                        .get("itemType")
                        .and_then(JsonValue::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    description: item
                        .get("description")
                        .and_then(JsonValue::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    cwd: item
                        .get("cwd")
                        .and_then(JsonValue::as_str)
                        .map(ToString::to_string),
                    raw: item.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `externalAgentConfig/import`.
///
/// `migration_items` are the server's own detected objects, echoed back
/// verbatim, and `migration_source` is the same selector detection used — the
/// protocol requires both to match.
///
/// Import is additive by construction on the engine side, which is why this is
/// safe to expose as a single confirm: `merge_missing_toml_values` only
/// inserts keys absent from the target, `import_agents_md` writes only when
/// the target AGENTS.md is missing or empty, and hooks copy via
/// `copy_dir_recursive_skip_existing`
/// (`external-agent-migration/src/{config_values,service,hooks_common}.rs`).
/// Nothing here replaces an existing value.
#[tauri::command]
pub async fn import_external_agent_config(
    bridge: State<'_, AppServerBridge>,
    migration_source: String,
    migration_items: Vec<JsonValue>,
) -> CmdResult<String> {
    let migration_items = serde_json::from_value(JsonValue::Array(migration_items))
        .map_err(|err| format!("invalid migration items: {err}"))?;

    let response = bridge
        .request(ClientRequest::ExternalAgentConfigImport {
            request_id: bridge.next_request_id(),
            params: codex_app_server_protocol::ExternalAgentConfigImportParams {
                migration_items,
                source: Some(crate::CLIENT_NAME.to_string()),
                provider_id: Some(migration_source.clone()),
                migration_source: Some(migration_source),
            },
        })
        .await?;

    // The response carries *only* an id: per-item outcomes arrive later on
    // `externalAgentConfig/import/completed`. Returning the id is what lets the
    // screen correlate those, instead of leaving the user on "已开始导入"
    // forever with no idea whether their config actually imported.
    let response: codex_app_server_protocol::ExternalAgentConfigImportResponse =
        serde_json::from_value(response)
            .map_err(|err| format!("externalAgentConfig/import: {err}"))?;
    Ok(response.import_id)
}
