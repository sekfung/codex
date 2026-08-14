# Desktop app scope mirrors the official app's end-user surface, not the full CLI

Codex CLI exposes developer/debug-only surfaces (`doctor`, `debug_sandbox`, `state_db_recovery`, `migrate_rollouts`, `mcp-server` stdio mode, etc.) that OpenAI's official Desktop app does not expose. The new desktop app's initial scope is the end-user feature set — conversation threads, approvals, MCP/skills/config, auth — mirroring what the official app surfaces, with CLI dev-tooling commands explicitly excluded.

**Why:** matches the stated goal of aligning with the official desktop app's experience, and keeps the GUI coherent rather than becoming a control panel for the entire CLI surface.

**Consequences:** the exact boundary of "end-user feature set" still needs to be enumerated feature-by-feature against what `app-server` exposes; that inventory is tracked separately and may adjust this scope.
