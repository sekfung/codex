//! Answering `item/tool/requestUserInput`.
//!
//! This is a *server request*, not a notification: a tool asks the user
//! something and the turn blocks until an answer comes back. A client that
//! ignores it leaves the turn hanging with nothing on screen.
//!
//! The response envelope is built here rather than in TypeScript because its
//! shape carries two conventions that are easy to get silently wrong
//! (ADR-0021):
//!
//! 1. A chosen option is answered with the option's **label**, verbatim — not
//!    its index, and not the description.
//! 2. Free text is answered with a `"user_note: "` prefix. That is not
//!    decoration: `tui/src/history_cell/request_user_input.rs` recovers notes
//!    with `strip_prefix("user_note: ")`, so an unprefixed answer would be
//!    read back as if it were a chosen label.
//!
//! Both are reproduced from the engine's own writers — the reference client
//! (`app-server-test-client/src/request_user_input.rs`) and the TUI
//! (`tui/src/bottom_pane/request_user_input/mod.rs::submit_answers`).

use std::collections::HashMap;

use codex_app_server_protocol::ToolRequestUserInputAnswer;
use codex_app_server_protocol::ToolRequestUserInputResponse;
use serde::Deserialize;
use serde::Serialize;
use tauri::State;

use crate::bridge::AppServerBridge;

/// The prefix the engine uses to distinguish free text from a chosen label.
const USER_NOTE_PREFIX: &str = "user_note: ";

/// One question's answer as the UI collects it, before it is encoded into the
/// protocol's shape.
///
/// A selected label and a note are not exclusive — the TUI appends the note
/// after the label when the user both picks an option and types something, so
/// this mirrors that rather than forcing a choice.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputAnswerDraft {
    pub question_id: String,
    /// The chosen option's `label`, if the user picked one.
    #[serde(default)]
    pub selected_label: Option<String>,
    /// Free text, if the user typed any. Encoded with the `user_note:` prefix.
    #[serde(default)]
    pub note: Option<String>,
}

impl UserInputAnswerDraft {
    /// Encodes to the answer list the engine expects: an optional label
    /// followed by an optional prefixed note.
    ///
    /// An empty list is meaningful and is *not* an error — it is how the TUI
    /// submits a question the user chose not to answer. The protocol has no
    /// separate "decline" verb, so declining is expressed this way.
    fn encode(&self) -> ToolRequestUserInputAnswer {
        let mut answers = Vec::new();
        if let Some(label) = self
            .selected_label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
        {
            answers.push(label.to_string());
        }
        if let Some(note) = self
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
        {
            answers.push(format!("{USER_NOTE_PREFIX}{note}"));
        }
        ToolRequestUserInputAnswer { answers }
    }
}

fn build_response(drafts: Vec<UserInputAnswerDraft>) -> ToolRequestUserInputResponse {
    let answers = drafts
        .into_iter()
        .map(|draft| (draft.question_id.clone(), draft.encode()))
        .collect::<HashMap<_, _>>();
    ToolRequestUserInputResponse { answers }
}

/// Answers a pending `item/tool/requestUserInput`.
///
/// `request_id` is echoed back verbatim from the event envelope, the same way
/// the approval commands take it.
#[tauri::command]
pub async fn resolve_user_input_request(
    bridge: State<'_, AppServerBridge>,
    request_id: serde_json::Value,
    answers: Vec<UserInputAnswerDraft>,
) -> Result<(), String> {
    let request_id = crate::cmd::parse_request_id(request_id)?;
    let response = serde_json::to_value(build_response(answers))
        .map_err(|err| format!("failed to encode user-input answers: {err}"))?;
    bridge.resolve_server_request(request_id, response).await
}

#[cfg(test)]
#[path = "user_input_tests.rs"]
mod tests;
