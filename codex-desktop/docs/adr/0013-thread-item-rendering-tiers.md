# Codex Desktop v1 renders `ThreadItem` variants in three tiers

`ThreadItem` has ~17 variants (`app-server-protocol/src/protocol/v2/item.rs`). v1 splits them:
- **Dedicated renderer**: `UserMessage`, `AgentMessage`, `Reasoning` (collapsible), `CommandExecution`, `FileChange` — the core "watch Codex work" loop.
- **Generic fallback card**: `McpToolCall`, `WebSearch`, `ImageGeneration`, `EnteredReviewMode`/`ExitedReviewMode` — shown, but with one shared minimal "tool call" component rather than bespoke UI each.
- **Skipped in v1**: `DynamicToolCall`, `Sleep`, `ImageView`, `ContextCompaction`, `HookPrompt`, the experimental `Plan` — not rendered at all; revisit if usage shows they're common.

`CollabAgentToolCall`/`SubAgentActivity` are handled separately — see ADR-0014.

**Why:** the five dedicated-tier variants are what a user is actually watching turn-to-turn; the generic tier keeps rarer tool activity visible without bespoke UI investment; the skip tier is either experimental/unstable protocol surface or genuinely rare enough that a missing item doesn't break comprehension of the conversation.

**Consequences:** an item store keyed by `item_id` needs to hold all item types regardless of tier (skipped items still need to exist in state so approval requests referencing them, or later re-classification, don't break) — only the *rendering* is tiered, not the data model.
