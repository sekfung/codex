//! Shared vocabulary for the `#[tauri::command]` layer.
//!
//! Tauri serialises a command's `Err` straight to the webview, so every command
//! in this crate reports failure as a string. That alias and the one helper
//! that parses a `RequestId` back off the wire lived in six and three copies
//! respectively before this module existed.

use codex_app_server_protocol::RequestId;
use serde_json::Value as JsonValue;

/// The result type every `#[tauri::command]` in this crate returns.
///
/// The error is a `String` because that is what reaches the frontend intact;
/// richer error types would be flattened by Tauri's serialisation anyway.
pub type CmdResult<T> = Result<T, String>;

/// Parses a `RequestId` the frontend echoed back when answering a server
/// request.
///
/// The frontend receives request ids as opaque JSON and returns them
/// unchanged, so this is the one place that has to trust and re-type them.
pub fn parse_request_id(value: JsonValue) -> CmdResult<RequestId> {
    serde_json::from_value(value).map_err(|err| format!("invalid requestId: {err}"))
}
