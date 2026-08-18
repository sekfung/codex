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
            vcs: PickerVcs::None,
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

/// A Subversion working copy is not a git repo, but it is not "nothing"
/// either: the picker needs to know to offer the revision target, which is the
/// only one the engine can run there.
#[tokio::test]
async fn svn_working_copy_is_reported_as_subversion() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(tmp.path().join(".svn")).expect("create .svn");

    let refs = git_refs(tmp.path().to_string_lossy().into_owned())
        .await
        .expect("git_refs");

    assert_eq!(refs.vcs, PickerVcs::Subversion);
    assert!(!refs.is_git_repo);
    assert!(refs.branches.is_empty());
}
