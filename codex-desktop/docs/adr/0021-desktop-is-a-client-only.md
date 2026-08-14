# Codex Desktop is a client over existing Codex capability — it never reimplements it

Governing constraint for every increment: Codex Desktop contributes a *presentation layer* and nothing else. Any behavior that already exists in the Codex engine is reached through `codex-app-server` (embedded in-process per ADR-0002), never reimplemented in `codex-desktop/src/`.

## The admission test

Stronger than "don't reimplement": **every feature must trace to an existing Codex capability, or it does not ship.** Before building anything, name its basis — the RPC, config key, or CLI command it renders. A feature whose only justification is "the Official App's screenshot shows it" or "it would be nice" fails the test.

Three admissible answers, and no fourth:

1. **It renders an existing capability.** Name the RPC or config key. This covers almost everything.
2. **It is presentation of that capability** — layout, grouping, wording, collapsing, sorting. Presentation may be freely designed; the *capability* underneath may not be invented.
3. **It has no engine counterpart at all** because it is desktop chrome: window and layout state, the pinned Project list (ADR-0012), theme mode (ADR-0009), the component layer itself (ADR-0019). This exemption is narrow — it covers only state the CLI could not meaningfully have, never behavior the CLI does have but exposes differently.

When a desired feature has no basis, the correct output is to **say so and stop** — it is a protocol gap to report upward, not a gap for this crate to fill. Shipping a control that appears to work but is locally faked is the specific failure this ADR exists to prevent.

Corollary for UI copied from reference screenshots: a screenshot proves the Official App has a feature, **not** that this repo's engine exposes it. Every borrowed control still needs its own basis. Where the Official App's model and the engine's model differ, the engine wins and the divergence gets recorded (e.g. the three approval modes map onto `(preset, approvals_reviewer)` pairs, not onto three presets — see `src/approval_mode.rs`; the `read-only` preset has no mode in that mapping).

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
