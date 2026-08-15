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
