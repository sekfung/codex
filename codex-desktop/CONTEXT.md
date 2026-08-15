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
A named, persisted sidebar entry (e.g. "pi", "casdoor") representing a git repository or plain folder the user has opened in Codex Desktop before, switchable inside a single window via an internal switcher (ADR-0005) rather than one OS window per entry. Its known-Projects list (which paths are pinned, in what order) is Codex Desktop's own app-local state (ADR-0012); the threads *within* a Project are backed by app-server's `thread/list`, grouped client-side by each thread's `cwd`. Matches the Official App's own sidebar label (confirmed from reference screenshots), superseding the earlier working term "Workspace."
_Avoid_: workspace, folder (as the canonical UI term for this concept); "repository" on its own, which reads as version-control-neutral when the repository-shaped behaviour a Project gets is specifically git-shaped

**Engine setting**:
A setting the Codex engine on this machine reads, and which therefore means the same thing to Codex Desktop and to the CLI sharing its `$CODEX_HOME`. Changing one changes what happens locally. These are the settings Codex Desktop may render.
_Avoid_: "setting" unqualified, wherever the contrast with an Account setting is what matters

**Account setting**:
A setting stored against the user's ChatGPT account and read by OpenAI's backend, not by any engine running here. It shapes what Codex does *on OpenAI's side* — pushing branches, opening pull requests. Codex Desktop cannot render one as a control: it has no way to change it, and a copy of its value would be a claim rather than a setting. Where one nonetheless affects local behaviour (commit attribution), Codex Desktop may describe the behaviour but never present it as on or off.
_Avoid_: "cloud setting" (ambiguous with Cloud tasks, an excluded surface — ADR-0006); "remote setting"
