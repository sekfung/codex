//! Branch and commit listings that populate the review picker.
//!
//! `ReviewTarget::BaseBranch` and `ReviewTarget::Commit` need a branch name and
//! a SHA. Typing either by hand is the current state and it is a poor fit for a
//! desktop client, so this module supplies the candidates.
//!
//! Unlike `git_diff.rs`, this calls `codex_git_utils` directly rather than
//! routing through `command/exec`. The two are not inconsistent: `git_diff.rs`
//! *constructs* git invocations (hooks disabled, filter drivers suppressed,
//! fsmonitor overridden), and command construction is exactly what must not
//! bypass the session's sandbox. Here nothing is constructed — these are engine
//! functions reused verbatim, which is what ADR-0021 asks for. The TUI makes
//! the same call for the same purpose in `tui/src/chatwidget.rs`, where
//! `local_git_branches` and `recent_commits` populate its own pickers.
//!
//! Every listing is best-effort. `codex_git_utils` returns empty vectors rather
//! than errors when `cwd` is not a repository or git is missing, and that
//! convention is preserved: the picker falls back to free text instead of
//! failing the whole review flow.

use std::path::PathBuf;

use codex_git_utils::current_branch_name;
use codex_git_utils::local_git_branches;
use codex_git_utils::recent_commits;
use serde::Serialize;

/// How many commits to offer in the picker.
///
/// The list is a convenience for "review the change I just made", not a log
/// browser; a SHA can still be pasted for anything older.
const RECENT_COMMIT_LIMIT: usize = 30;

/// One entry in the commit picker.
///
/// `codex_git_utils::CommitLogEntry` is re-shaped rather than re-exported
/// because its `timestamp` is a bare `i64` that would reach TypeScript as an
/// unlabelled number. Naming the unit at the boundary is cheaper than
/// discovering the mistake in the UI.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitOption {
    pub sha: String,
    /// Seconds since the Unix epoch, committer time.
    pub timestamp_seconds: i64,
    /// Single-line commit subject.
    pub subject: String,
}

/// Candidates for the review target picker.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    /// False when `cwd` is not a git work tree. The UI hides the branch and
    /// commit targets entirely rather than offering empty pickers, matching
    /// how `GitDiffResult::is_git_repo` is treated.
    pub is_git_repo: bool,
    /// Local branches, default branch first (`local_git_branches` orders them).
    pub branches: Vec<String>,
    /// The checked-out branch, absent on a detached HEAD.
    pub current_branch: Option<String>,
    /// Recent commits reachable from HEAD, newest first.
    pub commits: Vec<GitCommitOption>,
}

/// Branch and commit candidates for `review/start`'s target picker.
#[tauri::command]
pub async fn git_refs(cwd: String) -> Result<GitRefs, String> {
    let cwd = PathBuf::from(cwd);

    // `get_git_repo_root` is the same probe `session.rs` uses to decide whether
    // a thread carries git info at all, so the picker appears exactly when the
    // engine considers the directory a repository.
    if codex_git_utils::get_git_repo_root(&cwd).is_none() {
        return Ok(GitRefs {
            is_git_repo: false,
            branches: Vec::new(),
            current_branch: None,
            commits: Vec::new(),
        });
    }

    let (branches, current, commits) = tokio::join!(
        local_git_branches(&cwd),
        current_branch_name(&cwd),
        recent_commits(&cwd, RECENT_COMMIT_LIMIT),
    );

    Ok(GitRefs {
        is_git_repo: true,
        branches,
        current_branch: current,
        commits: commits
            .into_iter()
            .map(|entry| GitCommitOption {
                sha: entry.sha,
                timestamp_seconds: entry.timestamp,
                subject: entry.subject,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    /// A non-repository must report `isGitRepo: false` rather than an empty
    /// list, because the UI treats the two differently: absent pickers versus
    /// pickers with nothing in them.
    #[tokio::test]
    async fn non_repository_reports_absence_not_emptiness() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let refs = git_refs(tmp.path().to_string_lossy().into_owned())
            .await
            .expect("git_refs");

        assert_eq!(
            refs,
            GitRefs {
                is_git_repo: false,
                branches: Vec::new(),
                current_branch: None,
                commits: Vec::new(),
            }
        );
    }

    /// `timestampSeconds` is renamed at this boundary precisely so the unit is
    /// not guessable; pin the serialized shape so a later refactor cannot
    /// quietly emit a bare `timestamp` again.
    #[test]
    fn commit_option_names_its_time_unit_on_the_wire() {
        let json = serde_json::to_value(GitCommitOption {
            sha: "abc123".to_string(),
            timestamp_seconds: 1_700_000_000,
            subject: "Add review picker".to_string(),
        })
        .expect("serialize");

        assert_eq!(
            json,
            serde_json::json!({
                "sha": "abc123",
                "timestampSeconds": 1_700_000_000,
                "subject": "Add review picker",
            })
        );
    }
}
