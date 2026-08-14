# Codex Desktop lives at repo-root `codex-desktop/`, not inside `codex-rs/`

Codex Desktop's crate and frontend live at top-level `codex-desktop/` (Rust crate root + `codex-desktop/ui/` frontend), sibling to `codex-cli/`, rather than nested under `codex-rs/` as originally scaffolded. It stays a `codex-rs/` Cargo workspace member via a relative `"../codex-desktop"` path in `codex-rs/Cargo.toml`'s `members` list — Cargo supports out-of-tree member paths — so it keeps everything ADR-0002/ADR-0008 depend on (shared workspace dependency versions, direct path access to `codex-app-server-client`, shared `$CODEX_HOME` resolution code).

**Why:** repo-root placement puts Codex Desktop at the same level as `codex-cli/` — both are top-level *product* surfaces (the npm-distributed CLI wrapper and the desktop app), while `codex-rs/` remains the shared Rust engine workspace both consume. This mirrors the existing `codex-cli`/`codex-rs` split rather than treating the desktop app as "one more codex-rs crate."

**Consequences:** the crate is a Cargo workspace member whose manifest lives outside the workspace root's own directory tree — an unusual but fully-supported Cargo configuration; anyone looking for it under `codex-rs/` won't find it, so `codex-rs/README.md`/onboarding docs weren't touched (per ADR-0001) but this is worth mentioning if anyone asks "where did the desktop app crate go."
