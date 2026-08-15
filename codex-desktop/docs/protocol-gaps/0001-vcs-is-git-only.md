# The engine assumes git, so Codex Desktop cannot offer SVN without engine-side work

Reported upward per ADR-0021: a desired capability with no basis is a protocol gap, not a gap for `codex-desktop/` to fill locally.

`grep -rin "svn\|Subversion"` across `codex-rs/`, `codex-desktop/` and `docs/` returns **nothing**. There is no VCS abstraction to implement against — git is not one supported backend among several, it is assumed by name at four load-bearing points. Each is listed below with what an SVN-capable engine would have to do about it.

## 1. Trust boundary and workspace context

`core/src/realtime_context.rs:165,174,347,502` calls `resolve_root_git_project_for_trust`. The resolved git root defines the project grouping used for trust decisions, and at `:347` it also selects which directory tree is rendered into the model's workspace context.

Outside a git repository this returns `None`, so an SVN working copy silently falls back to bare-`cwd` behaviour: no repository-level grouping, and a narrower workspace section than the equivalent git checkout would produce.

**What SVN needs:** a VCS-agnostic "project root" resolution. This is the cheapest of the four — SVN's root is discoverable (walk up to the outermost `.svn`), and the concept transfers directly.

## 2. Thread metadata

`thread-store/src/thread_metadata_sync.rs:55-62` gates on `get_git_repo_root(cwd).is_some()` and, when true, records `GitInfo { commit_hash, branch, repository_url }` on every thread. `rollout/src/recorder.rs:1852` writes the same into the rollout file.

**What SVN needs:** the stored shape is the problem, not the probe. `commit_hash` + `branch` has no faithful SVN equivalent — SVN has a monotonic revision number and a *path* convention (`trunk`/`branches/x`), not a branch ref. Either the field becomes a tagged union over VCS kinds, or `branch` is redefined loosely enough to hold a path and `commit_hash` to hold a revision. That is a persisted-format decision affecting existing rollout files, so it wants deciding early.

## 3. `ReviewTarget` is branch/sha-shaped

`app-server-protocol/src/protocol/v2/review.rs:43-65` defines the review target as `UncommittedChanges | BaseBranch { branch } | Commit { sha } | Custom { instructions }`.

`BaseBranch` and `Commit` are git vocabulary in the wire protocol itself, not just in an implementation. `UncommittedChanges` and `Custom` are already VCS-neutral and would work as-is against SVN.

**What SVN needs:** either two more variants (`Revision { number }`, `BranchPath { path }`) or a generalisation of the existing two. Note this is a v2 protocol type consumed by the TUI, `codex exec review`, and Codex Desktop alike — changing it is not additive for this fork (ADR-0001).

## 4. Command-safety classifier — the one that will be felt first

`shell-command/src/command_safety/is_safe_command.rs:175-199` `is_safe_git_command` auto-approves read-only git: `status`, `log`, `diff`, `show`, and read-only forms of `branch`. There is **no `is_safe_svn_command`**.

Consequence: in an SVN working copy every `svn status` and `svn diff` the agent runs raises an approval prompt, while the git equivalents pass silently. This is the gap a user notices within the first minute — before any missing UI — and it is also the easiest to close, since the classifier is additive and mirroring the existing git logic for SVN's read-only subcommands requires no protocol change.

## Correction: the git baseline is *not* a blocker

An earlier reading of this problem flagged `git-utils/src/baseline.rs` (`ensure_git_baseline_repository`, `reset_git_repository`, `diff_since_latest_init`) as the hardest obstacle, on the theory that the engine uses git as an undo mechanism for the user's working tree. **That is wrong.**

Its only non-test caller is `memories/write/src/workspace.rs:13-19,26-28,44-45`, and `root` there is the *memory workspace* directory. The module's own doc comment says so: "meant for internal directories where git is used only as a baseline/diff implementation detail, **not for user repositories**." It never touches the user's project, so the user's VCS is irrelevant to it.

## Suggested sequencing

1. **Command-safety classifier** — additive, no protocol change, removes the most visible daily friction.
2. **Project-root resolution** — the concept transfers cleanly; unblocks trust and workspace context together.
3. **Thread metadata shape** — decide the persisted format before more rollout files accumulate under the git-only assumption.
4. **`ReviewTarget`** — last, because it is a wire-protocol change with three consumers, and because `UncommittedChanges` already covers the common case in the meantime.

## What Codex Desktop does today

Nothing here is worked around locally. `git_refs`, `git_diff`, `git_diff_to_remote` and `branch_status` each report "not a git repository" as a distinct, honest state rather than an error or an empty result, and the review picker hides its `baseBranch` and `commit` targets outside a git work tree. In an SVN working copy the git-specific surfaces are therefore absent rather than broken — which is the correct behaviour until the engine has something else to render.
