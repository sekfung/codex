//! Memory settings and skill enablement.
//!
//! Both are settings-screen backing, and both have a subtlety that keeps them
//! out of TypeScript (ADR-0021):
//!
//! - `memories` is **not** a named field on `v2::Config`, so `config/read`
//!   returns it inside the `#[serde(flatten)] additional` map with its keys
//!   passed through verbatim. The payload therefore mixes camelCase
//!   (`approvalPolicy`) with snake_case (`memories.use_memories`) — the same
//!   trap `default_permissions` sprang in `config_settings.rs`.
//! - `skills/config/write` answers with `effectiveEnabled`, which is not
//!   necessarily the value that was requested: a higher config layer can pin a
//!   skill. The server's answer is authoritative, so it is returned rather
//!   than assumed.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ConfigEdit;
use codex_app_server_protocol::ConfigReadParams;
use codex_app_server_protocol::MergeStrategy;
use codex_app_server_protocol::SkillsConfigWriteParams;
use codex_app_server_protocol::ThreadMemoryMode;
use codex_app_server_protocol::ThreadMemoryModeSetParams;
use codex_utils_absolute_path::AbsolutePathBuf;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::State;

use crate::bridge::AppServerBridge;
use crate::cmd::CmdResult;

/// The two memory settings the TUI exposes, out of the many `MemoriesToml`
/// carries. Only these two have a user-facing control anywhere in this repo
/// (`tui/src/bottom_pane/memories_settings_view.rs`), so only these two are
/// rendered — the rest are tuning knobs with no UI to copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySettings {
    /// Read path: inject memories into new threads. The TUI's own description
    /// is "Applied at next thread" — it does not affect the running one.
    pub use_memories: bool,
    /// Write path: generate memories from threads. Applies to the current
    /// thread too, which is what `thread/memoryMode/set` exists for.
    pub generate_memories: bool,
}

impl Default for MemorySettings {
    /// Matches `MemoriesToml`'s own absent-means-on behaviour: an unset key is
    /// not the same as `false`, and showing a toggle off when the engine
    /// treats it as on would misreport the state.
    fn default() -> Self {
        Self {
            use_memories: true,
            generate_memories: true,
        }
    }
}

/// Reads the two memory settings out of `config/read`'s flattened `memories`
/// table.
///
/// Done here rather than in the frontend because of the serde asymmetry noted
/// in the module docs: the table arrives under the verbatim key `memories`
/// with snake_case children, unlike its camelCase siblings.
#[tauri::command]
pub async fn read_memory_settings(bridge: State<'_, AppServerBridge>) -> CmdResult<MemorySettings> {
    let response = bridge
        .request(ClientRequest::ConfigRead {
            request_id: bridge.next_request_id(),
            params: ConfigReadParams {
                include_layers: false,
                // No cwd: these are the user defaults, not a project-scoped
                // effective value — same choice `read_config` makes.
                cwd: None,
            },
        })
        .await?;
    Ok(memory_settings_from_config(&response))
}

fn memory_settings_from_config(response: &JsonValue) -> MemorySettings {
    let defaults = MemorySettings::default();
    let Some(memories) = response
        .get("config")
        .and_then(|config| config.get("memories"))
    else {
        return defaults;
    };
    let flag = |key: &str, fallback: bool| {
        memories
            .get(key)
            .and_then(JsonValue::as_bool)
            .unwrap_or(fallback)
    };
    MemorySettings {
        use_memories: flag("use_memories", defaults.use_memories),
        generate_memories: flag("generate_memories", defaults.generate_memories),
    }
}

/// Persists both memory settings, and pushes the write-path change onto the
/// running thread.
///
/// Two keys in one `config/batchWrite` because the TUI writes them together
/// (`config_update.rs::build_memory_settings_edits`); writing them separately
/// would leave a window where the pair disagrees.
///
/// The `thread/memoryMode/set` call afterwards mirrors
/// `config_persistence.rs::update_memory_settings_with_app_server`: the TUI
/// pushes the new mode to the current thread **only when `generate_memories`
/// actually changed**, because that setting takes effect on the current thread
/// while `use_memories` only applies to the next one. A thread id is optional
/// here for the same reason it is optional there — the settings screen can be
/// open with no thread selected, and the config write still stands on its own.
#[tauri::command]
pub async fn set_memory_settings(
    bridge: State<'_, AppServerBridge>,
    settings: MemorySettings,
    thread_id: Option<String>,
    generate_changed: bool,
) -> CmdResult<JsonValue> {
    let edits = vec![
        ConfigEdit {
            key_path: "memories.use_memories".to_string(),
            value: JsonValue::Bool(settings.use_memories),
            merge_strategy: MergeStrategy::Replace,
        },
        ConfigEdit {
            key_path: "memories.generate_memories".to_string(),
            value: JsonValue::Bool(settings.generate_memories),
            merge_strategy: MergeStrategy::Replace,
        },
    ];
    let written = crate::config_settings::write_config_edits(&bridge, edits).await?;

    if generate_changed && let Some(thread_id) = thread_id {
        let mode = if settings.generate_memories {
            ThreadMemoryMode::Enabled
        } else {
            ThreadMemoryMode::Disabled
        };
        // Deliberately not fatal: the settings are already persisted, and the
        // TUI treats this the same way — it reports "Saved memory settings,
        // but failed to update the current thread" rather than rolling back.
        if let Err(err) = bridge
            .request(ClientRequest::ThreadMemoryModeSet {
                request_id: bridge.next_request_id(),
                params: ThreadMemoryModeSetParams { thread_id, mode },
            })
            .await
        {
            tracing::warn!(%err, "memory settings saved but thread/memoryMode/set failed");
        }
    }

    Ok(written)
}

/// `memory/reset` — clears every stored memory for this `$CODEX_HOME`.
///
/// Irreversible, and wider than the name suggests: the handler clears the
/// memory rows in the state DB *and* deletes the contents of
/// `$CODEX_HOME/memories` and `$CODEX_HOME/memories_extensions`
/// (`memories/write/src/control.rs::clear_memory_roots_contents`). There is no
/// backup and no undo. Threads and rollouts are untouched.
///
/// Takes no parameters: `MemoryReset`'s params are `Option<()>` and its
/// serialization scope is `global("memory")`, so this is not per-thread or
/// per-project — it is the whole Codex home.
#[tauri::command]
pub async fn reset_memories(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::MemoryReset {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

/// `skills/config/write` — the only thing it can change is whether a skill is
/// enabled, selected by `path` or `name`.
///
/// The TUI selects by `path` (`config_update.rs::write_skill_enabled`), which
/// is unambiguous when two roots expose skills of the same name, so this does
/// too.
///
/// Returns the server's `effectiveEnabled` rather than the requested value: a
/// managed or project layer can pin a skill, in which case the request is
/// accepted but the effective state differs, and reporting the requested value
/// would show the user a toggle that lies.
#[tauri::command]
pub async fn set_skill_enabled(
    bridge: State<'_, AppServerBridge>,
    path: PathBuf,
    enabled: bool,
) -> CmdResult<bool> {
    let path = AbsolutePathBuf::from_absolute_path(path)
        .map_err(|err| format!("skill path must be absolute: {err}"))?;
    let response = bridge
        .request(ClientRequest::SkillsConfigWrite {
            request_id: bridge.next_request_id(),
            params: SkillsConfigWriteParams {
                path: Some(path),
                name: None,
                enabled,
            },
        })
        .await?;
    Ok(response
        .get("effectiveEnabled")
        .and_then(JsonValue::as_bool)
        .unwrap_or(enabled))
}

#[cfg(test)]
#[path = "memories_tests.rs"]
mod tests;
