use super::*;
use codex_protocol::models::BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS;
use codex_protocol::models::BUILT_IN_PERMISSION_PROFILE_WORKSPACE;
use pretty_assertions::assert_eq;

#[test]
fn request_approval_uses_workspace_profile_and_user_review() {
    let resolved = ApprovalMode::RequestApproval.resolve().expect("resolves");
    assert_eq!(
        resolved.permission_profile_id,
        BUILT_IN_PERMISSION_PROFILE_WORKSPACE
    );
    assert_eq!(resolved.approvals_reviewer, ApprovalsReviewer::User);
    assert_eq!(resolved.approval_policy, AskForApproval::OnRequest);
}

/// The distinguishing feature of 帮我批准: same access as 请求批准, only the
/// reviewer changes.
#[test]
fn help_me_approve_differs_from_request_approval_only_by_reviewer() {
    let request = ApprovalMode::RequestApproval.resolve().expect("resolves");
    let help = ApprovalMode::HelpMeApprove.resolve().expect("resolves");
    assert_eq!(request.permission_profile_id, help.permission_profile_id);
    assert_eq!(request.approval_policy, help.approval_policy);
    assert_eq!(help.approvals_reviewer, ApprovalsReviewer::AutoReview);
}

/// Every mode must survive a persist-then-reload round trip, or the
/// settings screen would display something other than what it just wrote.
#[test]
fn from_config_parts_inverts_resolve() {
    for mode in [
        ApprovalMode::RequestApproval,
        ApprovalMode::HelpMeApprove,
        ApprovalMode::FullAccess,
    ] {
        let resolved = mode.resolve().expect("resolves");
        assert_eq!(
            ApprovalMode::from_config_parts(
                Some(&resolved.approval_policy),
                Some(resolved.approvals_reviewer),
                Some(&resolved.permission_profile_id),
            ),
            Some(mode)
        );
    }
}

/// The `read-only` preset is deliberately unmapped (see the module docs),
/// so a config using it must report "not one of the three" rather than
/// being misreported as 请求批准, which shares its approval policy.
#[test]
fn from_config_parts_rejects_configs_the_selector_cannot_express() {
    assert_eq!(
        ApprovalMode::from_config_parts(
            Some(&AskForApproval::OnRequest),
            Some(ApprovalsReviewer::User),
            Some(codex_protocol::models::BUILT_IN_PERMISSION_PROFILE_READ_ONLY),
        ),
        None
    );
    // An empty config (fresh install) is likewise not a claim about any
    // particular mode.
    assert_eq!(
        ApprovalMode::from_config_parts(
            /*approval_policy*/ None, /*approvals_reviewer*/ None,
            /*permission_profile_id*/ None
        ),
        None
    );
}

#[test]
fn full_access_never_asks() {
    let resolved = ApprovalMode::FullAccess.resolve().expect("resolves");
    assert_eq!(
        resolved.permission_profile_id,
        BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS
    );
    assert_eq!(resolved.approval_policy, AskForApproval::Never);
}
