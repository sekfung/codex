//! `#[tauri::command]` functions — the frontend/backend contract.
//!
//! Most request-shaped commands return the raw JSON-RPC result as-is rather
//! than a hand-mapped TypeScript-friendly shape: this increment is about
//! getting real data flowing end-to-end, not about a fully typed IPC
//! contract. Approval-decision payloads are similarly accepted as raw JSON
//! objects from the frontend and forwarded to `resolve_server_request`
//! verbatim — the frontend is responsible for shaping them to match
//! `CommandExecutionApprovalDecision`/`FileChangeApprovalDecision`/
//! `PermissionsRequestApprovalResponse`'s camelCase JSON shape (ADR-0015).

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::GetAccountParams;
use codex_app_server_protocol::ModelListParams;
use codex_app_server_protocol::ThreadArchiveParams;
use codex_app_server_protocol::ThreadDeleteParams;
use codex_app_server_protocol::ThreadForkParams;
use codex_app_server_protocol::ThreadListCwdFilter;
use codex_app_server_protocol::ThreadListParams;
use codex_app_server_protocol::ThreadResumeParams;
use codex_app_server_protocol::ThreadSearchParams;
use codex_app_server_protocol::ThreadSearchSortKey;
use codex_app_server_protocol::ThreadSetNameParams;
use codex_app_server_protocol::ThreadSettings;
use codex_app_server_protocol::ThreadSettingsUpdateParams;
// The wire enums, not the core ones of the same name: `ThreadStartParams`
// carries `codex_app_server_protocol`'s versions, and `codex_protocol` has
// parallel `ThreadHistoryMode`/`ThreadSource` types that do not coerce.
use codex_app_server_protocol::ThreadHistoryMode;
use codex_app_server_protocol::ThreadSource;
use codex_app_server_protocol::ThreadStartParams;
use codex_app_server_protocol::ThreadUnarchiveParams;
use codex_app_server_protocol::TurnInterruptParams;
use codex_protocol::config_types::Personality;
use codex_protocol::openai_models::ReasoningEffort;
use serde_json::Value as JsonValue;
use tauri::State;

use crate::approval_mode::ApprovalMode;
use crate::bridge::AppServerBridge;
use crate::bridge::RequestFailure;
use crate::cmd::CmdResult;
use crate::cmd::parse_request_id;
use crate::history_mode::HistoryModeSupport;
use crate::history_mode::is_history_pagination_unsupported;
use crate::projects::Project;
use crate::projects::ProjectStore;

// --- Projects (ADR-0012: app-local, not $CODEX_HOME) -----------------------

#[tauri::command]
pub async fn list_projects(store: State<'_, ProjectStore>) -> CmdResult<Vec<Project>> {
    Ok(store.list().await)
}

#[tauri::command]
pub async fn add_project(store: State<'_, ProjectStore>, path: String) -> CmdResult<Project> {
    store.add(path).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn remove_project(store: State<'_, ProjectStore>, id: String) -> CmdResult<()> {
    store.remove(&id).await.map_err(|err| err.to_string())
}

// Folder picking is no longer a custom command — the frontend calls
// `@tauri-apps/plugin-dialog`'s `open()` directly, gated by the
// `dialog:default` capability (`capabilities/default.json`). That's the
// plugin's own IPC path, not a hand-rolled oneshot-channel wrapper around
// its Rust API; the plugin itself is still registered in `main.rs` since the
// JS-side call needs it there.

// --- Threads -----------------------------------------------------------

/// Lists threads whose `cwd` exactly matches `project_path` (ADR-0012's
/// "Project" is a client-side grouping over `thread/list`, not a protocol
/// concept — see CONTEXT.md). Leaves `sourceKinds` unset so sub-agent
/// threads stay excluded by the protocol's documented default (ADR-0017).
///
/// `archived` follows the protocol's documented tri-state: `true` returns
/// *only* archived threads, `false`/`null` returns only non-archived ones.
/// There is no "both" — so the sidebar's archived view is a separate list
/// call rather than a client-side filter over one.
#[tauri::command]
pub async fn list_threads(
    bridge: State<'_, AppServerBridge>,
    project_path: String,
    archived: Option<bool>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadList {
            request_id: bridge.next_request_id(),
            // `ThreadListParams` has no `Default` impl (every field is
            // individually optional, but the struct itself isn't) — spell
            // out every field rather than pull in a throwaway builder.
            params: ThreadListParams {
                cursor: None,
                limit: None,
                sort_key: None,
                sort_direction: None,
                model_providers: None,
                // Left unset deliberately: defaults to "interactive
                // sources," which already excludes sub-agent threads from
                // this Project-grouped view (ADR-0017) with no filtering.
                source_kinds: None,
                archived,
                section_id: None,
                cwd: Some(ThreadListCwdFilter::One(project_path)),
                use_state_db_only: false,
                search_term: None,
                parent_thread_id: None,
                ancestor_thread_id: None,
            },
        })
        .await
}

/// Renames a thread. The server broadcasts `thread/name/updated` afterwards,
/// which is what actually refreshes the sidebar — so a rename made anywhere
/// else (CLI, another surface) lands here too.
#[tauri::command]
pub async fn set_thread_name(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    name: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadSetName {
            request_id: bridge.next_request_id(),
            params: ThreadSetNameParams { thread_id, name },
        })
        .await
}

#[tauri::command]
pub async fn archive_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadArchive {
            request_id: bridge.next_request_id(),
            params: ThreadArchiveParams { thread_id },
        })
        .await
}

#[tauri::command]
pub async fn unarchive_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadUnarchive {
            request_id: bridge.next_request_id(),
            params: ThreadUnarchiveParams { thread_id },
        })
        .await
}

/// Deletes a thread permanently. The frontend confirms before calling this —
/// there is no protocol-level undo.
#[tauri::command]
pub async fn delete_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadDelete {
            request_id: bridge.next_request_id(),
            params: ThreadDeleteParams { thread_id },
        })
        .await
}

/// Full-text thread search across every Project, not just the active one —
/// `ThreadSearchParams` has no `cwd` filter, so scoping it to one Project
/// isn't something the protocol offers here.
///
/// Marked `#[experimental("thread/search")]` in the protocol, which is fine:
/// `main.rs` already initializes with `experimental_api: true` (ADR-0017
/// relies on the same flag for the sub-agent thread filters).
#[tauri::command]
pub async fn search_threads(
    bridge: State<'_, AppServerBridge>,
    search_term: String,
    limit: Option<u32>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadSearch {
            request_id: bridge.next_request_id(),
            params: ThreadSearchParams {
                cursor: None,
                limit,
                // Recency beats creation order for a "find that conversation"
                // box; the protocol's own default is created_at.
                sort_key: Some(ThreadSearchSortKey::RecencyAt),
                sort_direction: None,
                source_kinds: None,
                // Non-archived only, matching the sidebar's default view.
                archived: None,
                search_term,
            },
        })
        .await
}

/// Issues `thread/start` asking for paginated history, falling back once if the
/// server refuses.
///
/// Mirrors `tui/src/app_server_session.rs::request_thread_start_with_history_fallback`.
/// The retry is what keeps the ask safe: `Paginated` is rejected outright when
/// the thread store cannot serve paginated lists, and without a fallback that
/// rejection would surface as "could not start a conversation" rather than as a
/// thread with slightly fewer capabilities.
async fn start_thread_negotiating_history(
    bridge: &AppServerBridge,
    history_support: &HistoryModeSupport,
    mut params: ThreadStartParams,
) -> CmdResult<JsonValue> {
    if !history_support.may_request_paginated() {
        // Already refused once this session; don't pay the round trip again.
        return bridge
            .request(ClientRequest::ThreadStart {
                request_id: bridge.next_request_id(),
                params,
            })
            .await;
    }

    params.history_mode = Some(ThreadHistoryMode::Paginated);
    match bridge
        .request_detailed(ClientRequest::ThreadStart {
            request_id: bridge.next_request_id(),
            params: params.clone(),
        })
        .await
    {
        Ok(started) => Ok(started),
        Err(RequestFailure::Server(source)) if is_history_pagination_unsupported(&source) => {
            history_support.mark_unsupported();
            params.history_mode = None;
            bridge
                .request(ClientRequest::ThreadStart {
                    request_id: bridge.next_request_id(),
                    params,
                })
                .await
        }
        Err(failure) => Err(failure.message()),
    }
}

/// Starts a thread, applying the composer's current approval mode (ADR-0016
/// layer 1) and model selection at creation so the very first turn already
/// runs under them.
///
/// `ThreadStartParams` carries `model` but has **no** effort field (the
/// `reasoningEffort` next to it in `thread.rs` belongs to `ThreadStartResponse`,
/// which only reports the effort in force). So when an effort is requested it
/// is applied with a follow-up `thread/settings/update` here, keeping this a
/// single call from the frontend's point of view.
///
/// Most of `ThreadStartParams`' 25 fields are deliberately left unset. The
/// server turns them into *overrides* on top of its own config
/// (`build_thread_config_overrides` in `thread_processor.rs`), and this client's
/// embedded app-server was started from the same `config.toml` the CLI reads
/// (ADR-0008) — so omitting `model_provider`, `service_tier`, `sandbox`,
/// `runtime_workspace_roots`, `config`, `personality` and friends yields the
/// user's configured values, while re-deriving them here would duplicate
/// config interpretation this crate is not allowed to own (ADR-0021).
/// Per-thread deltas go through `thread/settings/update` instead.
///
/// The exceptions are the two fields that are *not* config-derived overrides:
/// `history_mode` (see `crate::history_mode`) and `thread_source`, both of
/// which the TUI and `exec` set explicitly.
/// Builds the params for `thread/start`.
///
/// Split out so the field set is pinned by tests: an absent param is silently
/// valid on the wire, so a field lost in a refactor produces threads that
/// quietly differ from the CLI's rather than any visible failure.
fn thread_start_params(
    cwd: String,
    resolved: Option<crate::approval_mode::ResolvedApprovalMode>,
    model: Option<String>,
) -> ThreadStartParams {
    ThreadStartParams {
        cwd: Some(cwd),
        model,
        approval_policy: resolved.as_ref().map(|mode| mode.approval_policy),
        approvals_reviewer: resolved.as_ref().map(|mode| mode.approvals_reviewer),
        permissions: resolved.map(|mode| mode.permission_profile_id),
        // Classifies *why* the thread exists, which is not the same axis as
        // `SessionSource::Custom("codex-desktop")` (ADR-0010, which client).
        // Every thread this client starts is user-initiated, and both the TUI
        // and `exec` set `User`; the field has no `Default` impl of its own.
        thread_source: Some(ThreadSource::User),
        ..Default::default()
    }
}

#[tauri::command]
pub async fn start_thread(
    bridge: State<'_, AppServerBridge>,
    history_support: State<'_, HistoryModeSupport>,
    cwd: String,
    approval_mode: Option<ApprovalMode>,
    model: Option<String>,
    effort: Option<ReasoningEffort>,
) -> CmdResult<JsonValue> {
    let resolved = approval_mode.map(ApprovalMode::resolve).transpose()?;
    let params = thread_start_params(cwd, resolved, model);
    let started = start_thread_negotiating_history(&bridge, &history_support, params).await?;

    if let Some(effort) = effort
        && let Some(thread_id) = started
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(JsonValue::as_str)
    {
        // Best-effort: a thread that started successfully is still usable at
        // the server's default effort, so surface the failure rather than
        // discarding the thread the caller is about to switch to.
        bridge
            .request(ClientRequest::ThreadSettingsUpdate {
                request_id: bridge.next_request_id(),
                params: ThreadSettingsUpdateParams {
                    thread_id: thread_id.to_string(),
                    effort: Some(effort),
                    ..Default::default()
                },
            })
            .await?;
    }

    Ok(started)
}

/// Lists the models offered by the composer's model picker.
///
/// `includeHidden` stays `false`: the protocol documents hidden models as
/// "hidden from the default picker list", which is exactly this picker.
#[tauri::command]
pub async fn list_models(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ModelList {
            request_id: bridge.next_request_id(),
            params: ModelListParams {
                cursor: None,
                limit: None,
                include_hidden: Some(false),
            },
        })
        .await
}

/// Applies a model and/or reasoning effort to an already-running thread.
///
/// Mirrors `set_approval_mode`: the composer's picker (ADR-0016 layer 1's
/// pattern) applies to the active thread immediately, and `start_thread`
/// carries the same selection onto newly created threads.
#[tauri::command]
pub async fn set_model(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    model: Option<String>,
    effort: Option<ReasoningEffort>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadSettingsUpdate {
            request_id: bridge.next_request_id(),
            params: ThreadSettingsUpdateParams {
                thread_id,
                model,
                effort,
                ..Default::default()
            },
        })
        .await
}

/// Applies a personality to an already-running thread — the TUI's
/// `/personality`, "choose a communication style for Codex".
///
/// Same shape as `set_model`: a per-thread override through
/// `thread/settings/update`, whose own doc calls this field an "override for
/// subsequent turns". It is deliberately not set in `thread_start_params`,
/// where personality is one of the config-derived overrides the server fills
/// from the user's own `config.toml`.
///
/// The picker offering this is gated twice, matching the TUI: on the
/// `personality` feature flag (`crate::features`) and on the active model's
/// `supportsPersonality`, since a model that ignores the setting would make
/// the control a no-op.
#[tauri::command]
pub async fn set_personality(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    personality: Personality,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadSettingsUpdate {
            request_id: bridge.next_request_id(),
            params: ThreadSettingsUpdateParams {
                thread_id,
                personality: Some(personality),
                ..Default::default()
            },
        })
        .await
}

/// Applies an approval mode to an already-running thread (ADR-0016 layer 1).
///
/// `permissions` and `sandboxPolicy` are mutually exclusive in
/// `ThreadSettingsUpdateParams`; this always uses the named-profile form, so
/// `sandbox_policy` stays `None`.
#[tauri::command]
pub async fn set_approval_mode(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    approval_mode: ApprovalMode,
) -> CmdResult<JsonValue> {
    let resolved = approval_mode.resolve()?;
    bridge
        .request(ClientRequest::ThreadSettingsUpdate {
            request_id: bridge.next_request_id(),
            params: ThreadSettingsUpdateParams {
                thread_id,
                approval_policy: Some(resolved.approval_policy),
                approvals_reviewer: Some(resolved.approvals_reviewer),
                permissions: Some(resolved.permission_profile_id),
                sandbox_policy: None,
                ..Default::default()
            },
        })
        .await
}

#[tauri::command]
pub async fn resume_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadResume {
            request_id: bridge.next_request_id(),
            params: ThreadResumeParams {
                thread_id,
                ..Default::default()
            },
        })
        .await
}

/// Backs the agent-message "fork" action (ADR-0018).
#[tauri::command]
pub async fn fork_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    last_turn_id: Option<String>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadFork {
            request_id: bridge.next_request_id(),
            params: ThreadForkParams {
                thread_id,
                last_turn_id,
                ..Default::default()
            },
        })
        .await
}

// --- Account (read-only) ---------------------------------------------------
//
// Identity, plan and consumption are surfaced for information only: there is
// deliberately no billing, upgrade or top-up path anywhere in this app, so
// these are reads with no corresponding writes.

/// Reads the signed-in account. `refreshToken: false` — this is a passive
/// read for the sidebar footer, not a login flow, and a proactive token
/// refresh on every startup would be a surprising side effect of showing a
/// name. `account/updated` keeps it current afterwards.
#[tauri::command]
pub async fn read_account(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::GetAccount {
            request_id: bridge.next_request_id(),
            params: GetAccountParams {
                refresh_token: false,
            },
        })
        .await
}

/// Reads the rate-limit snapshot behind the usage indicator.
///
/// Exhaustion is taken from the backend's own `rateLimitReachedType` /
/// `spendControlReached` fields rather than from a percentage threshold
/// invented here — the app reports what the server says, or says nothing.
#[tauri::command]
pub async fn read_account_rate_limits(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::GetAccountRateLimits {
            request_id: bridge.next_request_id(),
            params: None,
        })
        .await
}

// --- Turns ---------------------------------------------------------------

#[tauri::command]
pub async fn interrupt_turn(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    turn_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::TurnInterrupt {
            request_id: bridge.next_request_id(),
            params: TurnInterruptParams { thread_id, turn_id },
        })
        .await
}

// --- Approvals (ADR-0015: full decision richness, ADR-0016: two-layer UX) -

/// Resolves `item/commandExecution/requestApproval`. `decision` must
/// deserialize as `CommandExecutionApprovalDecision`'s camelCase JSON shape,
/// e.g. `{"type": "accept"}`, `{"type": "acceptForSession"}`,
/// `{"type": "acceptWithExecpolicyAmendment", "execpolicyAmendment": {...}}`,
/// `{"type": "applyNetworkPolicyAmendment", "networkPolicyAmendment": {...}}`,
/// `{"type": "decline"}`, `{"type": "cancel"}`.
#[tauri::command]
pub async fn resolve_command_execution_approval(
    bridge: State<'_, AppServerBridge>,
    request_id: JsonValue,
    decision: JsonValue,
) -> CmdResult<()> {
    let request_id = parse_request_id(request_id)?;
    bridge
        .resolve_server_request(request_id, serde_json::json!({ "decision": decision }))
        .await
}

/// Resolves `item/fileChange/requestApproval`. `decision` shape:
/// `{"type": "accept" | "acceptForSession" | "decline" | "cancel"}`.
#[tauri::command]
pub async fn resolve_file_change_approval(
    bridge: State<'_, AppServerBridge>,
    request_id: JsonValue,
    decision: JsonValue,
) -> CmdResult<()> {
    let request_id = parse_request_id(request_id)?;
    bridge
        .resolve_server_request(request_id, serde_json::json!({ "decision": decision }))
        .await
}

/// Resolves `item/permissions/requestApproval`. `response` must match
/// `PermissionsRequestApprovalResponse`'s JSON shape: `{"permissions": {...
/// GrantedPermissionProfile ...}, "scope": "turn" | "session",
/// "strictAutoReview"?: bool}`. This backs the composer's persistent
/// approval-mode selector (ADR-0016) once its 3 presets are mapped to
/// concrete permission profiles — that mapping is frontend-side and not
/// designed yet, so for now the frontend must build this object itself.
#[tauri::command]
pub async fn resolve_permissions_approval(
    bridge: State<'_, AppServerBridge>,
    request_id: JsonValue,
    response: JsonValue,
) -> CmdResult<()> {
    let request_id = parse_request_id(request_id)?;
    bridge.resolve_server_request(request_id, response).await
}

#[tauri::command]
pub async fn reject_approval(
    bridge: State<'_, AppServerBridge>,
    request_id: JsonValue,
    message: String,
) -> CmdResult<()> {
    let request_id = parse_request_id(request_id)?;
    bridge.reject_server_request(request_id, message).await
}

/// The composer indicators derived from a `thread/settings/updated` payload.
///
/// `approvalMode` is `None` when the thread's settings aren't one of the three
/// presets — the same honest outcome `from_config_parts` gives for a
/// hand-edited config, rather than snapping the indicator to a mode the user
/// never chose.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSettingsIndicators {
    approval_mode: Option<ApprovalMode>,
    model: String,
    effort: Option<String>,
}

/// Maps a `thread/settings/updated` payload onto the composer's indicators.
///
/// Done in Rust so the approval-mode inverse stays in `approval_mode.rs`
/// alongside its forward direction, and so TypeScript never parses
/// `AskForApproval` — which has a `Granular { … }` variant that a hand-written
/// interface would silently mishandle.
#[tauri::command]
pub async fn thread_settings_indicators(
    settings: JsonValue,
) -> CmdResult<ThreadSettingsIndicators> {
    let settings: ThreadSettings = serde_json::from_value(settings)
        .map_err(|err| format!("thread/settings/updated payload: {err}"))?;
    Ok(indicators_from_settings(settings))
}

fn indicators_from_settings(settings: ThreadSettings) -> ThreadSettingsIndicators {
    ThreadSettingsIndicators {
        approval_mode: ApprovalMode::from_config_parts(
            Some(&settings.approval_policy),
            Some(settings.approvals_reviewer),
            settings
                .active_permission_profile
                .as_ref()
                .map(|profile| profile.id.as_str()),
        ),
        model: settings.model,
        effort: settings.effort.map(|effort| effort.to_string()),
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
