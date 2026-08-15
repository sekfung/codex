//! Working-tree git diff, the desktop counterpart of the TUI's `/diff`.
//!
//! Every git invocation goes through the app-server `command/exec` RPC rather
//! than `std::process::Command`. That is not incidental: `command/exec`
//! "leaves sandbox and permission profile selection to app-server so the same
//! runner follows the active session's embedded or remote execution policy"
//! (`tui/src/workspace_command.rs`). Spawning git here would bypass the
//! session's sandbox and reimplement engine behavior, which ADR-0021 forbids.
//!
//! The command construction is ported from `tui/src/get_git_diff.rs` rather
//! than approximated, because the details are load-bearing: untracked files
//! need a second pass, repository hooks and executable filter drivers must not
//! run for what is an informational read, and the fsmonitor override has to be
//! probed rather than assumed. `codex_git_utils` owns the probe policy — the
//! same split the TUI uses, where git-utils holds the policy and each surface
//! keeps its own execution adapter.

use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::CommandExecParams;
use codex_app_server_protocol::CommandExecResponse;
use codex_git_utils::FsmonitorOverride;
use codex_git_utils::FsmonitorProbeRunner;
use codex_git_utils::detect_fsmonitor_override;
use serde::Serialize;
use tauri::State;

use crate::bridge::AppServerBridge;

/// Matches `DIFF_COMMAND_TIMEOUT` in `tui/src/get_git_diff.rs`.
const DIFF_COMMAND_TIMEOUT_MS: i64 = 30_000;

/// Points git's hook path at the null device so an informational read cannot
/// trigger repository-supplied hooks.
const DISABLE_HOOKS_CONFIG: &str = if cfg!(windows) {
    "core.hooksPath=NUL"
} else {
    "core.hooksPath=/dev/null"
};

/// Config keys naming filter drivers that would execute a helper program.
const EXECUTABLE_FILTER_CONFIG_PATTERN: &str = r"^filter\..*\.(clean|process)$";

fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

/// Result of a `/diff` run, mirroring `get_git_diff`'s `(bool, String)`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    /// False when `cwd` is not inside a git work tree. The UI says so rather
    /// than showing an empty diff, which would read as "no changes".
    pub is_git_repo: bool,
    /// Concatenated tracked and untracked diff, may be empty.
    pub diff: String,
}

/// Captured output of one `command/exec` call.
struct ExecOutput {
    exit_code: i32,
    stdout: String,
}

impl ExecOutput {
    fn success(&self) -> bool {
        self.exit_code == 0
    }
}

/// Builds the argv for one git invocation.
///
/// Kept separate from execution so tests can pin the exact command line. The
/// leading `-c` overrides are what keep `/diff` informational: a safe
/// bare-repository policy, the probed fsmonitor setting, and disabled hooks.
fn git_argv(fsmonitor: FsmonitorOverride, args: &[&str]) -> Vec<String> {
    ["git", "-c", codex_git_utils::SAFE_BARE_REPOSITORY_CONFIG]
        .into_iter()
        .chain(["-c", fsmonitor.git_config_arg(), "-c", DISABLE_HOOKS_CONFIG])
        .chain(args.iter().copied())
        .map(str::to_string)
        .collect()
}

/// Argv for the fsmonitor probe.
///
/// The probe runs before the override is known, so unlike [`git_argv`] it
/// carries only the bare-repository guard — matching
/// `WorkspaceFsmonitorProbeRunner` in the TUI.
fn probe_argv(args: &[&str]) -> Vec<String> {
    ["git", "-c", codex_git_utils::SAFE_BARE_REPOSITORY_CONFIG]
        .into_iter()
        .chain(args.iter().copied())
        .map(str::to_string)
        .collect()
}

/// Turns discovered filter drivers into env-based config overrides.
///
/// Git reads `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs counted by
/// `GIT_CONFIG_COUNT`; the TUI uses the same mechanism so the neutralised
/// values cannot be re-overridden by repository config.
fn config_override_env(overrides: &[(String, String)]) -> HashMap<String, Option<String>> {
    let mut env = HashMap::new();
    if overrides.is_empty() {
        return env;
    }
    env.insert(
        "GIT_CONFIG_COUNT".to_string(),
        Some(overrides.len().to_string()),
    );
    for (index, (key, value)) in overrides.iter().enumerate() {
        env.insert(format!("GIT_CONFIG_KEY_{index}"), Some(key.clone()));
        env.insert(format!("GIT_CONFIG_VALUE_{index}"), Some(value.clone()));
    }
    env
}

/// Neutralising overrides for every filter driver that would run a program.
///
/// Ported from `diff_filter_config_overrides`: `--null --name-only` output is
/// NUL-separated keys, and each driver contributes empty `clean`/`process`
/// commands plus `required=false` so git does not fail when the driver is
/// disabled.
fn filter_config_overrides_from_stdout(stdout: &str) -> Vec<(String, String)> {
    let mut drivers = stdout
        .split('\0')
        .filter_map(|key| {
            key.strip_suffix(".clean")
                .or_else(|| key.strip_suffix(".process"))
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    drivers.sort();
    drivers.dedup();

    drivers
        .into_iter()
        .flat_map(|driver| {
            [
                (format!("{driver}.clean"), String::new()),
                (format!("{driver}.process"), String::new()),
                (format!("{driver}.required"), "false".to_string()),
            ]
        })
        .collect()
}

/// Splits `git ls-files --others` output into file paths.
fn untracked_paths(stdout: &str) -> Vec<&str> {
    stdout
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect()
}

/// Argv for diffing one untracked file against the null device.
fn untracked_diff_args<'a>(file: &'a str) -> Vec<&'a str> {
    vec![
        "diff",
        "--no-textconv",
        "--no-ext-diff",
        "--submodule=short",
        "--ignore-submodules=dirty",
        "--color",
        "--no-index",
        "--",
        null_device(),
        file,
    ]
}

/// Argv for the tracked-changes diff.
fn tracked_diff_args() -> Vec<&'static str> {
    vec![
        "diff",
        "--no-textconv",
        "--no-ext-diff",
        "--submodule=short",
        "--ignore-submodules=dirty",
        "--color",
    ]
}

/// Runs one command through app-server and captures its output.
async fn exec(
    bridge: &AppServerBridge,
    argv: Vec<String>,
    cwd: &Path,
    env: HashMap<String, Option<String>>,
) -> Result<ExecOutput, String> {
    let response = bridge
        .request(ClientRequest::OneOffCommandExec {
            request_id: bridge.next_request_id(),
            params: CommandExecParams {
                command: argv,
                process_id: None,
                tty: false,
                stream_stdin: false,
                stream_stdout_stderr: false,
                // A diff is a full user-visible payload, so it opts out of
                // capping the way the TUI's `/diff` does; every other
                // workspace command keeps the cap.
                output_bytes_cap: None,
                disable_output_cap: true,
                disable_timeout: false,
                timeout_ms: Some(DIFF_COMMAND_TIMEOUT_MS),
                cwd: Some(PathBuf::from(cwd)),
                env: (!env.is_empty()).then_some(env),
                size: None,
                sandbox_policy: None,
                permission_profile: None,
            },
        })
        .await?;

    let response: CommandExecResponse =
        serde_json::from_value(response).map_err(|err| format!("command/exec: {err}"))?;
    Ok(ExecOutput {
        exit_code: response.exit_code,
        stdout: response.stdout,
    })
}

/// Probe runner that routes fsmonitor detection through app-server.
struct BridgeProbeRunner<'a> {
    bridge: &'a AppServerBridge,
    cwd: &'a Path,
}

impl FsmonitorProbeRunner for BridgeProbeRunner<'_> {
    async fn run_probe(&mut self, args: &[&str]) -> Option<Vec<u8>> {
        match exec(self.bridge, probe_argv(args), self.cwd, HashMap::new()).await {
            Ok(output) if output.success() => Some(output.stdout.into_bytes()),
            _ => None,
        }
    }
}

/// Runs git and returns stdout, treating any non-zero exit as an error.
async fn capture_stdout(
    bridge: &AppServerBridge,
    cwd: &Path,
    fsmonitor: FsmonitorOverride,
    args: &[&str],
) -> Result<String, String> {
    let output = exec(bridge, git_argv(fsmonitor, args), cwd, HashMap::new()).await?;
    if output.success() {
        Ok(output.stdout)
    } else {
        Err(format!(
            "git {args:?} failed with status {}",
            output.exit_code
        ))
    }
}

/// Runs a git diff and returns stdout.
///
/// Exit status 1 is success here: git reports 1 when differences exist, so
/// treating it as failure would turn every non-empty diff into an error.
async fn capture_diff(
    bridge: &AppServerBridge,
    cwd: &Path,
    fsmonitor: FsmonitorOverride,
    config_overrides: &[(String, String)],
    args: &[&str],
) -> Result<String, String> {
    let output = exec(
        bridge,
        git_argv(fsmonitor, args),
        cwd,
        config_override_env(config_overrides),
    )
    .await?;
    if output.success() || output.exit_code == 1 {
        Ok(output.stdout)
    } else {
        Err(format!(
            "git {args:?} failed with status {}",
            output.exit_code
        ))
    }
}

/// Whether `cwd` is inside a git work tree.
///
/// Probing for the fsmonitor override first would run extra git commands in
/// directories that are not repositories at all, so this check deliberately
/// runs with the override disabled.
async fn inside_git_repo(bridge: &AppServerBridge, cwd: &Path) -> Result<bool, String> {
    let output = exec(
        bridge,
        git_argv(
            FsmonitorOverride::Disabled,
            &["rev-parse", "--is-inside-work-tree"],
        ),
        cwd,
        HashMap::new(),
    )
    .await?;
    Ok(output.success())
}

/// `/diff` — the working-tree diff including untracked files.
#[tauri::command]
pub async fn git_diff(
    bridge: State<'_, AppServerBridge>,
    cwd: String,
) -> Result<GitDiffResult, String> {
    let cwd = PathBuf::from(cwd);
    let bridge = bridge.inner();

    if !inside_git_repo(bridge, &cwd).await? {
        return Ok(GitDiffResult {
            is_git_repo: false,
            diff: String::new(),
        });
    }

    // Probed once and reused for every subsequent git call in this run, as the
    // TUI does — the probe is not free and the answer cannot change mid-run.
    let mut probe_runner = BridgeProbeRunner { bridge, cwd: &cwd };
    let fsmonitor = detect_fsmonitor_override(&mut probe_runner).await;

    let filter_output = exec(
        bridge,
        git_argv(
            fsmonitor,
            &[
                "config",
                "--null",
                "--name-only",
                "--get-regexp",
                EXECUTABLE_FILTER_CONFIG_PATTERN,
            ],
        ),
        &cwd,
        HashMap::new(),
    )
    .await?;
    // 1 means "no matching keys", which is the common case, not a failure.
    if filter_output.exit_code != 0 && filter_output.exit_code != 1 {
        return Err(format!(
            "git config --get-regexp failed with status {}",
            filter_output.exit_code
        ));
    }
    let config_overrides = filter_config_overrides_from_stdout(&filter_output.stdout);

    let tracked = capture_diff(
        bridge,
        &cwd,
        fsmonitor,
        &config_overrides,
        &tracked_diff_args(),
    )
    .await?;
    let untracked_listing = capture_stdout(
        bridge,
        &cwd,
        fsmonitor,
        &["ls-files", "--others", "--exclude-standard"],
    )
    .await?;

    let mut untracked = String::new();
    for file in untracked_paths(&untracked_listing) {
        let args = untracked_diff_args(file);
        untracked.push_str(&capture_diff(bridge, &cwd, fsmonitor, &config_overrides, &args).await?);
    }

    Ok(GitDiffResult {
        is_git_repo: true,
        diff: format!("{tracked}{untracked}"),
    })
}

#[cfg(test)]
mod tests {
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
}
