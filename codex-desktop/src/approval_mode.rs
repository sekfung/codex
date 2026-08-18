//! Maps the composer's 3-preset approval-mode selector (ADR-0016 layer 1)
//! onto concrete app-server settings.
//!
//! The mapping lives in Rust rather than the frontend so it can reference the
//! real constants (`codex_utils_approval_presets::builtin_approval_presets`,
//! `BUILT_IN_PERMISSION_PROFILE_*`) instead of duplicating magic strings in
//! TypeScript.
//!
//! # How the three Official-App labels map
//!
//! The Official App's selector offers three modes; the built-in preset list
//! (`utils/approval-presets`) offers three presets. They are *not* the same
//! three — the mapping is onto (preset, reviewer) pairs:
//!
//! | Selector label            | Built-in preset | `approvals_reviewer` |
//! |---------------------------|-----------------|----------------------|
//! | 请求批准 / Request approval | `auto`          | `User`               |
//! | 帮我批准 / Help me approve  | `auto`          | `AutoReview`         |
//! | 完全访问权限 / Full access   | `full-access`   | `User`               |
//!
//! The `read-only` built-in preset has no selector equivalent, and `auto` is
//! used by two modes that differ only in who reviews escalations. This is
//! consistent with the reference screenshots' Settings page, which lists
//! "默认权限" (workspace default) and "自动审核" (auto-review of extra-access
//! requests) as *separate* toggles rather than one three-way choice.

use codex_app_server_protocol::ApprovalsReviewer;
// The v2 protocol has its own `AskForApproval` distinct from
// `codex_protocol::protocol::AskForApproval` (which is what the preset table
// hands back); `From` bridges them, so convert at this boundary and let the
// rest of the crate deal only in the v2 type the RPC params want.
use codex_app_server_protocol::AskForApproval;
use codex_utils_approval_presets::builtin_approval_presets;
use serde::Deserialize;
use serde::Serialize;

/// Preset ids from `builtin_approval_presets()`. Not an enum over there, so
/// these are matched by id string — kept here so a rename upstream fails
/// loudly in one place (`resolve` returns `Err`) rather than silently
/// mis-mapping.
const PRESET_AUTO: &str = "auto";
const PRESET_FULL_ACCESS: &str = "full-access";

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    /// 请求批准 — workspace access; asks the user for anything beyond it.
    RequestApproval,
    /// 帮我批准 — same access, but escalations go to the auto-review subagent
    /// first, so only genuinely risky operations reach the user.
    HelpMeApprove,
    /// 完全访问权限 — unrestricted; never asks.
    FullAccess,
}

/// The concrete settings one selector mode expands into.
pub struct ResolvedApprovalMode {
    pub approval_policy: AskForApproval,
    /// Built-in permission profile id (e.g. `":workspace"`), passed as
    /// `ThreadSettingsUpdateParams::permissions` / `ThreadStartParams::permissions`.
    pub permission_profile_id: String,
    pub approvals_reviewer: ApprovalsReviewer,
}

impl ApprovalMode {
    fn preset_id(self) -> &'static str {
        match self {
            Self::RequestApproval | Self::HelpMeApprove => PRESET_AUTO,
            Self::FullAccess => PRESET_FULL_ACCESS,
        }
    }

    fn reviewer(self) -> ApprovalsReviewer {
        match self {
            Self::RequestApproval | Self::FullAccess => ApprovalsReviewer::User,
            Self::HelpMeApprove => ApprovalsReviewer::AutoReview,
        }
    }

    /// Expands the mode using the shared built-in preset table, so approval
    /// policy and permission profile stay in sync with the TUI and any other
    /// surface that consumes the same presets.
    pub fn resolve(self) -> Result<ResolvedApprovalMode, String> {
        let preset_id = self.preset_id();
        let preset = builtin_approval_presets()
            .into_iter()
            .find(|preset| preset.id == preset_id)
            .ok_or_else(|| {
                format!(
                    "built-in approval preset `{preset_id}` no longer exists; \
                     codex-desktop's approval-mode mapping needs updating"
                )
            })?;

        Ok(ResolvedApprovalMode {
            approval_policy: preset.approval.into(),
            permission_profile_id: preset.active_permission_profile.id,
            approvals_reviewer: self.reviewer(),
        })
    }

    /// Inverse of [`resolve`](Self::resolve): recovers the selector mode from
    /// the three `config.toml` keys the settings screen writes
    /// (`approval_policy`, `approvals_reviewer`, `default_permissions`).
    ///
    /// Returns `None` when the persisted config isn't one of the three modes —
    /// a hand-edited `config.toml` or a CLI-set combination can perfectly well
    /// be something the 3-preset selector cannot express (the `read-only`
    /// preset, or `Granular` approvals). Callers should show that honestly
    /// rather than snapping the display to a preset the user didn't choose,
    /// which would misreport the policy actually in force.
    pub fn from_config_parts(
        approval_policy: Option<&AskForApproval>,
        approvals_reviewer: Option<ApprovalsReviewer>,
        permission_profile_id: Option<&str>,
    ) -> Option<Self> {
        let reviewer = approvals_reviewer.unwrap_or(ApprovalsReviewer::User);
        [Self::RequestApproval, Self::HelpMeApprove, Self::FullAccess]
            .into_iter()
            .find(|mode| {
                let Ok(resolved) = mode.resolve() else {
                    return false;
                };
                approval_policy.is_some_and(|policy| *policy == resolved.approval_policy)
                    && reviewer == resolved.approvals_reviewer
                    && permission_profile_id.is_some_and(|id| id == resolved.permission_profile_id)
            })
    }
}

#[cfg(test)]
#[path = "approval_mode_tests.rs"]
mod tests;
