# Codex Desktop v1 supports multi-agent (sub-agent) rendering

Unlike the initial recommendation (defer to v2), v1 renders `CollabAgentToolCall` and `SubAgentActivity` items with real UI, not a generic placeholder.

**Why:** deliberate scope call by the human — the protocol already supports sub-agent collaboration (`CollabAgentToolCall.sender_thread_id`/`receiver_thread_ids`, `SubAgentActivity.agent_thread_id`, and `Thread.parent_thread_id` for the underlying thread relationship) and it's being treated as core v1 scope rather than a deferred extra, despite no visible trace of it in the Official App reference screenshots gathered so far (screenshots only cover the main chat view and three settings pages — absence there isn't strong evidence of absence in the feature).

**Consequences:** this reopens design work that ADR-0005 (single-window/Project-switcher) and ADR-0013 (item rendering) didn't cover: how a sub-agent's own thread relates to the parent's Project entry and message stream (nested inline vs. a drill-in view), and whether `thread/list`-based Project grouping needs to filter out sub-agent threads (via `parent_thread_id`) so they don't pollute the top-level Project sidebar as phantom standalone chats. Tracked as open follow-up, not resolved by this ADR.
