# Codex Desktop's Project list lives in Tauri's app-local storage, not `$CODEX_HOME`

The sidebar's list of known Projects (paths the user has manually opened, including ones with zero threads yet — matching the Official App's "casdoor: 没有聊天" state) has no protocol-level backing: `app-server`'s `thread/list` returns threads with a `cwd` each, but there's nothing to list for a Project with no threads. Codex Desktop persists this list itself, in Tauri's platform-standard app-local data directory (e.g. via a Tauri store plugin), not under `$CODEX_HOME`.

**Why:** despite ADR-0008's shared-`$CODEX_HOME` principle, this specific piece of state — which folders are pinned in the sidebar, in what order — is desktop-UI chrome, not Codex config/auth/rollout data the CLI has any stake in. Mixing it into `$CODEX_HOME` would blur who owns that file (mirrors how VS Code keeps its own "recent workspaces" list in its own app data, not in project config).

**Consequences:** the Project list does not sync with anything CLI-side and is local to one machine/install; threads themselves remain fully shared via `$CODEX_HOME` per ADR-0008 — only the sidebar's *pinned-folder* bookkeeping is desktop-local.
