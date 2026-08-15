//! Version-control-agnostic project-root resolution.
//!
//! `resolve_root_git_project_for_trust` answers "which directory is the project
//! that contains this path", but only for git. Every caller of it wants the
//! project, not specifically a git project — so an SVN working copy silently
//! degraded to bare-`cwd` behaviour: no trust grouping across its
//! subdirectories, and a narrower workspace tree than the equivalent git
//! checkout renders.
//!
//! This resolves the same question for both, and reports which one answered so
//! callers that label the result can say what they actually found.

use codex_exec_server::LOCAL_FS;
use codex_file_system::FindUpErrorPolicy;
use codex_file_system::find_nearest_native_ancestor_with_markers;
use codex_git_utils::resolve_root_git_project_for_trust;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;

/// Which version control system claimed a directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VcsKind {
    Git,
    Subversion,
}

impl VcsKind {
    /// How to name this when heading a group of threads.
    pub fn label(self) -> &'static str {
        match self {
            VcsKind::Git => "Git repo",
            VcsKind::Subversion => "SVN working copy",
        }
    }

    /// Qualifier for the "<X> root:" / "<X> project:" context lines.
    ///
    /// Git keeps the exact wording it had before Subversion was resolved here,
    /// so the prompt a git user's model sees is unchanged.
    pub fn short_name(self) -> &'static str {
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

/// Resolves the project root for trust and grouping purposes, trying git first
/// and then Subversion.
///
/// Git is tried first because its resolver handles worktrees, which requires
/// reading `.git` as a file and following the `gitdir:` pointer — work that has
/// no Subversion analogue and should not be attempted against a `.svn` marker.
pub async fn resolve_root_project_for_trust(cwd: &AbsolutePathBuf) -> Option<ProjectRoot> {
    if let Some(path) = resolve_root_git_project_for_trust(LOCAL_FS.as_ref(), cwd).await {
        return Some(ProjectRoot {
            path,
            vcs: VcsKind::Git,
        });
    }
    resolve_svn_working_copy_root(cwd)
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
/// `svn:externals` checkout produces: the inner copy is genuinely its own
/// working copy, and grouping it under the outer one would misreport it.
///
/// Pre-1.7 working copies, where every directory carries `.svn`, therefore
/// resolve to the immediate directory rather than the true root. Those have been
/// unreadable by supported `svn` clients for over a decade — an `svn upgrade` is
/// required to touch them at all — so the case is noted rather than handled.
async fn resolve_svn_working_copy_root(cwd: &AbsolutePathBuf) -> Option<AbsolutePathBuf> {
    let fs = LOCAL_FS.as_ref();
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

    // `.svn` is a directory in every Subversion version that ships today. A
    // file by that name is something else wearing the name, and treating it as
    // a working copy would group unrelated directories together.
    let marker_uri = PathUri::from_abs_path(&root.join(".svn"));
    fs.get_metadata(&marker_uri, /*sandbox*/ None)
        .await
        .ok()?
        .is_directory
        .then_some(root)
}

#[cfg(test)]
#[path = "project_root_tests.rs"]
mod tests;
