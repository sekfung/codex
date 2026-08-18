# Codex Desktop's agent-message action row is Copy + Fork only in v1

Each agent message gets two actions in v1: copy (message text to clipboard) and fork (branch a new thread from this point, via the existing `thread/fork` RPC and `Thread.forked_from_id` — same mechanism the CLI's `codex fork` already uses). Thumbs-up/down feedback rating and any other icons seen on individual messages in reference screenshots are not implemented in v1.

**Why:** copy and fork are both directly backed by existing protocol/CLI capability with zero new surface; per-message thumbs-up/down feedback would need its own design (what does rating a single message *do* — feed `feedback/upload`? something else?) that hasn't been scoped, so it's deferred rather than guessed at.

**Note:** a "合并到master" button seen in an earlier reference screenshot turned out to be content from that specific conversation (the agent's own message, or a skill/slash-command result) — not Official App chrome — so it isn't a real design surface here at all; no scope change needed on top of ADR-0006.
