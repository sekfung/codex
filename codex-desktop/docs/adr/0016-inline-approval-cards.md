# Codex Desktop's approval UX has two layers: a persistent mode selector plus inline stream cards

*(Corrected after a fuller conversation-thread reference screenshot — the original version of this ADR only had the inline-card layer; the composer-level selector layer was missing.)*

Two distinct, complementary pieces of UI, not one:
1. **A persistent approval-mode selector** in the composer (confirmed from reference screenshots: "帮我批准" button opens a 3-preset picker — "请求批准"/Request approval, "帮我批准"/Help me approve, "完全访问权限"/Full access, each with a one-line description). This sets the standing policy — it's the UI front-end for the `config` screen's `批准策略`/approval-policy and sandbox settings (already in scope per the original feature inventory), not a per-request decision.
2. **Inline stream cards** for the individual approval requests (`item/commandExecution|fileChange|permissions/requestApproval`) that actually fire under whatever the current mode allows — rendered inline in the chat stream after the item they're approving, with action buttons on the card itself, not a modal dialog blocking the rest of the window.

**Why:** matches the "watch Codex work while deciding" mental model for the inline layer (consistent with the prevailing pattern in other agentic coding tools); the mode-selector layer exists because the Official App clearly separates "how cautious should Codex be by default" (a standing policy, set rarely) from "here's one specific thing that needs a yes/no right now" (a per-item interruption, ADR-0015's decision-richness applies here).

**Consequences:** since `TurnStatus` has no "waiting on approval" state (only `Completed|Interrupted|Failed|InProgress` — confirmed against the protocol), the frontend must derive "this turn is blocked on an approval" itself from whether an unresolved approval request exists for the turn, and the composer/input area needs its own affordance for "there's a pending decision" state since it won't be a blocking overlay. The mode-selector's 3 presets need mapping to concrete `PermissionsRequestApprovalResponse`/config values — not yet designed, follow-up needed.
