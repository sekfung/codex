use super::*;
use pretty_assertions::assert_eq;

/// `^/` is Subversion's sentinel for "repository root", not part of the path.
#[test]
fn relative_url_marker_is_stripped() {
    assert_eq!(strip_relative_url_marker("^/trunk"), "trunk");
    assert_eq!(
        strip_relative_url_marker("^/branches/feature-x"),
        "branches/feature-x"
    );
    assert_eq!(strip_relative_url_marker("  ^/trunk\n"), "trunk");
}

/// A value without the sentinel is passed through rather than mangled.
#[test]
fn a_value_without_the_marker_is_left_alone() {
    assert_eq!(strip_relative_url_marker("trunk"), "trunk");
    assert_eq!(strip_relative_url_marker(""), "");
}

/// A plain directory is not a working copy, and the probe must say so rather
/// than erroring — the caller treats `None` as "no version control here".
#[tokio::test]
async fn plain_directory_yields_no_svn_info() {
    let tmp = tempfile::tempdir().expect("tempdir");
    assert_eq!(collect_svn_info(tmp.path()).await, None);
}

/// The synchronous root resolver finds the nearest ancestor carrying a `.svn`
/// directory, matching the async resolver's rule.
#[test]
fn sync_root_resolver_finds_the_working_copy_root() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir(tmp.path().join(".svn")).expect("create .svn");
    let nested = tmp.path().join("sub");
    std::fs::create_dir(&nested).expect("create subdirectory");

    assert_eq!(
        resolve_svn_working_copy_root_sync(&nested),
        Some(tmp.path().to_path_buf())
    );
    assert_eq!(
        resolve_svn_working_copy_root_sync(tmp.path()),
        Some(tmp.path().to_path_buf())
    );
}

/// A directory without `.svn` markers resolves to `None`.
#[test]
fn sync_root_resolver_returns_none_without_a_working_copy() {
    let tmp = tempfile::tempdir().expect("tempdir");
    assert_eq!(resolve_svn_working_copy_root_sync(tmp.path()), None);
}

/// A file named `.svn` is not a working-copy marker; only a directory counts.
#[test]
fn sync_root_resolver_ignores_a_file_named_svn() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::write(tmp.path().join(".svn"), "not a marker").expect("write .svn file");

    assert_eq!(resolve_svn_working_copy_root_sync(tmp.path()), None);
}
