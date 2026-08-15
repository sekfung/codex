//! Settings-screen backing: reading and writing `config.toml` (ADR-0020).
//!
//! ADR-0020 draws the line between behavior settings, which live in
//! `config.toml` and are therefore honored by the CLI too, and desktop chrome
//! (Project list, theme mode), which stays app-local. Everything in this
//! module is on the `config.toml` side.
//!
//! Values go through the app-server's own config RPCs rather than editing the
//! TOML directly, so layering (managed/project/user), validation and version
//! conflicts stay the server's job:
//!
//! - `config/read` -> effective config plus which layer each key came from
//! - `config/value/write` / `config/batchWrite` -> user-layer edits
//! - `configRequirements/read` -> deployment-imposed limits on allowed values
//!
//! `keyPath` is a dotted **snake_case TOML** path (`model_reasoning_effort`,
//! `sandbox_workspace_write.network_access`), not the camelCase field name the
//! JSON `Config` struct uses — see `config_manager_service::parse_key_path`.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ConfigBatchWriteParams;
use codex_app_server_protocol::ConfigEdit;
use codex_app_server_protocol::ConfigReadParams;
use codex_app_server_protocol::ConfigValueWriteParams;
use codex_app_server_protocol::MergeStrategy;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use tauri::State;

use crate::approval_mode::ApprovalMode;
use crate::bridge::AppServerBridge;
use crate::cmd::CmdResult;

/// One `config.toml` edit as requested by the settings UI.
///
/// `value` is a raw JSON value so the frontend can send whatever the key's
/// schema expects (string enum, bool, number, table) without this layer
/// needing a variant per setting. The server validates against the real config
/// schema and rejects unknown keys, which is a better check than anything
/// duplicated here.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingEdit {
    pub key_path: String,
    pub value: JsonValue,
}

impl From<SettingEdit> for ConfigEdit {
    fn from(edit: SettingEdit) -> Self {
        ConfigEdit {
            key_path: edit.key_path,
            value: edit.value,
            // `Replace` is right for scalar settings: `Upsert` would merge into
            // an existing table, which for a plain value is meaningless and for
            // a table setting would silently keep stale sibling keys.
            merge_strategy: MergeStrategy::Replace,
        }
    }
}

/// Effective config plus per-key origin, so the UI can tell the user when a
/// value is pinned by a managed/project layer rather than their own.
#[tauri::command]
pub async fn read_config(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ConfigRead {
            request_id: bridge.next_request_id(),
            params: ConfigReadParams {
                // Origins alone are enough to show "managed by your
                // organization"; the full layer bodies are not rendered.
                include_layers: false,
                // No cwd: the settings screen edits the *user* default, not a
                // project-scoped effective value.
                cwd: None,
            },
        })
        .await
}

/// Deployment-imposed limits (`requirements.toml` / MDM). `requirements` is
/// null when nothing is configured, which is the common case.
#[tauri::command]
pub async fn read_config_requirements(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ConfigRequirementsRead {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

/// Writes one setting to the user's `config.toml`.
#[tauri::command]
pub async fn write_config_value(
    bridge: State<'_, AppServerBridge>,
    edit: SettingEdit,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ConfigValueWrite {
            request_id: bridge.next_request_id(),
            params: ConfigValueWriteParams {
                key_path: edit.key_path,
                value: edit.value,
                merge_strategy: MergeStrategy::Replace,
                // Omitted: defaults to the user's `config.toml`, which is the
                // only layer the settings screen is allowed to edit.
                file_path: None,
                // No optimistic-concurrency check: this app is the only writer
                // in its own process and a failed write surfaces to the user.
                expected_version: None,
            },
        })
        .await
}

/// Writes several settings atomically — used where one UI control maps to more
/// than one config key (the approval-mode presets, below).
#[tauri::command]
pub async fn write_config_batch(
    bridge: State<'_, AppServerBridge>,
    edits: Vec<SettingEdit>,
) -> CmdResult<JsonValue> {
    write_config_edits(&bridge, edits.into_iter().map(Into::into).collect()).await
}

/// Shared by the settings commands here and in `memories.rs`, so every
/// multi-key control writes through one path with the same reload semantics.
pub(crate) async fn write_config_edits(
    bridge: &AppServerBridge,
    edits: Vec<ConfigEdit>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ConfigBatchWrite {
            request_id: bridge.next_request_id(),
            params: ConfigBatchWriteParams {
                edits,
                file_path: None,
                expected_version: None,
                // Push the new defaults into already-loaded threads instead of
                // leaving this session on the previous values until restart.
                reload_user_config: true,
            },
        })
        .await
}

/// Persists the default approval mode (ADR-0016 layer 1's *default*, as
/// opposed to the composer's per-thread override).
///
/// One selector value expands to three config keys, so this goes through
/// `config/batchWrite`: a partial write would leave the three inconsistent
/// (e.g. full-access permissions with an `on-request` policy).
///
/// The expansion reuses `ApprovalMode::resolve` — the same mapping the
/// per-thread path uses — so the default and the override can never drift.
#[tauri::command]
pub async fn set_default_approval_mode(
    bridge: State<'_, AppServerBridge>,
    approval_mode: ApprovalMode,
) -> CmdResult<JsonValue> {
    let resolved = approval_mode.resolve()?;
    let edits = vec![
        ConfigEdit {
            key_path: "approval_policy".to_string(),
            value: serde_json::to_value(resolved.approval_policy)
                .map_err(|err| format!("approval_policy is not serializable: {err}"))?,
            merge_strategy: MergeStrategy::Replace,
        },
        ConfigEdit {
            key_path: "approvals_reviewer".to_string(),
            value: serde_json::to_value(resolved.approvals_reviewer)
                .map_err(|err| format!("approvals_reviewer is not serializable: {err}"))?,
            merge_strategy: MergeStrategy::Replace,
        },
        ConfigEdit {
            // `ConfigToml::default_permissions` takes exactly the `:`-prefixed
            // built-in profile id `resolve()` already produces for the
            // per-thread `ThreadStartParams::permissions` field — so the
            // default and the override are literally the same value, written
            // to two different places. Note this is *not* `sandbox_mode`:
            // that's the older, coarser key, and mixing the two would let the
            // profile and the sandbox mode disagree.
            key_path: "default_permissions".to_string(),
            value: JsonValue::String(resolved.permission_profile_id),
            merge_strategy: MergeStrategy::Replace,
        },
    ];
    write_config_edits(&bridge, edits).await
}

/// The persisted default approval mode, or `null` when `config.toml` holds a
/// combination the 3-preset selector can't express (see
/// [`ApprovalMode::from_config_parts`]).
///
/// Done here rather than in the frontend because of a serde subtlety worth
/// stating: `v2::Config` is `rename_all = "camelCase"` for its *named* fields,
/// but `default_permissions` is not one of them — it falls into the
/// `#[serde(flatten)] additional` map, where keys pass through verbatim. So
/// the JSON mixes `approvalPolicy` with `default_permissions`, and reading it
/// correctly is exactly the kind of detail that should not be duplicated in
/// TypeScript.
#[tauri::command]
pub async fn read_default_approval_mode(
    bridge: State<'_, AppServerBridge>,
) -> CmdResult<Option<ApprovalMode>> {
    let response = read_config(bridge).await?;
    let config = response.get("config").unwrap_or(&JsonValue::Null);

    let approval_policy = config
        .get("approvalPolicy")
        .filter(|value| !value.is_null())
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|err| format!("config approvalPolicy is not a known policy: {err}"))?;
    let approvals_reviewer = config
        .get("approvalsReviewer")
        .filter(|value| !value.is_null())
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|err| format!("config approvalsReviewer is not a known reviewer: {err}"))?;
    let permission_profile_id = config
        .get("default_permissions")
        .and_then(JsonValue::as_str);

    Ok(ApprovalMode::from_config_parts(
        approval_policy.as_ref(),
        approvals_reviewer,
        permission_profile_id,
    ))
}

/// Absolute path of the `config.toml` the settings screen writes to, for the
/// "打开 config.toml" affordance.
///
/// Resolved the same way the CLI does (`CODEX_HOME`, else the default home),
/// so it names the file the user would edit by hand (ADR-0008).
#[tauri::command]
pub async fn config_file_path() -> CmdResult<String> {
    let home = codex_utils_home_dir::find_codex_home()
        .map_err(|err| format!("failed to resolve CODEX_HOME: {err}"))?;
    Ok(home.as_path().join("config.toml").display().to_string())
}

/// Opens a path with the OS default handler.
///
/// Hand-rolled rather than pulling in `tauri-plugin-opener`: this is one
/// `Command` per platform, and the pnpm workspace's `minimumReleaseAge`/trust
/// policy makes adding a new dependency a heavier step than the feature earns.
#[tauri::command]
pub async fn open_path_in_os(path: String) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = tokio::process::Command::new("open");
        command.arg(&path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        // `start` is a cmd builtin, and the empty string is the window title
        // that `start` would otherwise take the path for.
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/C", "start", "", &path]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = tokio::process::Command::new("xdg-open");
        command.arg(&path);
        command
    };

    let status = command
        .status()
        .await
        .map_err(|err| format!("failed to launch the OS file handler: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("the OS file handler exited with {status}"))
    }
}
