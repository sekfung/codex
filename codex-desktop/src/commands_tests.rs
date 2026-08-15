use super::*;
use pretty_assertions::assert_eq;

/// Pins the `thread/start` field set.
///
/// The two fields checked here are the ones that are *not* config-derived
/// overrides, so unlike the rest they cannot be recovered from the server's
/// own config if they go missing — and losing either is silent. Dropping
/// `history_mode` in particular downgrades every new thread to `Legacy`,
/// which the engine then refuses to revert.
#[test]
fn thread_start_sets_the_non_override_fields() {
    let params = thread_start_params(
        "/repo".to_string(),
        /*resolved*/ None,
        /*model*/ None,
    );

    assert_eq!(params.cwd.as_deref(), Some("/repo"));
    assert_eq!(params.thread_source, Some(ThreadSource::User));
    // Negotiated per request rather than baked in here, so the fallback in
    // `start_thread_negotiating_history` owns the value.
    assert_eq!(params.history_mode, None);
}

/// The config-derived fields stay unset on purpose: the embedded
/// app-server reads the same `config.toml` (ADR-0008) and applies them as
/// its own defaults, so setting them here would mean this crate
/// interpreting config it is not allowed to own (ADR-0021).
#[test]
fn thread_start_leaves_config_derived_fields_to_the_server() {
    let params = thread_start_params(
        "/repo".to_string(),
        /*resolved*/ None,
        /*model*/ None,
    );

    assert_eq!(params.model_provider, None);
    assert_eq!(params.service_tier, None);
    assert_eq!(params.sandbox, None);
    assert_eq!(params.runtime_workspace_roots, None);
    assert_eq!(params.config, None);
    assert_eq!(params.personality, None);
    assert_eq!(params.developer_instructions, None);
    assert_eq!(params.ephemeral, None);
}

#[test]
fn thread_start_carries_the_resolved_approval_mode() {
    let resolved = ApprovalMode::HelpMeApprove
        .resolve()
        .expect("built-in preset should resolve");
    let expected_profile = resolved.permission_profile_id.clone();
    let expected_policy = resolved.approval_policy;
    let expected_reviewer = resolved.approvals_reviewer;

    let params = thread_start_params(
        "/repo".to_string(),
        Some(resolved),
        Some("gpt-x".to_string()),
    );

    assert_eq!(params.model.as_deref(), Some("gpt-x"));
    assert_eq!(params.approval_policy, Some(expected_policy));
    assert_eq!(params.approvals_reviewer, Some(expected_reviewer));
    assert_eq!(params.permissions, Some(expected_profile));
    // `permissions` and `sandbox` are mutually exclusive on the wire; the
    // server rejects a request carrying both.
    assert_eq!(params.sandbox, None);
}

/// The payload is deserialized from the wire shape rather than a
/// hand-built struct, so a serde rename on `ThreadSettings` breaks this
/// test rather than silently producing a wrong indicator at runtime.
fn settings_json(profile_id: &str, reviewer: &str, policy: &str) -> serde_json::Value {
    serde_json::json!({
        "cwd": "/repo",
        "approvalPolicy": policy,
        "approvalsReviewer": reviewer,
        // camelCase variants: this is the v2 `SandboxPolicy`, not
        // `codex_protocol`'s kebab-case type of the same name — the same
        // duplicate-name hazard the imports at the top of this file warn
        // about for `ThreadHistoryMode`/`ThreadSource`.
        "sandboxPolicy": { "type": "dangerFullAccess" },
        "activePermissionProfile": { "id": profile_id },
        "model": "gpt-x",
        "modelProvider": "openai",
        "serviceTier": null,
        "effort": "medium",
        "summary": null,
        // `Settings` carries no `rename_all`, so its fields stay
        // snake_case among camelCase siblings — the same trap this
        // protocol has sprung repeatedly, and the reason this payload is
        // deserialized here rather than described by a TS interface.
        "collaborationMode": {
            "mode": "default",
            "settings": {
                "model": "gpt-x",
                "reasoning_effort": null,
                "developer_instructions": null,
            },
        },
        "personality": null,
    })
}

#[test]
fn thread_settings_map_onto_the_composer_indicators() {
    let resolved = ApprovalMode::FullAccess.resolve().expect("resolves");
    let policy = serde_json::to_value(resolved.approval_policy).expect("policy serializes");
    let reviewer = serde_json::to_value(resolved.approvals_reviewer).expect("reviewer serializes");
    let json = settings_json(
        &resolved.permission_profile_id,
        reviewer.as_str().expect("reviewer is a string"),
        policy.as_str().expect("policy is a string"),
    );
    let settings: ThreadSettings = serde_json::from_value(json).expect("settings deserialize");

    let indicators = indicators_from_settings(settings);

    assert_eq!(indicators.approval_mode, Some(ApprovalMode::FullAccess));
    assert_eq!(indicators.model, "gpt-x");
    assert_eq!(indicators.effort.as_deref(), Some("medium"));
}

/// A combination the three-preset selector cannot express must report
/// `None` rather than being snapped to a preset the user never chose.
#[test]
fn unexpressible_thread_settings_yield_no_approval_mode() {
    let json = settings_json(":read-only", "user", "on-request");
    let settings: ThreadSettings = serde_json::from_value(json).expect("settings deserialize");

    assert_eq!(indicators_from_settings(settings).approval_mode, None);
}
