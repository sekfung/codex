# The Environment screen edits shell-environment config, not WSL settings

ADR-0006 lists **Environment/WSL settings** as in scope for v1, "backed by the CLI's existing `wsl_paths.rs` handling". That basis does not exist, and this ADR corrects it.

`cli/src/wsl_paths.rs` is a 59-line path converter: `win_path_to_wsl` turns `C:\foo` into `/mnt/c/foo`, and `normalize_for_wsl` applies it when running under WSL. It is called from exactly one place in `cli/src/main.rs`, to normalise a command path. `is_wsl` is used elsewhere only to adapt clipboard, footer and keyboard handling at runtime. **There is no WSL config key anywhere in the repo**, and nothing selects "which environment the agent runs in" — so the reference screenshot's 智能体环境 and 集成终端 Shell rows have no counterpart in this engine. Per ADR-0021's admission test they cannot ship, and they are removed from the General screen rather than left permanently inert.

What the engine does expose is the shell environment itself, and that is what the 环境 screen edits: `allow_login_shell`, and `shell_environment_policy`'s `inherit`, `ignore_default_excludes` and `experimental_use_profile`. Its `set`/`exclude`/`include_only`/`filters` pattern tables are shown as counts only — a control able to express part of a pattern table would silently drop the rest on save.

The `environment/*` RPCs are a different thing again: they attach **remote exec-server** environments over a WebSocket (`environment/add` requires an `exec_server_url`). They are `#[experimental]` and no in-tree client calls them, so the screen names that surface as unavailable rather than offering it.

**Consequences:** ADR-0006's "Environment/WSL settings" line should be read as satisfied by this screen. The two screenshot rows stay unbuilt until the engine gains a capability behind them — that is a protocol gap to report upward, not one for this crate to fill.
