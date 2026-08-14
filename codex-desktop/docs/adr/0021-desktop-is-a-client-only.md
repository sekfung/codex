# Codex Desktop is a client over existing Codex capability — it never reimplements it

Governing constraint for every increment: Codex Desktop contributes a *presentation layer* and nothing else. Any behavior that already exists in the Codex engine is reached through `codex-app-server` (embedded in-process per ADR-0002), never reimplemented in `codex-desktop/src/`.

Concretely, this is what "don't reinvent the wheel" forbids:

- **No parsing or writing `config.toml` directly.** Use `config/read`, `config/value/write`, `config/batchWrite` (ADR-0020).
- **No reimplementing approval, sandbox, or permission logic.** Reuse `builtin_approval_presets()` and the profile ids the engine already defines; the desktop's three-mode selector is a *mapping onto* those, not a parallel policy system (see `src/approval_mode.rs`).
- **No reading rollouts, thread files, or session state off disk.** Use `thread/*` RPCs.
- **No separate MCP client, skills discovery, plugin resolution, or auth/login implementation.** Use `mcpServerStatus/*`, `skills/*`, `plugin/*`, `account/*`.
- **No shelling out to the `codex` binary** to obtain something an RPC already provides.
- **No re-deriving data the protocol already carries** — e.g. file diffs arrive on `FileChange` items; don't invoke git to recompute them.

What Codex Desktop *may* own is only what has no engine counterpart: window/layout state, the pinned Project list (ADR-0012), theme mode (ADR-0009), and the React/shadcn component layer itself (ADR-0019).

**Why:** duplicated logic in the desktop crate would drift from the engine on every upstream merge — the exact failure mode ADR-0001 exists to prevent — and would produce a desktop app whose behavior silently disagrees with the CLI on the same machine and the same `$CODEX_HOME` (ADR-0008).

**Consequence:** when a desired feature has no RPC behind it, the answer is to say so and stop, not to implement it locally. A missing capability is a protocol gap to report, not a gap for this crate to fill.
