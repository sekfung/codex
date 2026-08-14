//! Composer-side capability: structured turn input, skills, context usage,
//! compaction and review.
//!
//! Everything that touches the wire format is built here rather than in
//! TypeScript. `UserInput` is a `#[serde(tag = "type")]` union whose variants
//! carry differently-named fields, and `percent_of_context_window_remaining`
//! is engine arithmetic with an engine-owned `BASELINE_TOKENS` constant — both
//! are exactly the kind of thing ADR-0021 says a client must render rather
//! than re-derive. The frontend sends its own flat shapes; this module maps
//! them onto the protocol.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ReviewDelivery;
use codex_app_server_protocol::ReviewStartParams;
use codex_app_server_protocol::ReviewTarget;
use codex_app_server_protocol::SkillsListParams;
use codex_app_server_protocol::ThreadCompactStartParams;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::UserInput;
use codex_protocol::protocol::TokenUsage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::State;

use crate::bridge::AppServerBridge;

type CmdResult<T> = Result<T, String>;

/// An image the user attached in the composer.
///
/// Mirrors what the TUI's composer accepts (`bottom_pane/chat_composer/
/// attachment_state.rs`): local image paths and remote image URLs. The TUI
/// composer has no audio affordance, and `UserInput`'s audio variants exist
/// for other callers, so this deliberately does not offer them — matching the
/// engine's own notion of what is attachable rather than inventing a wider one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ComposerAttachment {
    /// A file chosen from disk.
    LocalImage { path: PathBuf },
    /// An image referenced by URL.
    RemoteImage { url: String },
}

/// A skill the user referenced with `$name` in the composer.
///
/// The engine wants both halves: `UserInput::Skill { name, path }`. The `$name`
/// token stays in the message text as well — that is the TUI's model
/// (`chatwidget/input_submission.rs` pushes the `Text` item *and* a `Skill`
/// item per mention), not a redundancy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSkill {
    pub name: String,
    pub path: PathBuf,
}

/// Assembles the turn payload in the same order the TUI does: images, then
/// text, then skills (`chatwidget/input_submission.rs`). Order is part of what
/// the model sees, so it is copied rather than chosen.
fn build_turn_input(
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
) -> Vec<UserInput> {
    let mut input = Vec::new();

    for attachment in attachments {
        match attachment {
            ComposerAttachment::RemoteImage { url } => {
                input.push(UserInput::Image { url, detail: None });
            }
            ComposerAttachment::LocalImage { path } => {
                input.push(UserInput::LocalImage { path, detail: None });
            }
        }
    }

    // An attachment-only message is legitimate; an empty `Text` item is not.
    if !text.is_empty() {
        input.push(UserInput::Text {
            text,
            text_elements: Vec::new(),
        });
    }

    for skill in skills {
        input.push(UserInput::Skill {
            name: skill.name,
            path: skill.path,
        });
    }

    input
}

#[tauri::command]
pub async fn send_turn(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::TurnStart {
            request_id: bridge.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: build_turn_input(text, attachments, skills),
                ..Default::default()
            },
        })
        .await
}

/// `skills/list`. `cwds` empty means "the session working directory"; the
/// frontend passes the open Projects so repo-local skills resolve.
#[tauri::command]
pub async fn list_skills(
    bridge: State<'_, AppServerBridge>,
    cwds: Vec<PathBuf>,
    force_reload: bool,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::SkillsList {
            request_id: bridge.next_request_id(),
            params: SkillsListParams { cwds, force_reload },
        })
        .await
}

/// `thread/compact/start` — the TUI's `/compact`.
#[tauri::command]
pub async fn compact_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadCompactStart {
            request_id: bridge.next_request_id(),
            params: ThreadCompactStartParams { thread_id },
        })
        .await
}

/// What the review should look at. Flattened from `ReviewTarget` so the
/// frontend sends one flat object; the tagged union is rebuilt here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewTargetInput {
    UncommittedChanges,
    BaseBranch { branch: String },
    Commit { sha: String, title: Option<String> },
    Custom { instructions: String },
}

impl From<ReviewTargetInput> for ReviewTarget {
    fn from(value: ReviewTargetInput) -> Self {
        match value {
            ReviewTargetInput::UncommittedChanges => ReviewTarget::UncommittedChanges,
            ReviewTargetInput::BaseBranch { branch } => ReviewTarget::BaseBranch { branch },
            ReviewTargetInput::Commit { sha, title } => ReviewTarget::Commit { sha, title },
            ReviewTargetInput::Custom { instructions } => ReviewTarget::Custom { instructions },
        }
    }
}

/// Where the review runs. The Official App exposes this as "代码审查发送方式"
/// (在此聊天中进行 / 独立), which maps onto the protocol's `ReviewDelivery` —
/// so it is a real user choice, not an implementation detail to hardcode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDeliveryInput {
    Inline,
    Detached,
}

impl From<ReviewDeliveryInput> for ReviewDelivery {
    fn from(value: ReviewDeliveryInput) -> Self {
        match value {
            ReviewDeliveryInput::Inline => ReviewDelivery::Inline,
            ReviewDeliveryInput::Detached => ReviewDelivery::Detached,
        }
    }
}

/// `review/start` — the CLI's `codex review`.
///
/// Returns the raw response because the caller needs `reviewThreadId`: for a
/// detached review that is a *different* thread, and leaving the user with no
/// way to reach it would be a dead end.
#[tauri::command]
pub async fn start_review(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    target: ReviewTargetInput,
    delivery: Option<ReviewDeliveryInput>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ReviewStart {
            request_id: bridge.next_request_id(),
            params: ReviewStartParams {
                thread_id,
                target: target.into(),
                delivery: delivery.map(Into::into),
            },
        })
        .await
}

/// What the composer shows for context pressure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// `None` when the model's context window is unknown, in which case the
    /// UI shows used tokens instead of a percentage — the same fallback the
    /// TUI makes (`chatwidget.rs::context_used_tokens`).
    pub percent_remaining: Option<i64>,
    pub used_tokens: i64,
}

/// Computes context pressure using the engine's own
/// `TokenUsage::percent_of_context_window_remaining`.
///
/// This is a Tauri command rather than TypeScript arithmetic on purpose: the
/// formula subtracts an engine-owned `BASELINE_TOKENS` (12,000 at the time of
/// writing) from both sides, and a copy of that constant in the frontend would
/// silently drift from the engine on the next upstream merge (ADR-0021).
///
/// Note it reads `last`, not `total` — matching `chatwidget.rs::
/// context_remaining_percent`. `last` is what currently occupies the window;
/// `total` is cumulative across the thread and would keep climbing past 100%.
#[tauri::command]
pub fn context_usage(
    last_total_tokens: i64,
    total_tokens_in_window: i64,
    model_context_window: Option<i64>,
) -> ContextUsage {
    let last = TokenUsage {
        total_tokens: last_total_tokens,
        ..Default::default()
    };
    ContextUsage {
        percent_remaining: model_context_window
            .map(|window| last.percent_of_context_window_remaining(window)),
        used_tokens: total_tokens_in_window,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn kinds(input: &[UserInput]) -> Vec<&'static str> {
        input
            .iter()
            .map(|item| match item {
                UserInput::Text { .. } => "text",
                UserInput::Image { .. } => "image",
                UserInput::LocalImage { .. } => "localImage",
                UserInput::Skill { .. } => "skill",
                _ => "other",
            })
            .collect()
    }

    /// Locks the TUI's ordering (`chatwidget/input_submission.rs`): images,
    /// then text, then skills.
    #[test]
    fn turn_input_matches_tui_ordering() {
        let input = build_turn_input(
            "look at $review".to_string(),
            vec![
                ComposerAttachment::RemoteImage {
                    url: "https://example.com/a.png".to_string(),
                },
                ComposerAttachment::LocalImage {
                    path: PathBuf::from("/tmp/b.png"),
                },
            ],
            vec![ComposerSkill {
                name: "review".to_string(),
                path: PathBuf::from("/skills/review"),
            }],
        );

        assert_eq!(kinds(&input), vec!["image", "localImage", "text", "skill"]);
    }

    /// An image with no caption is a real message; an empty `Text` item is not.
    #[test]
    fn attachment_only_message_omits_empty_text() {
        let input = build_turn_input(
            String::new(),
            vec![ComposerAttachment::LocalImage {
                path: PathBuf::from("/tmp/b.png"),
            }],
            Vec::new(),
        );

        assert_eq!(kinds(&input), vec!["localImage"]);
    }

    /// Below the baseline the engine reports 0%, not a negative or clamped
    /// percentage — verifying we are calling its function, not approximating.
    #[test]
    fn context_usage_defers_to_engine_formula() {
        let unknown_window = context_usage(5_000, 5_000, None);
        assert_eq!(unknown_window.percent_remaining, None);
        assert_eq!(unknown_window.used_tokens, 5_000);

        // Window at/below BASELINE_TOKENS is defined as 0% remaining.
        assert_eq!(context_usage(0, 0, Some(1_000)).percent_remaining, Some(0));

        // An empty window is fully available.
        assert_eq!(
            context_usage(0, 0, Some(112_000)).percent_remaining,
            Some(100)
        );
    }
}
