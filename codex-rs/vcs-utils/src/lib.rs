//! Version-control metadata that is not specific to one system.
//!
//! `codex-git-utils` answers git questions and should keep doing so. This crate
//! sits above it and answers the question callers actually have — "what project
//! is this, and what does it currently have checked out" — for git or
//! Subversion.
//!
//! It exists as its own crate because the two consumers that need it,
//! `codex-thread-store` and `codex-rollout`, sit below `codex-core` and cannot
//! reach anything there; and because putting Subversion code inside a crate
//! named `git-utils` would be the wrong home for it.

pub mod svn;

use std::path::Path;

use codex_file_system::FindUpErrorPolicy;
use codex_file_system::find_nearest_native_ancestor_with_markers;
use codex_git_utils::collect_git_info;
use codex_git_utils::resolve_root_git_project_for_trust;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;

pub use svn::SvnInfo;
pub use svn::collect_svn_info;
pub use svn::is_svn_working_copy;

/// Which version control system claimed a directory.
///
/// Defined in `codex-protocol` because it is a persisted discriminator written
/// into rollout files and thread metadata; re-exported here so callers of this
/// crate have one import.
pub use codex_protocol::protocol::VcsKind;

/// Presentation helpers for [`VcsKind`]. These are this crate's concern rather
/// than the protocol's — the protocol defines what is stored, not how it reads.
pub trait VcsKindLabels {
    /// How to name this when heading a group of threads.
    fn label(self) -> &'static str;
    /// Qualifier for the "<X> root:" / "<X> project:" context lines.
    ///
    /// Git keeps the exact wording it had before Subversion was supported, so
    /// the prompt a git user's model sees is unchanged.
    fn short_name(self) -> &'static str;
}

impl VcsKindLabels for VcsKind {
    fn label(self) -> &'static str {
        match self {
            VcsKind::Git => "Git repo",
            VcsKind::Subversion => "SVN working copy",
        }
    }

    fn short_name(self) -> &'static str {
        match self {
            VcsKind::Git => "Git",
            VcsKind::Subversion => "SVN",
        }
    }
}

/// A resolved project root and the system that identified it.
#[derive(Debug, Clone)]
pub struct ProjectRoot {
    pub path: AbsolutePathBuf,
    pub vcs: VcsKind,
}

/// What a working copy or checkout currently has, in system-neutral terms.
///
/// The three fields are deliberately the same three git already recorded, so
/// the persisted shape does not change — only its interpretation, which `vcs`
/// now states rather than leaving implied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VcsInfo {
    pub vcs: VcsKind,
    /// Git: commit SHA. Subversion: revision, possibly a `123:456` range for a
    /// mixed-revision working copy.
    pub revision: Option<String>,
    /// Git: branch name. Subversion: repository-relative path (`trunk`,
    /// `branches/feature-x`), which is the nearest analogue and is a path
    /// rather than a ref.
    pub branch: Option<String>,
    /// Git: remote URL. Subversion: repository root URL.
    pub repository_url: Option<String>,
}

/// Resolves the project root for trust and grouping, trying git then Subversion.
///
/// Git is tried first because only its resolver follows the `gitdir:` pointer
/// that worktrees need — work with no Subversion analogue that must not be
/// attempted against a `.svn` marker. Where both markers are present, git wins
/// for the same reason.
pub async fn resolve_root_project_for_trust(
    fs: &dyn codex_file_system::ExecutorFileSystem,
    cwd: &AbsolutePathBuf,
) -> Option<ProjectRoot> {
    if let Some(path) = resolve_root_git_project_for_trust(fs, cwd).await {
        return Some(ProjectRoot {
            path,
            vcs: VcsKind::Git,
        });
    }
    resolve_svn_working_copy_root(fs, cwd)
        .await
        .map(|path| ProjectRoot {
            path,
            vcs: VcsKind::Subversion,
        })
}

/// The root of the Subversion working copy containing `cwd`, if any.
///
/// Subversion 1.7 (2011) consolidated what had been a `.svn` directory in every
/// working-copy subdirectory into a single one at the root, so the *nearest*
/// ancestor carrying the marker is the root — the same search git needs, with a
/// different marker.
///
/// Nearest is also the right answer where working copies nest, which is what an
/// `svn:externals` checkout produces: the inner copy is genuinely its own, and
/// grouping it under the outer one would misreport it.
///
/// Pre-1.7 working copies, where every directory carries `.svn`, therefore
/// resolve to the immediate directory rather than the true root. Those have
/// needed `svn upgrade` to be touched at all for over a decade, so the case is
/// noted rather than handled.
pub async fn resolve_svn_working_copy_root(
    fs: &dyn codex_file_system::ExecutorFileSystem,
    cwd: &AbsolutePathBuf,
) -> Option<AbsolutePathBuf> {
    let cwd_uri = PathUri::from_abs_path(cwd);
    let base = match fs.get_metadata(&cwd_uri, /*sandbox*/ None).await {
        Ok(metadata) if metadata.is_directory => cwd.clone(),
        _ => cwd.parent()?,
    };

    let root = find_nearest_native_ancestor_with_markers(
        fs,
        &base,
        vec![".svn".to_string()],
        FindUpErrorPolicy::Ignore,
        /*sandbox*/ None,
    )
    .await
    .ok()??;

    // `.svn` is a directory in every Subversion version shipping today. A file
    // wearing that name is something else, and treating it as a working copy
    // would group unrelated directories under one root.
    let marker_uri = PathUri::from_abs_path(&root.join(".svn"));
    fs.get_metadata(&marker_uri, /*sandbox*/ None)
        .await
        .ok()?
        .is_directory
        .then_some(root)
}

/// Collects checkout metadata for `cwd`, trying git then Subversion.
///
/// Ordered to match [`resolve_root_project_for_trust`] so a directory carrying
/// both markers reports the same system from both calls; a record whose `vcs`
/// disagreed with its own project root would be worse than no record.
pub async fn collect_vcs_info(cwd: &Path) -> Option<VcsInfo> {
    if let Some(git) = collect_git_info(cwd).await {
        return Some(VcsInfo {
            vcs: VcsKind::Git,
            revision: git.commit_hash.map(|sha| sha.0),
            branch: git.branch,
            repository_url: git.repository_url,
        });
    }

    collect_svn_info(cwd).await.map(|info| VcsInfo {
        vcs: VcsKind::Subversion,
        revision: info.revision,
        branch: info.branch_path,
        repository_url: info.repository_url,
    })
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
