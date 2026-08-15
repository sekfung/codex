//! Decides, for every server-initiated request, who answers it.
//!
//! A `ServerRequest` is not a notification: the engine blocks until the
//! client responds. Anything this client neither answers nor forwards to a
//! responder is therefore a deadlock, not a dropped message — that is
//! exactly how `item/tool/requestUserInput` once hung every turn a tool
//! asked a question in.
//!
//! [`route`] is the single place that decision is made, and it is an
//! exhaustive match with no catch-all arm. That is deliberate: when upstream
//! adds a `ServerRequest` variant, this crate stops compiling until someone
//! decides what to do with it. A loud build break beats a silent hang.

use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::ServerRequest;
use serde_json::Value as JsonValue;
use serde_json::json;

/// JSON-RPC "method not found". The engine reads this as "this client cannot
/// service the request", which is true, rather than as a failure of whatever
/// the request was for.
const METHOD_NOT_FOUND: i64 = -32601;

/// Who answers a given server request.
///
/// The variants are mutually exclusive by construction, which is what makes
/// a double response impossible: a request is either emitted to the frontend
/// (and only the frontend answers it) or answered here (and the frontend
/// never learns it existed, so it has nothing to answer).
pub enum ServerRequestRouting {
    /// Emit to the webview; its store dispatches a card and the user's
    /// decision comes back through `resolve_server_request`.
    Frontend,
    /// Answer immediately in Rust with this result.
    AnswerHere(JsonValue),
    /// Answer immediately in Rust with a JSON-RPC error.
    Reject(JSONRPCErrorError),
}

fn reject(message: impl Into<String>) -> ServerRequestRouting {
    ServerRequestRouting::Reject(JSONRPCErrorError {
        code: METHOD_NOT_FOUND,
        message: message.into(),
        data: None,
    })
}

/// Routes one server request. See the module docs for why this match has no
/// catch-all arm.
pub fn route(request: &ServerRequest) -> ServerRequestRouting {
    match request {
        // Rendered as inline cards (ADR-0016); the user answers.
        ServerRequest::CommandExecutionRequestApproval { .. }
        | ServerRequest::FileChangeRequestApproval { .. }
        | ServerRequest::PermissionsRequestApproval { .. }
        | ServerRequest::ToolRequestUserInput { .. }
        | ServerRequest::McpServerElicitationRequest { .. } => ServerRequestRouting::Frontend,

        // "Read the current time from an external clock owned by the client."
        // This client's clock is the machine's clock, so answering is both
        // trivial and more correct than rejecting: rejecting would fail
        // whatever engine behavior depends on it for no reason at all.
        ServerRequest::CurrentTimeRead { .. } => {
            ServerRequestRouting::AnswerHere(json!({ "currentTimeAt": unix_seconds_now() }))
        }

        // The engine asks the client to *execute* a tool. A client opts into
        // that by declaring `ThreadStartParams.dynamic_tools`; this one never
        // does, so the engine has no dynamic tool registered against our
        // threads and this should be unreachable. If it does arrive, an error
        // is the honest answer — `DynamicToolCallResponse { success: false }`
        // would claim we ran the tool and it failed, which we did not, and
        // implementing a tool runtime here would invent capability the engine
        // never asked this client to have (ADR-0021).
        ServerRequest::DynamicToolCall { .. } => {
            reject("codex-desktop does not register dynamic tools")
        }

        // `initialize` sets `request_attestation: false`, so the engine has
        // been told not to ask. Rejecting rather than inventing an
        // attestation implementation (ADR-0021).
        ServerRequest::AttestationGenerate { .. } => {
            reject("codex-desktop does not provide upstream attestation")
        }

        // Already answered upstream: `app-server-client` auto-rejects this
        // for in-process clients before the event ever reaches this bridge.
        // Kept as an explicit arm so the exhaustive match still documents it;
        // if it somehow arrives, answering twice is harmless (the second
        // response for a settled id is dropped) whereas not answering is not.
        ServerRequest::ChatgptAuthTokensRefresh { .. } => {
            reject("chatgpt auth token refresh is not supported for in-process clients")
        }

        // Deprecated v1 approval requests, for turns started via the legacy
        // `sendUserTurn`/`sendUserMessage` APIs. This client only starts
        // turns via `turn/start`, so these cannot arrive for our threads.
        ServerRequest::ApplyPatchApproval { .. } | ServerRequest::ExecCommandApproval { .. } => {
            reject("codex-desktop uses turn/start; legacy approval requests are not supported")
        }
    }
}

/// The wire method name, for logging. `ServerRequest` is
/// `#[serde(tag = "method")]`, so the tag is the authoritative name; reading
/// it back beats maintaining a second variant-to-string mapping that could
/// drift. Mirrors what `ServerResponse::method()` does upstream.
pub fn method_name(request: &ServerRequest) -> String {
    serde_json::to_value(request)
        .ok()
        .and_then(|value| {
            value
                .get("method")
                .and_then(JsonValue::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "<unknown>".to_string())
}

fn unix_seconds_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        // Only reachable if the system clock predates 1970; 0 is a poor
        // answer but a far better one than hanging the turn.
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "server_requests_tests.rs"]
mod tests;
