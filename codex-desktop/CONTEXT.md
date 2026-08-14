# Codex Desktop App (Tauri)

A new, additive Rust + Tauri 2 desktop client for Codex, living at repo-root `codex-desktop/` (a Cargo workspace member of `codex-rs/` via a relative path, alongside `codex-cli/` as a top-level product surface). It embeds `codex-app-server` in-process and is launched independently of the CLI's existing `codex app` command (see ADR-0001, ADR-0002).

## Language

**Codex Desktop**:
Engineering name for the app being built in this context (crate + directory `codex-desktop`, package `codex-desktop`). Ships to end users branded simply as "Codex" — matching the Official App's branding — but is an entirely separate, independently-built application with no shared code path to the Official App.
_Avoid_: Desktop app, the new app (ambiguous with Official App)

**Official App**:
OpenAI's existing closed-source Codex desktop client (macOS `.dmg`, Windows Microsoft Store install), unrelated to this repo's code. Found/installed/opened by the pre-existing `codex app` CLI command (`cli/src/app_cmd.rs`, `cli/src/desktop_app/`). Never modified or replaced by Codex Desktop.
_Avoid_: Desktop app, Desktop App (the literal string already used for this in existing CLI help text — ambiguous once Codex Desktop exists; use "Official App" in new docs/code comments instead)

**Project**:
A named, persisted sidebar entry (e.g. "pi", "casdoor") representing a repository/folder the user has opened in Codex Desktop before, switchable inside a single window via an internal switcher (ADR-0005) rather than one OS window per entry. Its known-Projects list (which paths are pinned, in what order) is Codex Desktop's own app-local state (ADR-0012); the threads *within* a Project are backed by app-server's `thread/list`, grouped client-side by each thread's `cwd`. Matches the Official App's own sidebar label (confirmed from reference screenshots), superseding the earlier working term "Workspace."
_Avoid_: workspace, folder (as the canonical UI term for this concept)
