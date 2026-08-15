//! Feature-flag enablement, read from the engine rather than assumed.
//!
//! The TUI gates several commands on `config.features.enabled(...)`, which it
//! can read in-process. A client cannot, so the engine exposes the same table
//! over `experimentalFeature/list`. Its handler walks the whole `FEATURES`
//! table — not just experimental ones — and computes `enabled` from the loaded
//! config (`catalog_processor.rs`), so it is the correct basis for gating a
//! stable-stage flag like `personality` too.
//!
//! Gating matters: offering a control the deployment disabled would be a
//! control that appears to work and does not, which is the failure ADR-0021
//! exists to prevent.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ConfigEdit;
use codex_app_server_protocol::ExperimentalFeatureListParams;
use codex_app_server_protocol::ExperimentalFeatureListResponse;
use codex_app_server_protocol::MergeStrategy;
use serde::Serialize;
use tauri::State;

use crate::bridge::AppServerBridge;

/// One feature flag as the frontend consumes it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlag {
    /// Stable key used in `config.toml`, e.g. `personality`.
    pub name: String,
    /// Whether the loaded config enables it right now.
    pub enabled: bool,
    /// Whether it is on by default.
    pub default_enabled: bool,
    /// Lifecycle stage, lowercased (`beta`, `stable`, …).
    pub stage: String,
    /// Present only for beta-stage features; the engine leaves it null
    /// otherwise, which is what distinguishes a user-facing toggle from an
    /// internal flag.
    pub display_name: Option<String>,
    pub description: Option<String>,
}

/// Lists every feature flag with its current enablement.
///
/// Pagination is followed to exhaustion: the caller wants "is X enabled",
/// and a flag sitting on page two would otherwise read as absent.
#[tauri::command]
pub async fn list_features(bridge: State<'_, AppServerBridge>) -> Result<Vec<FeatureFlag>, String> {
    let bridge = bridge.inner();
    let mut cursor = None;
    let mut flags = Vec::new();

    loop {
        let response = bridge
            .request(ClientRequest::ExperimentalFeatureList {
                request_id: bridge.next_request_id(),
                params: ExperimentalFeatureListParams {
                    cursor: cursor.clone(),
                    limit: None,
                    thread_id: None,
                },
            })
            .await?;
        let response: ExperimentalFeatureListResponse = serde_json::from_value(response)
            .map_err(|err| format!("experimentalFeature/list: {err}"))?;

        flags.extend(response.data.into_iter().map(|feature| FeatureFlag {
            name: feature.name,
            enabled: feature.enabled,
            default_enabled: feature.default_enabled,
            stage: stage_name(&feature.stage).to_string(),
            display_name: feature.display_name,
            description: feature.description,
        }));

        let Some(next) = response.next_cursor else {
            return Ok(flags);
        };
        // A server repeating a cursor would otherwise spin forever.
        if cursor.as_ref() == Some(&next) {
            return Ok(flags);
        }
        cursor = Some(next);
    }
}

/// Enables or disables one feature flag, persisting to `config.toml`.
///
/// Deliberately **not** `experimentalFeature/enablement/set`. That RPC applies
/// "process-wide runtime" enablement which is lost on restart, it accepts only
/// a seven-key allowlist in `config_processor.rs`
/// (`SUPPORTED_EXPERIMENTAL_FEATURE_ENABLEMENT`) that contains no beta-stage
/// feature, and no in-tree client calls it. The TUI persists through
/// `config/batchWrite` instead (`config_persistence.rs::update_feature_flags`),
/// which is also what ADR-0020 requires of a behavior setting.
#[tauri::command]
pub async fn set_feature_enabled(
    bridge: State<'_, AppServerBridge>,
    name: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let edit = feature_enabled_edit(&name, enabled)?;
    crate::config_settings::write_config_edits(bridge.inner(), vec![edit]).await
}

/// Builds the config edit for a feature toggle, mirroring the TUI's
/// `config_update::build_feature_enabled_edit`.
///
/// The nuance worth preserving: turning *off* a feature that is already off by
/// default clears the key rather than writing `false`, so `config.toml` does
/// not accumulate entries that restate the default.
fn feature_enabled_edit(name: &str, enabled: bool) -> Result<ConfigEdit, String> {
    let feature = codex_features::feature_for_key(name)
        .ok_or_else(|| format!("unknown feature flag `{name}`"))?;
    let default_enabled = feature.default_enabled();
    let key_path = format!("features.{name}");
    let value = if enabled || default_enabled {
        serde_json::json!(enabled)
    } else {
        // `Replace` with null is how this codebase clears a key.
        serde_json::Value::Null
    };
    Ok(ConfigEdit {
        key_path,
        value,
        merge_strategy: MergeStrategy::Replace,
    })
}

/// Lowercases the stage for the frontend.
///
/// Mapped here rather than derived in TypeScript so the wire representation
/// stays a Rust concern, consistent with the rest of this crate.
fn stage_name(stage: &codex_app_server_protocol::ExperimentalFeatureStage) -> &'static str {
    use codex_app_server_protocol::ExperimentalFeatureStage as Stage;
    match stage {
        Stage::Beta => "beta",
        Stage::UnderDevelopment => "underDevelopment",
        Stage::Stable => "stable",
        Stage::Deprecated => "deprecated",
        Stage::Removed => "removed",
    }
}

#[cfg(test)]
#[path = "features_tests.rs"]
mod tests;
