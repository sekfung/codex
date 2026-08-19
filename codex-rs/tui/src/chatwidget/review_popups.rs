//! Review preset selection and custom review prompt surfaces.

use super::*;
use crate::workspace_command::WorkspaceCommand;
use codex_vcs_utils::collect_svn_info;
use codex_vcs_utils::is_svn_working_copy;

impl ChatWidget {
    pub(crate) fn open_review_popup(&mut self) {
        let mut items: Vec<SelectionItem> = Vec::new();

        items.push(SelectionItem {
            name: "Review against a base branch".to_string(),
            description: Some("(PR Style)".into()),
            actions: vec![Box::new({
                let cwd = self.config.cwd.to_path_buf();
                move |tx| {
                    tx.send(AppEvent::OpenReviewBranchPicker(cwd.clone()));
                }
            })],
            dismiss_on_select: false,
            dismiss_parent_on_child_accept: true,
            ..Default::default()
        });

        items.push(SelectionItem {
            name: "Review uncommitted changes".to_string(),
            actions: vec![Box::new(move |tx: &AppEventSender| {
                tx.review(ReviewTarget::UncommittedChanges);
            })],
            dismiss_on_select: true,
            ..Default::default()
        });

        items.push(SelectionItem {
            name: "Review a commit".to_string(),
            actions: vec![Box::new({
                let cwd = self.config.cwd.to_path_buf();
                move |tx| {
                    tx.send(AppEvent::OpenReviewCommitPicker(cwd.clone()));
                }
            })],
            dismiss_on_select: false,
            dismiss_parent_on_child_accept: true,
            ..Default::default()
        });

        items.push(SelectionItem {
            name: "Custom review instructions".to_string(),
            actions: vec![Box::new(move |tx| {
                tx.send(AppEvent::OpenReviewCustomPrompt);
            })],
            dismiss_on_select: false,
            dismiss_parent_on_child_accept: true,
            ..Default::default()
        });

        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some("Select a review preset".into()),
            footer_hint: Some(standard_popup_hint_line()),
            items,
            ..Default::default()
        });
    }

    pub(crate) async fn show_review_branch_picker(&mut self, cwd: &Path) {
        if is_svn_working_copy(cwd) {
            self.show_svn_review_branch_picker(cwd).await;
            return;
        }

        let branches = local_git_branches(cwd).await;
        let current_branch = current_branch_name(cwd)
            .await
            .unwrap_or_else(|| "(detached HEAD)".to_string());
        let mut items: Vec<SelectionItem> = Vec::with_capacity(branches.len());

        for option in branches {
            let branch = option.clone();
            items.push(SelectionItem {
                name: format!("{current_branch} -> {branch}"),
                actions: vec![Box::new(move |tx3: &AppEventSender| {
                    tx3.review(ReviewTarget::BaseBranch {
                        branch: branch.clone(),
                    });
                })],
                dismiss_on_select: true,
                search_value: Some(option),
                ..Default::default()
            });
        }

        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some("Select a base branch".to_string()),
            footer_hint: Some(standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to search branches".to_string()),
            ..Default::default()
        });
    }

    /// Shows the SVN branch picker for a Subversion working copy.
    ///
    /// Subversion's nearest analogue to a base branch is a repository-relative
    /// path such as `^/trunk` or `^/branches/feature-x`. The picker surfaces
    /// the current working copy's branch path as the default comparison base.
    async fn show_svn_review_branch_picker(&mut self, cwd: &Path) {
        let info = collect_svn_info(cwd).await;
        let current_path = info
            .as_ref()
            .and_then(|info| info.branch_path.clone())
            .unwrap_or_else(|| "trunk".to_string());
        // The prompt renders `svn diff {{base_path}}`, and `^/` is
        // Subversion's repository-root sentinel — the path needs it to be
        // interpreted relative to the repository root.
        let current_path = format!("^/{current_path}");
        let mut items: Vec<SelectionItem> = Vec::new();

        // Offer the current branch as the primary comparison base.
        let current = current_path.clone();
        items.push(SelectionItem {
            name: format!("current ({current})"),
            actions: vec![Box::new(move |tx3: &AppEventSender| {
                tx3.review(ReviewTarget::BaseBranch {
                    branch: current.clone(),
                });
            })],
            dismiss_on_select: true,
            search_value: Some(current),
            ..Default::default()
        });

        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some("Select an SVN base path".to_string()),
            footer_hint: Some(standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to search SVN paths".to_string()),
            ..Default::default()
        });
    }

    pub(crate) async fn show_review_commit_picker(&mut self, cwd: &Path) {
        if is_svn_working_copy(cwd) {
            self.show_svn_review_revision_picker(cwd).await;
            return;
        }

        let commits = recent_commits(cwd, /*limit*/ 100).await;

        let mut items: Vec<SelectionItem> = Vec::with_capacity(commits.len());
        for entry in commits {
            let subject = entry.subject.clone();
            let sha = entry.sha.clone();
            let search_val = format!("{subject} {sha}");

            items.push(SelectionItem {
                name: subject.clone(),
                actions: vec![Box::new(move |tx3: &AppEventSender| {
                    tx3.review(ReviewTarget::Commit {
                        sha: sha.clone(),
                        title: Some(subject.clone()),
                    });
                })],
                dismiss_on_select: true,
                search_value: Some(search_val),
                ..Default::default()
            });
        }

        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some("Select a commit to review".to_string()),
            footer_hint: Some(standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to search commits".to_string()),
            ..Default::default()
        });
    }

    /// Shows the SVN revision picker for a Subversion working copy.
    ///
    /// Runs `svn log` against the working copy and surfaces recent revisions
    /// as review targets. Revisions are identified by their number — the
    /// closest analogue to a commit hash in Subversion.
    async fn show_svn_review_revision_picker(&mut self, cwd: &Path) {
        let items = self.svn_recent_revisions(cwd).await;

        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some("Select an SVN revision to review".to_string()),
            footer_hint: Some(standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to search revisions".to_string()),
            ..Default::default()
        });
    }

    /// Collects recent Subversion revisions from `svn log` output.
    ///
    /// Parses the log to extract revision numbers and commit messages. The
    /// function is best-effort: a missing `svn` binary, a non-working copy, or
    /// a failed command all result in an empty list rather than a user-visible
    /// error.
    async fn svn_recent_revisions(&self, cwd: &Path) -> Vec<SelectionItem> {
        let Some(runner) = self.workspace_command_runner.clone() else {
            return Vec::new();
        };

        let command = WorkspaceCommand::new([
            "svn",
            "log",
            "--non-interactive",
            "--limit",
            "100",
        ])
        .cwd(cwd.to_path_buf())
        .disable_output_cap();
        let Ok(output) = runner.run(command).await else {
            return Vec::new();
        };
        if !output.success() {
            return Vec::new();
        }

        let mut items: Vec<SelectionItem> = Vec::new();
        let mut current_revision: Option<String> = None;
        for line in output.stdout.lines() {
            let trimmed = line.trim();
            if trimmed == "------------------------------------------------------------------------" {
                // Separator between log entries; reset the pending revision.
                current_revision = None;
                continue;
            }
            // `svn log` entry headers look like `r123 | author | date | lines`.
            if let Some(rest) = trimmed.strip_prefix('r')
                && let Some((revision, _)) = rest.split_once('|')
                && !revision.is_empty()
                && revision.chars().all(|ch| ch.is_ascii_digit())
            {
                current_revision = Some(revision.to_string());
                continue;
            }
            // The first non-metadata line after a revision header is the
            // commit message (or an empty line before it). Use it as the
            // picker title when present.
            if let Some(revision) = current_revision.take()
                && !trimmed.is_empty()
            {
                let message = trimmed.to_string();
                let revision_owned = revision.clone();
                items.push(SelectionItem {
                    name: format!("r{revision}: {message}"),
                    actions: vec![Box::new(move |tx3: &AppEventSender| {
                        tx3.review(ReviewTarget::Revision {
                            revision: revision_owned.clone(),
                            title: Some(message.clone()),
                        });
                    })],
                    dismiss_on_select: true,
                    search_value: Some(format!("r{revision} {message}")),
                    ..Default::default()
                });
            }
        }
        items
    }

    pub(crate) fn show_review_custom_prompt(&mut self) {
        let tx = self.app_event_tx.clone();
        let view = CustomPromptView::new(
            "Custom review instructions".to_string(),
            "Type instructions and press Enter".to_string(),
            /*initial_text*/ String::new(),
            /*context_label*/ None,
            Box::new(move |prompt: String| {
                let trimmed = prompt.trim().to_string();
                if trimmed.is_empty() {
                    return;
                }
                tx.review(ReviewTarget::Custom {
                    instructions: trimmed,
                });
            }),
        );
        self.bottom_pane.show_view(Box::new(view));
    }
}

#[cfg(test)]
pub(crate) fn show_review_commit_picker_with_entries(
    chat: &mut ChatWidget,
    entries: Vec<CommitLogEntry>,
) {
    let mut items: Vec<SelectionItem> = Vec::with_capacity(entries.len());
    for entry in entries {
        let subject = entry.subject.clone();
        let sha = entry.sha.clone();
        let search_val = format!("{subject} {sha}");

        items.push(SelectionItem {
            name: subject.clone(),
            actions: vec![Box::new(move |tx3: &AppEventSender| {
                tx3.review(ReviewTarget::Commit {
                    sha: sha.clone(),
                    title: Some(subject.clone()),
                });
            })],
            dismiss_on_select: true,
            search_value: Some(search_val),
            ..Default::default()
        });
    }

    chat.bottom_pane.show_selection_view(SelectionViewParams {
        title: Some("Select a commit to review".to_string()),
        footer_hint: Some(standard_popup_hint_line()),
        items,
        is_searchable: true,
        search_placeholder: Some("Type to search commits".to_string()),
        ..Default::default()
    });
}
