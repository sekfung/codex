//! Self-update over Tauri's updater plugin (ADR-0007).
//!
//! ADR-0007 chose this over reusing `codex update`: the CLI and this app are
//! separate binaries on separate distribution channels, and signed bundles
//! checked by the app itself is the platform-standard mechanism.
//!
//! **This ships unconfigured on purpose.** The plugin needs an update endpoint
//! and the public half of a signing keypair, and neither can be invented — a
//! plausible-looking placeholder key would be worse than none, because it
//! would look configured while failing signature checks at the worst possible
//! moment. So `tauri.conf.json` carries an empty `endpoints`/`pubkey`, and
//! this module reports that state as *unconfigured* rather than letting it
//! surface as a network error or, worse, as "you are up to date".

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::cmd::CmdResult;

/// Outcome of an update check, kept as a tagged union so the frontend cannot
/// confuse "nothing to install" with "we never looked".
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// No endpoint or no public key. Distinct from `UpToDate` because the
    /// difference is the whole point: one means checked, the other means
    /// unable to check.
    #[serde(rename_all = "camelCase")]
    NotConfigured { reason: String },
    #[serde(rename_all = "camelCase")]
    UpToDate { current_version: String },
    #[serde(rename_all = "camelCase")]
    Available {
        current_version: String,
        version: String,
        notes: Option<String>,
    },
}

/// Why the updater cannot run, or `None` when it is configured.
///
/// Read from the same `plugins.updater` block the plugin itself parses, so
/// this cannot drift from what the plugin will do: `pubkey` is a required
/// field there and `endpoints` defaults to empty, which is exactly the
/// shipped state.
fn unconfigured_reason(app: &AppHandle) -> Option<String> {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return Some("tauri.conf.json 中没有 plugins.updater 配置".to_string());
    };
    let endpoints_empty = config
        .get("endpoints")
        .and_then(|value| value.as_array())
        .is_none_or(|endpoints| endpoints.is_empty());
    let pubkey_empty = config
        .get("pubkey")
        .and_then(|value| value.as_str())
        .is_none_or(str::is_empty);

    match (endpoints_empty, pubkey_empty) {
        (true, true) => Some("尚未配置更新源地址与签名公钥".to_string()),
        (true, false) => Some("尚未配置更新源地址（plugins.updater.endpoints）".to_string()),
        (false, true) => Some("尚未配置签名公钥（plugins.updater.pubkey）".to_string()),
        (false, false) => None,
    }
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> CmdResult<UpdateStatus> {
    if let Some(reason) = unconfigured_reason(&app) {
        return Ok(UpdateStatus::NotConfigured { reason });
    }

    let updater = app.updater().map_err(|err| err.to_string())?;
    let current_version = app.package_info().version.to_string();
    match updater.check().await.map_err(|err| err.to_string())? {
        Some(update) => Ok(UpdateStatus::Available {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            notes: update.body.clone(),
        }),
        None => Ok(UpdateStatus::UpToDate { current_version }),
    }
}

/// Downloads and installs the pending update.
///
/// Re-checks rather than caching the `Update` from `check_for_update`: the
/// handle is not `Send` across the command boundary, and a stale one would
/// install a version the user was never shown.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    if let Some(reason) = unconfigured_reason(&app) {
        return Err(reason);
    }

    let updater = app.updater().map_err(|err| err.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "没有可安装的更新".to_string())?;

    update
        .download_and_install(|_downloaded, _total| {}, || {})
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
#[path = "updater_tests.rs"]
mod tests;
