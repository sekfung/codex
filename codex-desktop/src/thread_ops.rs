//! Per-thread operations that outlive a single turn: the submission queue,
//! background terminals, and the thread goal.
//!
//! Like `composer.rs`, everything that touches a tagged union or a
//! double-`Option` is mapped here rather than in TypeScript. `UserInput` is
//! `#[serde(tag = "type")]`, and `ThreadGoalSetParams::token_budget` is an
//! `Option<Option<i64>>` behind `deserialize_double_option` — neither survives
//! being hand-written in a `.ts` interface, and `tsc` cannot tell you when it
//! got one wrong (ADR-0021).

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::QueuedSubmission;
use codex_app_server_protocol::ThreadBackgroundTerminal;
use codex_app_server_protocol::ThreadBackgroundTerminalsCleanParams;
use codex_app_server_protocol::ThreadBackgroundTerminalsListParams;
use codex_app_server_protocol::ThreadBackgroundTerminalsListResponse;
use codex_app_server_protocol::ThreadBackgroundTerminalsTerminateParams;
use codex_app_server_protocol::ThreadGoalClearParams;
use codex_app_server_protocol::ThreadGoalGetParams;
use codex_app_server_protocol::ThreadGoalSetParams;
use codex_app_server_protocol::ThreadGoalStatus;
use codex_app_server_protocol::ThreadQueueAddParams;
use codex_app_server_protocol::ThreadQueueDeleteParams;
use codex_app_server_protocol::ThreadQueueListParams;
use codex_app_server_protocol::ThreadQueueListResponse;
use codex_app_server_protocol::ThreadQueueReorderParams;
use codex_app_server_protocol::ThreadQueueStartParams;
use codex_app_server_protocol::ThreadQueueUpdateParams;
use codex_app_server_protocol::UserInput;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use tauri::State;
use uuid::Uuid;

use crate::bridge::AppServerBridge;
use crate::composer::ComposerAttachment;
use crate::composer::ComposerFileRef;
use crate::composer::ComposerMention;
use crate::composer::ComposerSkill;
use crate::composer::build_turn_input;

type CmdResult<T> = Result<T, String>;

// --- Queue -----------------------------------------------------------------
//
// Lifecycle, established from the engine rather than assumed
// (`ext/queue/src/service.rs`, `app-server/src/request_processors/
// thread_queue_processor.rs`):
//
// * `QueuedItemService` implements `ThreadLifecycleContributor::on_thread_idle`.
//   When a thread goes idle for any cause *except* `Interrupted`, it calls
//   `dispatch_if_idle`, which pops the head of the queue and starts a turn with
//   it. **The engine drains the queue by itself.**
// * `enqueue` additionally calls `wake_if_loaded`, which emits the idle
//   lifecycle when the thread is already idle — so adding to an idle thread
//   starts it immediately rather than parking it.
// * `thread/queue/start` refuses when the thread is busy
//   ("thread already has an active or pending turn").
//
// The consequence for this client is the whole reason the note exists: it must
// **never** call `queue/start` in response to a turn ending. The engine has
// already started the next item by then, so doing so would either error or, if
// it won the race, run a submission twice. `queue/start` is only correct after
// an *interrupt*, which is the one case the engine deliberately skips.

/// A queued submission, flattened for display.
///
/// `QueuedSubmission::input` is `Vec<UserInput>`; the frontend renders a
/// summary of it, so the union is collapsed here into the text the user typed
/// plus counts of whatever else rode along.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubmissionView {
    pub id: String,
    pub text: String,
    pub attachment_count: usize,
    pub skill_names: Vec<String>,
}

fn queued_submission_view(submission: QueuedSubmission) -> QueuedSubmissionView {
    let mut text = String::new();
    let mut attachment_count = 0;
    let mut skill_names = Vec::new();

    for item in submission.input {
        match item {
            UserInput::Text { text: value, .. } => {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&value);
            }
            UserInput::Image { .. } | UserInput::LocalImage { .. } => attachment_count += 1,
            UserInput::Skill { name, .. } => skill_names.push(name),
            _ => {}
        }
    }

    QueuedSubmissionView {
        id: submission.id,
        text,
        attachment_count,
        skill_names,
    }
}

/// `thread/queue/add`.
///
/// The engine auto-starts this immediately if the thread happens to be idle,
/// so the caller does not need to (and must not) follow up with `queue/start`.
#[tauri::command]
pub async fn queue_add(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
    file_refs: Vec<ComposerFileRef>,
    mentions: Vec<ComposerMention>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadQueueAdd {
            request_id: bridge.next_request_id(),
            params: ThreadQueueAddParams {
                thread_id,
                input: build_turn_input(text, attachments, skills, file_refs, mentions),
                // Required by the API. The engine would mint one itself if it
                // were absent, but the wire type is not optional.
                client_user_message_id: Uuid::now_v7().to_string(),
            },
        })
        .await
}

/// `thread/queue/list`. Paginated; this fetches the first page, which is the
/// standard thread-list page size and far beyond any realistic queue depth.
#[tauri::command]
pub async fn queue_list(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<Vec<QueuedSubmissionView>> {
    let response = bridge
        .request(ClientRequest::ThreadQueueList {
            request_id: bridge.next_request_id(),
            params: ThreadQueueListParams {
                thread_id,
                cursor: None,
                limit: None,
            },
        })
        .await?;

    let response: ThreadQueueListResponse =
        serde_json::from_value(response).map_err(|err| format!("thread/queue/list: {err}"))?;

    Ok(response
        .data
        .into_iter()
        .map(queued_submission_view)
        .collect())
}

/// `thread/queue/update` — replaces a queued submission's input wholesale.
#[tauri::command]
pub async fn queue_update(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    queued_submission_id: String,
    text: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadQueueUpdate {
            request_id: bridge.next_request_id(),
            params: ThreadQueueUpdateParams {
                thread_id,
                queued_submission_id,
                input: build_turn_input(text, Vec::new(), Vec::new(), Vec::new(), Vec::new()),
            },
        })
        .await
}

/// `thread/queue/delete`.
#[tauri::command]
pub async fn queue_delete(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    queued_submission_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadQueueDelete {
            request_id: bridge.next_request_id(),
            params: ThreadQueueDeleteParams {
                thread_id,
                queued_submission_id,
            },
        })
        .await
}

/// Computes the complete ordering that results from moving one id by `delta`.
///
/// `thread/queue/reorder` takes the whole ordering rather than a move, and
/// turning one into the other is the kind of index arithmetic that is quietly
/// wrong at the ends — hence a tested function rather than inline work at the
/// call site. Returns `None` when the move is a no-op (unknown id, or already
/// at the end it is being pushed toward), so the caller can skip the round
/// trip instead of sending the list back unchanged.
fn reorder_ids(ids: &[String], id: &str, delta: i32) -> Option<Vec<String>> {
    let from = ids.iter().position(|entry| entry == id)?;
    let to = usize::try_from(i64::from(delta) + from as i64).ok()?;
    if to >= ids.len() || to == from {
        return None;
    }
    let mut reordered = ids.to_vec();
    let moved = reordered.remove(from);
    reordered.insert(to, moved);
    Some(reordered)
}

/// `thread/queue/reorder`, expressed as a move.
///
/// The caller passes the ordering it currently shows plus the move; the
/// complete ordering the RPC wants is derived here.
#[tauri::command]
pub async fn queue_move(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    queued_submission_ids: Vec<String>,
    queued_submission_id: String,
    delta: i32,
) -> CmdResult<Option<JsonValue>> {
    let Some(reordered) = reorder_ids(&queued_submission_ids, &queued_submission_id, delta) else {
        return Ok(None);
    };
    bridge
        .request(ClientRequest::ThreadQueueReorder {
            request_id: bridge.next_request_id(),
            params: ThreadQueueReorderParams {
                thread_id,
                queued_submission_ids: reordered,
            },
        })
        .await
        .map(Some)
}

/// `thread/queue/start` — manual dispatch, for the one case the engine does
/// not handle itself.
///
/// See the lifecycle note above: this is **not** how queued work normally
/// starts. It exists because an *interrupted* turn suppresses the engine's
/// auto-dispatch, leaving the queue parked until someone asks for it.
#[tauri::command]
pub async fn queue_start(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    queued_submission_id: Option<String>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadQueueStart {
            request_id: bridge.next_request_id(),
            params: ThreadQueueStartParams {
                thread_id,
                queued_submission_id,
            },
        })
        .await
}

// --- Background terminals --------------------------------------------------

/// A background process the agent left running, flattened for display.
///
/// `cwd` is a `LegacyAppPathString` on the wire; it is stringified here so the
/// frontend never has to know that type exists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTerminalView {
    pub process_id: String,
    pub item_id: String,
    pub command: String,
    pub cwd: String,
    pub os_pid: Option<u32>,
    pub cpu_percent: Option<f64>,
    pub rss_kb: Option<u64>,
}

fn background_terminal_view(terminal: ThreadBackgroundTerminal) -> BackgroundTerminalView {
    BackgroundTerminalView {
        process_id: terminal.process_id,
        item_id: terminal.item_id,
        command: terminal.command,
        cwd: terminal.cwd.to_string(),
        os_pid: terminal.os_pid,
        cpu_percent: terminal.cpu_percent,
        rss_kb: terminal.rss_kb,
    }
}

/// `thread/backgroundTerminals/list`.
#[tauri::command]
pub async fn background_terminals_list(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<Vec<BackgroundTerminalView>> {
    let response = bridge
        .request(ClientRequest::ThreadBackgroundTerminalsList {
            request_id: bridge.next_request_id(),
            params: ThreadBackgroundTerminalsListParams {
                thread_id,
                cursor: None,
                limit: None,
            },
        })
        .await?;

    let response: ThreadBackgroundTerminalsListResponse = serde_json::from_value(response)
        .map_err(|err| format!("thread/backgroundTerminals/list: {err}"))?;

    Ok(response
        .data
        .into_iter()
        .map(background_terminal_view)
        .collect())
}

/// `thread/backgroundTerminals/terminate` — kills one process by id.
#[tauri::command]
pub async fn background_terminal_terminate(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    process_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadBackgroundTerminalsTerminate {
            request_id: bridge.next_request_id(),
            params: ThreadBackgroundTerminalsTerminateParams {
                thread_id,
                process_id,
            },
        })
        .await
}

/// `thread/backgroundTerminals/clean` — the TUI's own entry point for this
/// capability (`AppCommand::CleanBackgroundTerminals`).
#[tauri::command]
pub async fn background_terminals_clean(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadBackgroundTerminalsClean {
            request_id: bridge.next_request_id(),
            params: ThreadBackgroundTerminalsCleanParams { thread_id },
        })
        .await
}

// --- Goal ------------------------------------------------------------------

/// How a `thread/goal/set` call should treat the token budget.
///
/// `ThreadGoalSetParams::token_budget` is `Option<Option<i64>>` behind
/// `deserialize_double_option`, where the outer `None` means "leave alone" and
/// `Some(None)` means "clear". JSON cannot express that distinction with a
/// bare nullable number — `null` would be ambiguous — so the frontend names
/// the intent instead and this maps it.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TokenBudgetEdit {
    /// Leave whatever budget the goal already has.
    Unchanged,
    /// Remove the budget.
    Clear,
    /// Replace the budget.
    Set { tokens: i64 },
}

impl From<TokenBudgetEdit> for Option<Option<i64>> {
    fn from(value: TokenBudgetEdit) -> Self {
        match value {
            TokenBudgetEdit::Unchanged => None,
            TokenBudgetEdit::Clear => Some(None),
            TokenBudgetEdit::Set { tokens } => Some(Some(tokens)),
        }
    }
}

/// `thread/goal/get`. Returns the raw response: `goal` is `null` when the
/// thread has none, which the UI needs to distinguish from an empty objective.
#[tauri::command]
pub async fn goal_get(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadGoalGet {
            request_id: bridge.next_request_id(),
            params: ThreadGoalGetParams { thread_id },
        })
        .await
}

/// `thread/goal/set`. Every field is a patch — omitting one leaves it alone.
#[tauri::command]
pub async fn goal_set(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    objective: Option<String>,
    status: Option<ThreadGoalStatus>,
    token_budget: Option<TokenBudgetEdit>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadGoalSet {
            request_id: bridge.next_request_id(),
            params: ThreadGoalSetParams {
                thread_id,
                objective,
                status,
                token_budget: token_budget.map(Into::into).unwrap_or(None),
            },
        })
        .await
}

/// `thread/goal/clear`.
#[tauri::command]
pub async fn goal_clear(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadGoalClear {
            request_id: bridge.next_request_id(),
            params: ThreadGoalClearParams { thread_id },
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use std::path::PathBuf;

    /// The queue carries the same structured input a turn does, so its
    /// summary has to survive attachments and skills rather than assuming a
    /// queued submission is plain text.
    #[test]
    fn queued_submission_view_summarizes_structured_input() {
        let view = queued_submission_view(QueuedSubmission {
            id: "q1".to_string(),
            client_user_message_id: "c1".to_string(),
            input: build_turn_input(
                "run $review on this".to_string(),
                vec![ComposerAttachment::LocalImage {
                    path: PathBuf::from("/tmp/a.png"),
                }],
                vec![ComposerSkill {
                    name: "review".to_string(),
                    path: PathBuf::from("/skills/review"),
                }],
                Vec::new(),
                Vec::new(),
            ),
        });

        assert_eq!(
            view,
            QueuedSubmissionView {
                id: "q1".to_string(),
                text: "run $review on this".to_string(),
                attachment_count: 1,
                skill_names: vec!["review".to_string()],
            }
        );
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    /// Moving down has to account for the element having been removed first —
    /// the classic off-by-one in "reorder expressed as a move".
    #[test]
    fn reorder_ids_moves_within_bounds() {
        let queue = ids(&["a", "b", "c"]);
        assert_eq!(reorder_ids(&queue, "a", 1), Some(ids(&["b", "a", "c"])));
        assert_eq!(reorder_ids(&queue, "c", -1), Some(ids(&["a", "c", "b"])));
        assert_eq!(reorder_ids(&queue, "a", 2), Some(ids(&["b", "c", "a"])));
    }

    /// A move that cannot happen is `None` rather than an unchanged list, so
    /// the caller skips the RPC instead of asking the engine to reorder a
    /// queue into the order it is already in.
    #[test]
    fn reorder_ids_rejects_no_op_moves() {
        let queue = ids(&["a", "b", "c"]);
        assert_eq!(reorder_ids(&queue, "a", -1), None);
        assert_eq!(reorder_ids(&queue, "c", 1), None);
        assert_eq!(reorder_ids(&queue, "a", 0), None);
        assert_eq!(reorder_ids(&queue, "missing", 1), None);
    }

    /// The three-way budget edit has to survive the round trip into the
    /// protocol's double-`Option`, since "leave alone" and "clear" are
    /// different requests that JSON `null` alone cannot tell apart.
    #[test]
    fn token_budget_edit_maps_onto_double_option() {
        assert_eq!(
            Option::<Option<i64>>::from(TokenBudgetEdit::Unchanged),
            None
        );
        assert_eq!(
            Option::<Option<i64>>::from(TokenBudgetEdit::Clear),
            Some(None)
        );
        assert_eq!(
            Option::<Option<i64>>::from(TokenBudgetEdit::Set { tokens: 50_000 }),
            Some(Some(50_000))
        );
    }
}
