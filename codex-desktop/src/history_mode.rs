//! Paginated-history negotiation for `thread/start`.
//!
//! Threads carry a persisted history contract chosen at creation
//! (`ThreadHistoryMode`), and `ThreadHistoryMode::default()` is `Legacy`. A
//! client that omits `history_mode` therefore creates legacy threads — and the
//! engine rejects `thread/revert` outright for those:
//!
//! ```text
//! thread/revert only supports paginated threads
//! ```
//!
//! (`app-server/src/request_processors/thread_processor.rs`, the guard on
//! `config_snapshot.history_mode`). Legacy threads also take different paths
//! for resume history and thread naming. So asking for `Paginated` is not a
//! nicety: it is what makes threads this client creates equal to the ones the
//! CLI creates in the same `$CODEX_HOME` (ADR-0008).
//!
//! Asking is not enough on its own, because the server refuses `Paginated`
//! when its thread store cannot serve paginated lists
//! (`supports_paginated_history_lists()`, which is `state_db.is_some()` for the
//! local store). The TUI handles that by negotiating: try `Paginated`, and on a
//! pagination-specific rejection retry without it and remember the answer for
//! the rest of the session
//! (`tui/src/app_server_session.rs::request_thread_start_with_history_fallback`).
//! This mirrors that, including the error matcher, rather than assuming the
//! embedded server always supports pagination.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use codex_app_server_protocol::JSONRPCErrorError;

/// JSON-RPC codes the matcher accepts, mirroring the TUI's constants.
const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
const JSONRPC_INVALID_REQUEST: i64 = -32600;
const JSONRPC_INVALID_PARAMS: i64 = -32602;

/// Whether this session may still ask for paginated history.
///
/// Starts optimistic and latches to `false` the first time the server refuses,
/// so the fallback costs one extra round trip per session rather than one per
/// thread.
#[derive(Clone)]
pub struct HistoryModeSupport {
    paginated: Arc<AtomicBool>,
}

impl Default for HistoryModeSupport {
    fn default() -> Self {
        Self {
            paginated: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl HistoryModeSupport {
    pub fn may_request_paginated(&self) -> bool {
        self.paginated.load(Ordering::Relaxed)
    }

    pub fn mark_unsupported(&self) {
        self.paginated.store(false, Ordering::Relaxed);
    }
}

/// Ported from `tui/src/app_server_session.rs::is_history_pagination_unsupported`.
///
/// Kept faithful to the original rather than simplified: the server can refuse
/// pagination through several codes and phrasings, and a matcher that is too
/// narrow would surface a confusing hard error where the TUI silently falls
/// back, while one that is too broad would swallow unrelated failures and
/// silently downgrade threads.
pub fn is_history_pagination_unsupported(source: &JSONRPCErrorError) -> bool {
    if source.code == JSONRPC_METHOD_NOT_FOUND {
        return true;
    }

    if !matches!(
        source.code,
        JSONRPC_INVALID_REQUEST | JSONRPC_INVALID_PARAMS
    ) {
        return false;
    }

    let message = source.message.to_ascii_lowercase();
    let mentions_history_surface = [
        "historymode",
        "history mode",
        "excludeturns",
        "exclude turns",
        "thread/turns/list",
        "thread/items/list",
    ]
    .into_iter()
    .any(|field| message.contains(field));

    mentions_history_surface
        || (message.contains("paginated")
            && ["unknown variant", "unsupported variant", "invalid enum"]
                .into_iter()
                .any(|error| message.contains(error)))
}

#[cfg(test)]
#[path = "history_mode_tests.rs"]
mod tests;
