//! Version-control-agnostic project-root resolution for `realtime_context`.
//!
//! The resolution itself lives in `codex-vcs-utils`, which sits low enough for
//! `codex-thread-store` and `codex-rollout` to share it. This module is only the
//! binding that supplies this crate's filesystem.

use codex_exec_server::LOCAL_FS;
use codex_utils_absolute_path::AbsolutePathBuf;
pub use codex_vcs_utils::ProjectRoot;

/// Resolves the project root for trust and grouping, trying git then Subversion.
pub async fn resolve_root_project_for_trust(cwd: &AbsolutePathBuf) -> Option<ProjectRoot> {
    codex_vcs_utils::resolve_root_project_for_trust(LOCAL_FS.as_ref(), cwd).await
}

#[cfg(test)]
#[path = "project_root_tests.rs"]
mod tests;
