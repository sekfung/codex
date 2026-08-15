//! Identity lookup for sub-agent threads.
//!
//! `CollabAgentToolCall` and `SubAgentActivity` carry thread *ids* but no
//! labels, so a stream that only rendered the item would show raw UUIDs. The
//! names live on the thread itself — `Thread.agent_nickname` and
//! `Thread.agent_role` (`v2/thread_data.rs`) — which is what the TUI reads for
//! the same purpose, through the `agent_metadata: FnMut(ThreadId)` callback
//! that `multi_agents.rs::tool_call_history_cell` takes.
//!
//! The response is flattened here rather than handed to TypeScript whole: a
//! `Thread` carries a `turns` array, a `SessionSource` tagged union and a
//! `ThreadHistoryMode` whose identically-named twin in `codex_protocol` has a
//! different serde casing. The frontend needs four strings and has no business
//! parsing any of that.

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ThreadReadParams;
use codex_app_server_protocol::ThreadReadResponse;
use serde::Serialize;
use tauri::State;

use crate::bridge::AppServerBridge;
use crate::cmd::CmdResult;

/// What the stream needs to label an agent thread.
///
/// Every field beyond `id` is optional because the protocol declares them so:
/// a thread that was not spawned by AgentControl has no nickname or role, and
/// an unnamed thread has no title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadInfo {
    pub id: String,
    /// `Thread.agent_nickname` — "Optional random unique nickname assigned to
    /// an AgentControl-spawned sub-agent."
    pub nickname: Option<String>,
    /// `Thread.agent_role` — e.g. `worker`. The TUI shows this in brackets
    /// after the nickname.
    pub role: Option<String>,
    /// `Thread.name`, the user-facing title, used only when there is no
    /// nickname to show.
    pub name: Option<String>,
}

impl AgentThreadInfo {
    fn from_thread(thread: &codex_app_server_protocol::Thread) -> Self {
        Self {
            id: thread.id.clone(),
            nickname: thread.agent_nickname.clone(),
            role: thread.agent_role.clone(),
            name: thread.name.clone(),
        }
    }
}

/// Reads one agent thread's identity.
///
/// `include_turns` is false on purpose: this is a label lookup, and asking for
/// turns would make the server walk the thread's whole history to answer it
/// (`paginated_thread_full_turns` loops `thread/items/list` per turn).
#[tauri::command]
pub async fn read_agent_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<AgentThreadInfo> {
    let response: ThreadReadResponse = bridge
        .request_as(ClientRequest::ThreadRead {
            request_id: bridge.next_request_id(),
            params: ThreadReadParams {
                thread_id,
                include_turns: false,
            },
        })
        .await?;
    Ok(AgentThreadInfo::from_thread(&response.thread))
}

#[cfg(test)]
#[path = "agents_tests.rs"]
mod tests;
