# Navigating into an unlistable thread pushes a trail entry that is the way back

Resolves the UI question ADR-0017 left open, and fixes a stranding bug that predates it.

Sub-agent threads and detached review threads are excluded from the sidebar's `thread/list` by the protocol's `sourceKinds` default (ADR-0017). Making the main pane show one is therefore a one-way trip: there is no row to click to return, and the only escape is selecting an unrelated thread, which loses the user's place. The detached-review path already did this — `startReview` switched to the returned `reviewThreadId` with a comment claiming that "keeps that from being a dead end", which solved *getting there* and not *getting back*.

So navigation into such a thread goes through `drillIntoThread(threadId, fromThreadId, reason)`, which records a `ThreadTrailEntry` alongside the switch, and a breadcrumb bar above the stream offers the way out. Detached reviews now use the same path, which is what fixes the pre-existing case. Selecting a thread from the sidebar or search clears the trail, because a thread the user can reach on their own needs no remembered exit — and offering one would point back somewhere they had already left.

**Why a trail rather than a nested panel:** the drill-in target is a full thread with its own turns, approvals and composer. Rendering it inline would mean two live conversations in one pane, each with its own pending-approval state; switching the pane and remembering the way back reuses everything that already works for a single thread.

**Consequences:** the trail is desktop chrome with no engine counterpart, so it lives in app state (ADR-0021's third admissible case) and does not survive a restart — a thread drilled into and then restarted is reachable only if it is listable, which sub-agent threads are not. Labels come from `thread/read` (`agent_nickname`/`agent_role`), so a drill-in renders with a shortened thread id until that resolves and permanently if it fails.
