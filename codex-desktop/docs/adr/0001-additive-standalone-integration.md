# Desktop app ships as a standalone addition, not a change to `codex app`

The existing `codex app` command (`cli/src/app_cmd.rs`, `cli/src/desktop_app/`) finds/installs/launches OpenAI's official closed-source Desktop app and is untouched upstream logic in a repo we intend to keep syncing from `openai/codex`. The new Tauri-based desktop app is built as entirely new, additive files — a new crate at repo-root `codex-desktop/` (sibling to `codex-cli/`, registered as a `codex-rs/` Cargo workspace member via a relative `../codex-desktop` path), launched through its own entry point — never by editing the behavior of any existing file. The only touches to shared files are single-line registrations: one in `codex-rs/Cargo.toml`'s workspace `members` list, one in root `pnpm-workspace.yaml`'s package list for the frontend. Bazel and CI wiring are deferred so no workflow or `BUILD.bazel` files need to change yet either.

**Why:** any edit to existing logic, however small, becomes a permanent conflict point on every future `git merge`/`rebase` from upstream. Staying additive-only (plus the one trivial, low-churn line) keeps that risk close to zero.

**Consequences:** the new app cannot reuse `codex app`'s install/launch UX (deep-link handling, `.dmg`/Store install flow) — it needs its own launch path and installer story from scratch.
