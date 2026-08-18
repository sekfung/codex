use super::*;
use pretty_assertions::assert_eq;

#[test]
fn review_prompt_template_renders_base_branch_backup_variant() {
    assert_eq!(
        render_review_prompt(&BASE_BRANCH_PROMPT_BACKUP_TEMPLATE, [("branch", "main")]),
        "Review the code changes against the base branch 'main'. Start by finding the merge diff between the current branch and main's upstream e.g. (`git merge-base HEAD \"$(git rev-parse --abbrev-ref \"main@{upstream}\")\"`), then run `git diff` against that SHA to see what changes we would merge into the main branch. Provide prioritized, actionable findings."
    );
}

#[test]
fn review_prompt_template_renders_base_branch_variant() {
    assert_eq!(
        render_review_prompt(
            &BASE_BRANCH_PROMPT_TEMPLATE,
            [("base_branch", "main"), ("merge_base_sha", "abc123")]
        ),
        "Review the code changes against the base branch 'main'. The merge base commit for this comparison is abc123. Run `git diff abc123` to inspect the changes relative to main. Provide prioritized, actionable findings."
    );
}

#[test]
fn review_prompt_template_renders_commit_variant() {
    assert_eq!(
        review_prompt(
            &ReviewTarget::Commit {
                sha: "deadbeef".to_string(),
                title: None,
            },
            &AbsolutePathBuf::current_dir().expect("cwd"),
        )
        .expect("commit prompt should render"),
        "Review the code changes introduced by commit deadbeef. Provide prioritized, actionable findings."
    );
}

#[test]
fn review_prompt_template_renders_commit_variant_with_title() {
    assert_eq!(
        review_prompt(
            &ReviewTarget::Commit {
                sha: "deadbeef".to_string(),
                title: Some("Fix bug".to_string()),
            },
            &AbsolutePathBuf::current_dir().expect("cwd"),
        )
        .expect("commit prompt should render"),
        "Review the code changes introduced by commit deadbeef (\"Fix bug\"). Provide prioritized, actionable findings."
    );
}

fn abs(path: &std::path::Path) -> AbsolutePathBuf {
    AbsolutePathBuf::from_absolute_path(path).expect("absolute path")
}

/// The whole point of the separate variant: a revision reaches the model as a
/// revision, with the command that actually reads one.
#[test]
fn revision_prompt_names_svn_and_its_command() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prompt = review_prompt(
        &ReviewTarget::Revision {
            revision: "12345".to_string(),
            title: None,
        },
        &abs(tmp.path()),
    )
    .expect("renders");

    assert!(prompt.contains("Subversion revision 12345"), "{prompt}");
    assert!(prompt.contains("svn diff -c 12345"), "{prompt}");
    assert!(!prompt.contains("git "), "{prompt}");
}

#[test]
fn revision_prompt_includes_the_title_when_given() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let prompt = review_prompt(
        &ReviewTarget::Revision {
            revision: "12345".to_string(),
            title: Some("Fix the parser".to_string()),
        },
        &abs(tmp.path()),
    )
    .expect("renders");

    assert!(prompt.contains("\"Fix the parser\""), "{prompt}");
}

/// A base-branch review in a Subversion working copy must not instruct the
/// model to run `git merge-base` and `git diff`, which is what the shared
/// variant rendered before the working copy was detected.
#[test]
fn base_branch_in_an_svn_working_copy_does_not_emit_git_commands() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(tmp.path().join(".svn")).expect("create .svn");

    let prompt = review_prompt(
        &ReviewTarget::BaseBranch {
            branch: "^/trunk".to_string(),
        },
        &abs(tmp.path()),
    )
    .expect("renders");

    assert!(prompt.contains("svn diff ^/trunk"), "{prompt}");
    assert!(!prompt.contains("git "), "{prompt}");
}

/// Documents what a Subversion working copy used to get, and why the branch
/// above is a fix rather than a nicety: outside a git repository
/// `merge_base_with_head` errors instead of returning `None`, so the review
/// never started at all.
#[test]
fn base_branch_outside_any_repository_still_errors() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let err = review_prompt(
        &ReviewTarget::BaseBranch {
            branch: "main".to_string(),
        },
        &abs(tmp.path()),
    )
    .expect_err("a bare directory has no base branch to compare against");

    assert!(err.to_string().contains("not a git repository"), "{err}");
}

#[test]
fn revision_hint_reads_as_a_revision() {
    assert_eq!(
        user_facing_hint(&ReviewTarget::Revision {
            revision: "12345".to_string(),
            title: None,
        }),
        "r12345"
    );
    assert_eq!(
        user_facing_hint(&ReviewTarget::Revision {
            revision: "12345".to_string(),
            title: Some("Fix the parser".to_string()),
        }),
        "r12345: Fix the parser"
    );
}
