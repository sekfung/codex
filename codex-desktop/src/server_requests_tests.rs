#![allow(clippy::expect_used)]

use super::*;
use codex_app_server_protocol::DynamicToolCallParams;
use codex_app_server_protocol::RequestId;

fn dynamic_tool_call() -> ServerRequest {
    ServerRequest::DynamicToolCall {
        request_id: RequestId::Integer(7),
        params: DynamicToolCallParams {
            thread_id: "thread".to_string(),
            turn_id: "turn".to_string(),
            call_id: "call".to_string(),
            namespace: None,
            tool: "whatever".to_string(),
            arguments: json!({}),
        },
    }
}

/// The point of this module: a request this client cannot service is
/// still *answered*. Silence is the bug.
#[test]
fn unserviceable_request_is_answered_not_ignored() {
    match route(&dynamic_tool_call()) {
        ServerRequestRouting::Reject(err) => {
            assert_eq!(err.code, METHOD_NOT_FOUND);
            assert!(
                err.message.contains("dynamic tools"),
                "error should say why: {}",
                err.message
            );
        }
        ServerRequestRouting::Frontend => {
            panic!("nothing in the frontend answers item/tool/call, so this would hang")
        }
        ServerRequestRouting::AnswerHere(_) => {
            panic!("a fabricated success would claim we ran a tool we did not run")
        }
    }
}

#[test]
fn current_time_is_answered_here() {
    use codex_app_server_protocol::CurrentTimeReadParams;

    let request = ServerRequest::CurrentTimeRead {
        request_id: RequestId::Integer(1),
        params: CurrentTimeReadParams {
            thread_id: "thread".to_string(),
        },
    };
    let ServerRequestRouting::AnswerHere(result) = route(&request) else {
        panic!("currentTime/read is trivially answerable and must not be rejected");
    };
    let seconds = result
        .get("currentTimeAt")
        .and_then(JsonValue::as_i64)
        .expect("response must carry currentTimeAt as a number");
    // Sanity: after 2020, i.e. a real clock reading rather than the
    // `unwrap_or(0)` fallback.
    assert!(
        seconds > 1_577_836_800,
        "unexpected clock reading {seconds}"
    );
}
