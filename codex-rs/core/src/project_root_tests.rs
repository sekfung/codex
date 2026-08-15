use super::*;
use pretty_assertions::assert_eq;

fn abs(path: &std::path::Path) -> AbsolutePathBuf {
    AbsolutePathBuf::from_absolute_path(path).expect("absolute path")
}

#[tokio::test]
async fn plain_directory_has_no_project_root() {
    let tmp = tempfile::tempdir().expect("tempdir");
    assert!(
        resolve_root_project_for_trust(&abs(tmp.path()))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn svn_working_copy_root_is_found_from_a_subdirectory() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("wc");
    let nested = root.join("src").join("deep");
    std::fs::create_dir_all(root.join(".svn")).expect("create .svn");
    std::fs::create_dir_all(&nested).expect("create nested");

    let resolved = resolve_root_project_for_trust(&abs(&nested))
        .await
        .expect("resolves");

    assert_eq!(resolved.vcs, VcsKind::Subversion);
    assert_eq!(
        resolved
            .path
            .as_path()
            .canonicalize()
            .expect("canonicalize"),
        root.canonicalize().expect("canonicalize")
    );
}

/// Git is tried first, so a directory carrying both markers reports Git — which
/// matters because only the git resolver understands worktrees.
#[tokio::test]
async fn git_wins_when_both_markers_are_present() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(tmp.path().join(".git")).expect("create .git");
    std::fs::create_dir_all(tmp.path().join(".svn")).expect("create .svn");

    let resolved = resolve_root_project_for_trust(&abs(tmp.path()))
        .await
        .expect("resolves");

    assert_eq!(resolved.vcs, VcsKind::Git);
}

/// A *file* named `.svn` is not a working copy. Accepting it would group every
/// sibling directory under an unrelated root.
#[tokio::test]
async fn a_file_named_dot_svn_is_not_a_working_copy() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::write(tmp.path().join(".svn"), b"not a working copy").expect("write");

    assert!(
        resolve_root_project_for_trust(&abs(tmp.path()))
            .await
            .is_none()
    );
}

/// Nested working copies are what `svn:externals` produces; the inner one is
/// genuinely its own copy and must not be reported as the outer one.
#[tokio::test]
async fn nested_working_copy_resolves_to_the_inner_root() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let outer = tmp.path();
    let inner = outer.join("vendor").join("lib");
    std::fs::create_dir_all(outer.join(".svn")).expect("create outer .svn");
    std::fs::create_dir_all(inner.join(".svn")).expect("create inner .svn");

    let resolved = resolve_root_project_for_trust(&abs(&inner))
        .await
        .expect("resolves");

    assert_eq!(
        resolved
            .path
            .as_path()
            .canonicalize()
            .expect("canonicalize"),
        inner.canonicalize().expect("canonicalize")
    );
}

#[test]
fn labels_name_the_system_that_answered() {
    assert_eq!(VcsKind::Git.label(), "Git repo");
    assert_eq!(VcsKind::Subversion.label(), "SVN working copy");
}
