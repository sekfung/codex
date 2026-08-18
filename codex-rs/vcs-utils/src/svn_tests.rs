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
