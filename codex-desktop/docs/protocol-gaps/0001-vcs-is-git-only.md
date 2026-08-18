# The engine assumes git, so Codex Desktop cannot offer SVN without engine-side work

Reported upward per ADR-0021: a desired capability with no basis is a protocol gap, not a gap for `codex-desktop/` to fill locally.

> **Status. All four sites are closed.** The per-site sections below are kept as
> originally written, each with a closing note on how it was resolved and on anything
> the original reading got wrong.

`grep -rin "svn\|Subversion"` across `codex-rs/`, `codex-desktop/` and `docs/` returns **nothing**. There is no VCS abstraction to implement against — git is not one supported backend among several, it is assumed by name at four load-bearing points. Each is listed below with what an SVN-capable engine would have to do about it.

## 1. Trust boundary and workspace context

`core/src/realtime_context.rs:165,174,347,502` calls `resolve_root_git_project_for_trust`. The resolved git root defines the project grouping used for trust decisions, and at `:347` it also selects which directory tree is rendered into the model's workspace context.

Outside a git repository this returns `None`, so an SVN working copy silently falls back to bare-`cwd` behaviour: no repository-level grouping, and a narrower workspace section than the equivalent git checkout would produce.

**What SVN needs:** a VCS-agnostic "project root" resolution. This is the cheapest of the four, and the concept transfers directly.

**Closed.** `core/src/project_root.rs` resolves git first, then Subversion, and reports which system answered so the callers that label the result can say what they found — an SVN working copy previously fell through to `### Directory:`, telling the model it was looking at loose files. One correction to the sentence above: the root is the *nearest* ancestor carrying `.svn`, not the outermost. Subversion 1.7 consolidated the per-directory `.svn` into a single one at the working-copy root, and nearest is also what nested copies need, which is exactly what `svn:externals` produces.

## 2. Thread metadata

`thread-store/src/thread_metadata_sync.rs:55-62` gates on `get_git_repo_root(cwd).is_some()` and, when true, records `GitInfo { commit_hash, branch, repository_url }` on every thread. `rollout/src/recorder.rs:1852` writes the same into the rollout file.

**What SVN needs:** the stored shape is the problem, not the probe. `commit_hash` + `branch` has no faithful SVN equivalent — SVN has a monotonic revision number and a *path* convention (`trunk`/`branches/x`), not a branch ref. Either the field becomes a tagged union over VCS kinds, or `branch` is redefined loosely enough to hold a path and `commit_hash` to hold a revision. That is a persisted-format decision affecting existing rollout files, so it wants deciding early.

**Closed.** `GitInfo` gained a `vcs` discriminator, and the three value fields are reused rather than duplicated per system — a reader consults one field and interprets it by `vcs`. The migration cost nothing, for one specific reason: `VcsKind` defaults to git on read, and every record written before this came from a git-only build, so an absent discriminator is a true statement about existing data rather than a fallback for unknown data. Git records stay byte-identical because the field is skipped when it is git. The state database needed a `git_vcs` column (migration `0049`) too: without it the discriminator was lost on the round trip through `ThreadMetadataPatch`, and a Subversion thread read back as git.

## 3. `ReviewTarget` is branch/sha-shaped

`app-server-protocol/src/protocol/v2/review.rs:43-65` defines the review target as `UncommittedChanges | BaseBranch { branch } | Commit { sha } | Custom { instructions }`.

`BaseBranch` and `Commit` are git vocabulary in the wire protocol itself, not just in an implementation. `UncommittedChanges` and `Custom` are already VCS-neutral and would work as-is against SVN.

**What SVN needs:** either two more variants (`Revision { number }`, `BranchPath { path }`) or a generalisation of the existing two. Note this is a v2 protocol type consumed by the TUI, `codex exec review`, and Codex Desktop alike — changing it is not additive for this fork (ADR-0001).

**Closed, and one of the two variants turned out to be unnecessary.** Only `Revision { revision, title }` was added. A revision is a number rather than a hash, so putting one in a field named `sha` would leave every consumer guessing what it received — that earns its own variant. `BaseBranch` did not: comparing against a base means the same thing in both systems and only the commands differ, so the variant is shared and `review_prompt` renders `svn diff` in place of `git diff` when the directory is a working copy.

**A correction to the paragraph above.** It implied `BaseBranch` merely lacked Subversion support. It was worse than that: `merge_base_with_head` returns an *error* rather than `None` outside a git repository, and `review_prompt` propagates it with `?`, so a base-branch review in a Subversion working copy failed outright instead of degrading. The git wording is reached only when the directory *is* a git repository whose branch cannot be resolved.

## 4. Command-safety classifier — the one that will be felt first

`shell-command/src/command_safety/is_safe_command.rs:175-199` `is_safe_git_command` auto-approves read-only git: `status`, `log`, `diff`, `show`, and read-only forms of `branch`. There is **no `is_safe_svn_command`**.

Consequence: in an SVN working copy every `svn status` and `svn diff` the agent runs raises an approval prompt, while the git equivalents pass silently. This is the gap a user notices within the first minute — before any missing UI — and it is also the easiest to close, since the classifier is additive and mirroring the existing git logic for SVN's read-only subcommands requires no protocol change.

**Closed.** `is_safe_svn_command` allowlists the read-only verbs and their aliases, failing closed on anything unlisted (`ci`, `co`). Mirroring git was not sufficient on its own, and the two departures are worth knowing:

- Subversion keeps no local history, so `log`, `info` and revision-ranged `diff` reach the network where their git equivalents stay on disk. That is allowed against the working copy's own repository — it is simply how Subversion is read — but refused when an explicit URL operand names a server the user never did.
- `--diff-cmd`, `--diff3-cmd` and `--editor-cmd` are Subversion's `--ext-diff`. They are refused together with `--config-dir`/`--config-option`, because a config override can set `diff-cmd` itself and blocking only the direct spelling would leave the hole open.

## Correction: the git baseline is *not* a blocker

An earlier reading of this problem flagged `git-utils/src/baseline.rs` (`ensure_git_baseline_repository`, `reset_git_repository`, `diff_since_latest_init`) as the hardest obstacle, on the theory that the engine uses git as an undo mechanism for the user's working tree. **That is wrong.**

Its only non-test caller is `memories/write/src/workspace.rs:13-19,26-28,44-45`, and `root` there is the *memory workspace* directory. The module's own doc comment says so: "meant for internal directories where git is used only as a baseline/diff implementation detail, **not for user repositories**." It never touches the user's project, so the user's VCS is irrelevant to it.

## Suggested sequencing

1. ~~**Command-safety classifier**~~ — done. Additive, no protocol change, removed the most visible daily friction.
2. ~~**Project-root resolution**~~ — done. Unblocked trust grouping and workspace context together.
3. ~~**Thread metadata shape**~~ — done. `vcs` discriminator plus state-database column, no backfill.
4. ~~**`ReviewTarget`**~~ — done. One new variant, and a shared one whose prompt now adapts.

All four are closed. What Subversion still lacks relative to git is candidate *listing*: the review picker offers a revision field to type into rather than a list to choose from, because listing revisions means `svn log`, which contacts the repository server — too slow to run on opening a popover. That is a UI affordance, not a protocol gap.

## What Codex Desktop does today

Nothing here is worked around locally, which is what made closing the gaps engine-side the only honest route.

`git_refs` now reports which system it found rather than only whether it found git, and the review picker follows: branch and commit targets in a git work tree, the revision target in a Subversion working copy, and the base-branch target in both. `git_diff`, `git_diff_to_remote` and `branch_status` remain git-specific and report "not a git repository" as a distinct, honest state rather than an error or an empty result — so in a Subversion working copy those surfaces are absent rather than broken.

Their Subversion counterparts are the natural next increment, and unlike everything above they need no engine work: `svn diff` and `svn status` are now auto-approved reads.
