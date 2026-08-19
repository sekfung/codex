#![allow(clippy::expect_used)]

use super::*;
use pretty_assertions::assert_eq;

/// The `-c` overrides are the part that makes `/diff` informational; an
/// approximation here would silently run repository hooks or filter
/// helpers, so the exact command line is pinned against
/// `tui/src/get_git_diff.rs`.
#[test]
fn git_argv_carries_the_tui_config_overrides() {
    let argv = git_argv(FsmonitorOverride::Disabled, &["rev-parse"]);
    assert_eq!(
        argv,
        vec![
            "git".to_string(),
            "-c".to_string(),
            "safe.bareRepository=explicit".to_string(),
            "-c".to_string(),
            "core.fsmonitor=false".to_string(),
            "-c".to_string(),
            DISABLE_HOOKS_CONFIG.to_string(),
            "rev-parse".to_string(),
        ]
    );
}

/// The probe runs before the override is known, so it must not assert one.
#[test]
fn probe_argv_omits_the_fsmonitor_override() {
    assert_eq!(
        probe_argv(&["config", "--get", "core.fsmonitor"]),
        vec![
            "git".to_string(),
            "-c".to_string(),
            "safe.bareRepository=explicit".to_string(),
            "config".to_string(),
            "--get".to_string(),
            "core.fsmonitor".to_string(),
        ]
    );
}

#[test]
fn builtin_fsmonitor_override_is_propagated() {
    let argv = git_argv(FsmonitorOverride::BuiltIn, &["status"]);
    assert!(argv.contains(&"core.fsmonitor=true".to_string()));
}

/// `--null --name-only` yields NUL-separated keys; each driver must be
/// neutralised on both entry points and marked not-required so git does
/// not error once the driver is disabled.
#[test]
fn filter_overrides_neutralise_each_driver() {
    let stdout = "filter.lfs.clean\0filter.lfs.process\0filter.crypt.clean\0";
    assert_eq!(
        filter_config_overrides_from_stdout(stdout),
        vec![
            ("filter.crypt.clean".to_string(), String::new()),
            ("filter.crypt.process".to_string(), String::new()),
            ("filter.crypt.required".to_string(), "false".to_string()),
            ("filter.lfs.clean".to_string(), String::new()),
            ("filter.lfs.process".to_string(), String::new()),
            ("filter.lfs.required".to_string(), "false".to_string()),
        ]
    );
}

#[test]
fn filter_overrides_are_empty_without_drivers() {
    assert_eq!(filter_config_overrides_from_stdout(""), Vec::new());
    assert!(config_override_env(&[]).is_empty());
}

/// Git reads the overrides from a counted env sequence; a wrong count
/// silently drops the tail.
#[test]
fn config_override_env_is_a_counted_sequence() {
    let env = config_override_env(&[
        ("filter.lfs.clean".to_string(), String::new()),
        ("filter.lfs.required".to_string(), "false".to_string()),
    ]);
    assert_eq!(env.get("GIT_CONFIG_COUNT"), Some(&Some("2".to_string())));
    assert_eq!(
        env.get("GIT_CONFIG_KEY_0"),
        Some(&Some("filter.lfs.clean".to_string()))
    );
    assert_eq!(env.get("GIT_CONFIG_VALUE_0"), Some(&Some(String::new())));
    assert_eq!(
        env.get("GIT_CONFIG_KEY_1"),
        Some(&Some("filter.lfs.required".to_string()))
    );
    assert_eq!(
        env.get("GIT_CONFIG_VALUE_1"),
        Some(&Some("false".to_string()))
    );
}

#[test]
fn untracked_listing_is_split_and_trimmed() {
    assert_eq!(
        untracked_paths("a.txt\n  b/c.txt  \n\n"),
        vec!["a.txt", "b/c.txt"]
    );
}

/// `--no-index` against the null device is what renders a brand-new file
/// as an addition rather than omitting it.
#[test]
fn untracked_diff_compares_against_the_null_device() {
    let args = untracked_diff_args("new.txt");
    assert_eq!(args.last(), Some(&"new.txt"));
    assert!(args.contains(&"--no-index"));
    assert!(args.contains(&null_device()));
}

/// The frontend switches on these strings (`RemoteDiffUnavailable` in
/// `types.ts`), so their camelCase spelling is the contract — a rename here
/// would silently turn both empty states into "no answer at all".
#[test]
fn remote_diff_unavailable_reasons_are_camel_case_on_the_wire() {
    assert_eq!(
        serde_json::to_value(RemoteDiffUnavailable::NotAGitRepo).expect("serialize"),
        serde_json::json!("notAGitRepo")
    );
    assert_eq!(
        serde_json::to_value(RemoteDiffUnavailable::NoRemote).expect("serialize"),
        serde_json::json!("noRemote")
    );
}

/// An available comparison must send `unavailable: null` rather than omitting
/// the field: the UI treats "absent reason" as the signal that `sha` and
/// `diff` are meaningful, and a missing key would read the same as an error.
#[test]
fn available_remote_diff_states_its_absence_of_reason() {
    let json = serde_json::to_value(RemoteDiffResult {
        unavailable: None,
        sha: "abc1234".to_string(),
        diff: "diff --git a/x b/x\n".to_string(),
    })
    .expect("serialize");

    assert_eq!(
        json,
        serde_json::json!({
            "unavailable": null,
            "sha": "abc1234",
            "diff": "diff --git a/x b/x\n",
        })
    );
}

/// Binary files come back as `-\t-\t<path>`. They must contribute zero rather
/// than aborting the sum, which is what an unwrapped parse would do.
#[test]
fn numstat_sum_skips_binary_files() {
    let stats = sum_numstat("12\t3\tsrc/a.rs\n-\t-\timg.png\n4\t0\tsrc/b.rs\n");
    assert_eq!(
        stats,
        BranchChangeStats {
            additions: 16,
            deletions: 3,
        }
    );
}

/// An empty range produces empty stdout, which is a real answer (no commits
/// on this branch yet) and must read as zero rather than as a parse failure.
#[test]
fn numstat_sum_of_nothing_is_zero() {
    assert_eq!(sum_numstat(""), BranchChangeStats::default());
}
