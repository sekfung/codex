//! Subversion working-copy inspection.
//!
//! Everything here reads through `svn info --show-item <field>`, which prints
//! exactly one value and nothing else. The alternative — parsing `svn info`'s
//! human-readable block, or its `--xml` output — is both more fragile and more
//! dependency-heavy for four scalars. `--show-item` arrived in Subversion 1.9
//! (2015); older clients report an unknown option and the probe degrades to
//! `None`, which is the same answer a non-working-copy gives.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

/// Matches `GIT_COMMAND_TIMEOUT` in `codex-git-utils`: metadata probes must not
/// hang a session on a slow or unreachable repository.
const SVN_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

/// One `svn info --show-item` field.
///
/// Every one of these is answered from the working copy's own administrative
/// area, so none of them contacts the server — which is what makes it safe to
/// run during session startup.
#[derive(Debug, Clone, Copy)]
enum InfoItem {
    Revision,
    ReposRootUrl,
    RelativeUrl,
}

impl InfoItem {
    fn as_arg(self) -> &'static str {
        match self {
            InfoItem::Revision => "revision",
            InfoItem::ReposRootUrl => "repos-root-url",
            InfoItem::RelativeUrl => "relative-url",
        }
    }
}

/// Metadata identifying what a Subversion working copy currently has checked
/// out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SvnInfo {
    /// The revision the working copy is at, as printed. Kept as a string
    /// rather than parsed: Subversion prints mixed-revision working copies as
    /// a range (`123:456`), and narrowing that to one number would report a
    /// state the checkout is not in.
    pub revision: Option<String>,
    /// Path within the repository, `^/` stripped — `trunk`,
    /// `branches/feature-x`. This is Subversion's nearest analogue to a branch
    /// name, and it is a path, not a ref.
    pub branch_path: Option<String>,
    /// Repository root URL, not the working copy's own URL.
    pub repository_url: Option<String>,
}

/// Reads Subversion metadata for `cwd`, or `None` if it is not a working copy.
pub async fn collect_svn_info(cwd: &Path) -> Option<SvnInfo> {
    // `relative-url` doubles as the working-copy probe: it is the field most
    // likely to be missing on an unsupported client, so if it answers, the
    // other two will too.
    let branch_path = show_item(cwd, InfoItem::RelativeUrl)
        .await
        .map(|value| strip_relative_url_marker(&value).to_string());
    branch_path.as_ref()?;

    Some(SvnInfo {
        revision: show_item(cwd, InfoItem::Revision).await,
        repository_url: show_item(cwd, InfoItem::ReposRootUrl).await,
        branch_path,
    })
}

/// Subversion prints repository-relative URLs with a `^/` sentinel meaning
/// "repository root". It is punctuation, not part of the path.
fn strip_relative_url_marker(value: &str) -> &str {
    value.trim().strip_prefix("^/").unwrap_or(value.trim())
}

async fn show_item(cwd: &Path, item: InfoItem) -> Option<String> {
    let output = timeout(
        SVN_COMMAND_TIMEOUT,
        Command::new("svn")
            .args(["info", "--show-item", item.as_arg()])
            // A metadata probe must never block waiting for credentials or a
            // certificate confirmation on a terminal nobody is watching.
            .arg("--non-interactive")
            .current_dir(cwd)
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
#[path = "svn_tests.rs"]
mod tests;
