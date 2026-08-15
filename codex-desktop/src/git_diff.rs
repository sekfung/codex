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
use codex_app_server_protocol::GitDiffToRemoteParams;
use codex_app_server_protocol::GitDiffToRemoteResponse;
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
    let response: CommandExecResponse = bridge
        .request_as(ClientRequest::OneOffCommandExec {
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

/// Why a remote comparison is unavailable, when it is.
///
/// The RPC collapses every failure into one `invalid_request` string, because
/// `git_diff_to_remote` returns `Option` and the processor turns `None` into
/// "failed to compute git diff to remote". `None` is returned for a missing
/// repository, *no configured remote*, an unresolvable merge base, and a failed
/// diff alike — and "this repository has no remote" is an ordinary state, not a
/// fault. Distinguishing it is the difference between an answer and a red error
/// box on every local-only repository.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDiffUnavailable {
    /// `cwd` is not inside a git work tree.
    NotAGitRepo,
    /// A repository, but no remote is configured — nothing to compare against.
    NoRemote,
}

/// Result of `gitDiffToRemote`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDiffResult {
    /// Set when no comparison is possible; `sha`/`diff` are then empty.
    pub unavailable: Option<RemoteDiffUnavailable>,
    /// The commit compared against — the closest ancestor that exists on a
    /// remote, not necessarily the upstream branch tip.
    pub sha: String,
    /// May be empty, which means everything local is already on a remote.
    pub diff: String,
}

/// `gitDiffToRemote` — everything in the working tree that is not yet on a
/// remote, including commits made locally but never pushed.
///
/// Distinct from [`git_diff`], which only shows uncommitted work. This one
/// answers "what have I not pushed", and unlike the working-tree diff it is a
/// plain RPC: the engine owns the whole computation (`git-utils/src/info.rs`
/// walks the branch ancestry to find the closest shared commit), so there is no
/// command to construct here.
#[tauri::command]
pub async fn git_diff_to_remote(
    bridge: State<'_, AppServerBridge>,
    cwd: String,
) -> Result<RemoteDiffResult, String> {
    let cwd = PathBuf::from(cwd);

    // Probed before the RPC purely so the two ordinary "nothing to show" states
    // can be named. Both are `codex_git_utils` reads, reused rather than
    // reimplemented, in the same spirit as `git_refs.rs`.
    if codex_git_utils::get_git_repo_root(&cwd).is_none() {
        return Ok(RemoteDiffResult {
            unavailable: Some(RemoteDiffUnavailable::NotAGitRepo),
            sha: String::new(),
            diff: String::new(),
        });
    }
    if codex_git_utils::get_git_remote_urls_assume_git_repo(&cwd)
        .await
        .is_none_or(|remotes| remotes.is_empty())
    {
        return Ok(RemoteDiffResult {
            unavailable: Some(RemoteDiffUnavailable::NoRemote),
            sha: String::new(),
            diff: String::new(),
        });
    }

    let response: GitDiffToRemoteResponse = bridge
        .request_as(ClientRequest::GitDiffToRemote {
            request_id: bridge.next_request_id(),
            params: GitDiffToRemoteParams { cwd },
        })
        .await?;

    Ok(RemoteDiffResult {
        unavailable: None,
        // `GitSha` is a newtype over `String` and serializes transparently
        // (ts-rs emits `export type GitSha = string`), but the inner value is
        // taken here rather than passing the wrapper along, so the frontend
        // type cannot drift from the wire shape.
        sha: response.sha.0,
        diff: response.diff,
    })
}

/// Lines added and removed on this branch since it left the default branch.
///
/// Committed work only — `merge_base..HEAD` does not see the working tree.
/// That is the same range the TUI's `branch-changes` status item reports, and
/// the uncommitted side is what the 工作区 diff already answers.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchChangeStats {
    pub additions: u64,
    pub deletions: u64,
}

/// Sums a `git diff --numstat` body.
///
/// Binary files are reported as `-\t-\t<path>` and parse to zero on both
/// columns, which is intended: they contribute no line counts.
fn sum_numstat(stdout: &str) -> BranchChangeStats {
    let mut stats = BranchChangeStats::default();
    for line in stdout.lines() {
        let mut columns = line.split('\t');
        stats.additions += columns
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        stats.deletions += columns
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
    }
    stats
}

/// The branch this thread's repository is on, and how far it has moved.
///
/// Ported from `tui/src/branch_summary.rs`, which backs the TUI status line's
/// `git-branch` and `branch-changes` items — the named basis for showing this
/// at all. The command sequence (default branch → `merge-base` → `--numstat`)
/// is kept identical, and every invocation goes through `command/exec` for the
/// reason given in this module's header: these are constructed commands.
///
/// `pull-request-number`, the third item there, is deliberately not ported: it
/// shells out to `gh` and depends on an authenticated GitHub CLI, which is a
/// dependency this client does not otherwise have.
///
/// Every field is optional because every probe is best-effort. A detached HEAD
/// has no branch, a repository with no default branch has no comparison, and
/// neither is worth an error — the panel simply omits the row.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub changes: Option<BranchChangeStats>,
}

#[tauri::command]
pub async fn branch_status(
    bridge: State<'_, AppServerBridge>,
    cwd: String,
) -> Result<BranchStatus, String> {
    let cwd = PathBuf::from(cwd);
    let bridge = bridge.inner();

    if !inside_git_repo(bridge, &cwd).await? {
        return Ok(BranchStatus::default());
    }

    let branch = codex_git_utils::current_branch_name(&cwd).await;
    let Some(default_branch) = codex_git_utils::default_branch_name(&cwd).await else {
        return Ok(BranchStatus {
            is_git_repo: true,
            branch,
            default_branch: None,
            changes: None,
        });
    };

    let mut probe_runner = BridgeProbeRunner { bridge, cwd: &cwd };
    let fsmonitor = detect_fsmonitor_override(&mut probe_runner).await;

    // `--numstat` still diffs content, so it can invoke a repository's filter
    // drivers exactly as the working-tree diff can. The same suppression is
    // applied rather than assumed unnecessary.
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
    if filter_output.exit_code != 0 && filter_output.exit_code != 1 {
        return Err(format!(
            "git config --get-regexp failed with status {}",
            filter_output.exit_code
        ));
    }
    let config_overrides = filter_config_overrides_from_stdout(&filter_output.stdout);

    // A missing merge base is ordinary (an unborn HEAD, an unrelated history),
    // so the stats are dropped rather than failing the whole panel.
    let changes = match capture_stdout(
        bridge,
        &cwd,
        fsmonitor,
        &["merge-base", "HEAD", &default_branch],
    )
    .await
    {
        Ok(stdout) if !stdout.trim().is_empty() => {
            let range = format!("{}..HEAD", stdout.trim());
            capture_diff(
                bridge,
                &cwd,
                fsmonitor,
                &config_overrides,
                &["diff", "--numstat", &range],
            )
            .await
            .ok()
            .map(|numstat| sum_numstat(&numstat))
        }
        _ => None,
    };

    Ok(BranchStatus {
        is_git_repo: true,
        branch,
        default_branch: Some(default_branch),
        changes,
    })
}

#[cfg(test)]
#[path = "git_diff_tests.rs"]
mod tests;
