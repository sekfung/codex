# Codex Desktop shares `$CODEX_HOME` with the CLI

Codex Desktop resolves `$CODEX_HOME` the same way the CLI does (via `codex_utils_home_dir::find_codex_home()`, reached through `codex_core::config::Config::load_default_with_cli_overrides()`) and reads/writes the same `config.toml`, `auth.json`, rollouts, skills, and MCP config — it does not use an isolated profile directory.

**Why:** matches the overall goal of aligning with CLI behavior; logging in via one surface authenticates the other, and config changes are immediately visible across both, with no protocol changes required.

*(Correction: an earlier draft of this ADR named the `codex-home` crate as the resolution mechanism — that crate is actually about loading `AGENTS.md` instructions and is unrelated to `$CODEX_HOME` path resolution. Fixed after the scaffolding pass confirmed the real code path.)*

**Consequences:** Codex Desktop and a concurrently-running CLI session share state (config, auth, rollout history) — any future concurrency/locking concerns around simultaneous writers to `$CODEX_HOME` inherit whatever guarantees `codex-home`/`core` already provide for multiple CLI processes, not something Codex Desktop needs to solve independently.
