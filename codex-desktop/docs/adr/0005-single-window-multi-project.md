# Codex Desktop is a single window with an internal project switcher

Unlike the CLI, where the working directory implicitly scopes one process to one workspace root, Codex Desktop uses one application window with an internal switcher between multiple open Projects (see CONTEXT.md), rather than one window per opened Project.

**Why:** deliberate product choice (over the CLI-mirroring "one window per Project" alternative), made viable by the protocol: `ThreadStartParams.cwd` and `runtime_workspace_roots` (`app-server-protocol/src/protocol/v2/thread.rs`) are per-thread, not per-instance, so a single embedded app-server (ADR-0002) can already host threads rooted in different workspace roots concurrently — no protocol changes needed to support this. Confirmed against reference screenshots of the Official App, which shows the same sidebar "项目" (Project) list/switcher pattern.

**Consequences:** the UI needs its own project-switching chrome (not just an OS-level "open a new window"), and window state (which Project/thread is active) is app-level state Codex Desktop owns, not something app-server tracks.
