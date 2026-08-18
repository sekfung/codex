# Desktop backend embeds app-server in-process, not as a subprocess

`codex-app-server` can be driven two ways: spawned as a subprocess speaking stdio JSON-RPC (how the VS Code extension does it), or embedded in-process via `app-server/src/in_process.rs` behind the `codex-app-server-client` wrapper (how the TUI and `exec` do it). The desktop app's Rust/Tauri backend takes a direct dependency on `codex-app-server-client` and embeds app-server in-process, rather than shelling out to a `codex app-server` subprocess.

**Why:** this is the pattern the app-server codebase itself documents as the intended path for "CLI surfaces that run in the same process" (see `in_process.rs` module docs), avoids a process boundary and JSON serialization overhead per window, and requires zero changes to `app-server` — just a new dependent crate.
