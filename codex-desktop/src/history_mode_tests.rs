use super::*;
use pretty_assertions::assert_eq;

fn err(code: i64, message: &str) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code,
        message: message.to_string(),
        data: None,
    }
}

#[test]
fn matches_the_engines_own_pagination_rejection() {
    // The literal message from `thread_start_inner`'s guard.
    assert!(is_history_pagination_unsupported(&err(
        JSONRPC_INVALID_REQUEST,
        "paginated threads require thread/turns/list and thread/items/list support",
    )));
}

#[test]
fn matches_method_not_found_regardless_of_message() {
    assert!(is_history_pagination_unsupported(&err(
        JSONRPC_METHOD_NOT_FOUND,
        "whatever",
    )));
}

#[test]
fn ignores_unrelated_failures() {
    // Downgrading history on an unrelated error would silently create
    // legacy threads for the rest of the session.
    assert!(!is_history_pagination_unsupported(&err(
        JSONRPC_INVALID_REQUEST,
        "`permissions` cannot be combined with `sandbox`",
    )));
    assert!(!is_history_pagination_unsupported(&err(
        -32603,
        "history mode internal error",
    )));
}

#[test]
fn support_latches_off_once_marked() {
    let support = HistoryModeSupport::default();
    let cloned = support.clone();
    assert!(support.may_request_paginated());
    assert!(cloned.may_request_paginated());
    // The latch is shared — a separately-held clone observes the flip.
    support.mark_unsupported();
    assert_eq!(support.may_request_paginated(), false);
    assert_eq!(cloned.may_request_paginated(), false);
}
