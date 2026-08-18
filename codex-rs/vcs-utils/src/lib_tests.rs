use super::*;
use pretty_assertions::assert_eq;

/// An absent discriminator must read as Git. Every record written before
/// Subversion was supported came from a git-only build, so this is a true
/// statement about existing data rather than a fallback.
#[test]
fn absent_discriminator_reads_as_git() {
    assert_eq!(VcsKind::default(), VcsKind::Git);
    assert_eq!(
        serde_json::from_str::<VcsKind>("\"git\"").expect("deserialize"),
        VcsKind::Git
    );
    assert_eq!(
        serde_json::from_str::<VcsKind>("\"subversion\"").expect("deserialize"),
        VcsKind::Subversion
    );
}

/// The persisted spelling is the contract for records read back by other
/// builds, so pin it.
#[test]
fn discriminator_is_snake_case_on_the_wire() {
    assert_eq!(
        serde_json::to_string(&VcsKind::Subversion).expect("serialize"),
        "\"subversion\""
    );
    assert_eq!(
        serde_json::to_string(&VcsKind::Git).expect("serialize"),
        "\"git\""
    );
}

#[test]
fn labels_name_the_system_that_answered() {
    assert_eq!(VcsKind::Git.label(), "Git repo");
    assert_eq!(VcsKind::Subversion.label(), "SVN working copy");
    assert_eq!(VcsKind::Git.short_name(), "Git");
    assert_eq!(VcsKind::Subversion.short_name(), "SVN");
}

#[tokio::test]
async fn plain_directory_has_no_vcs_info() {
    let tmp = tempfile::tempdir().expect("tempdir");
    assert_eq!(collect_vcs_info(tmp.path()).await, None);
}
