#![allow(clippy::expect_used)]

use super::*;
use pretty_assertions::assert_eq;

/// The serialized shape the frontend switches on. Pinned because the three
/// cases mean different things to a user — "unconfigured" must never be
/// mistaken for "up to date", which is the failure mode ADR-0007's note about
/// honest degradation exists to prevent.
#[test]
fn update_status_serializes_as_a_tagged_union() {
    assert_eq!(
        serde_json::to_value(UpdateStatus::NotConfigured {
            reason: "尚未配置更新源地址与签名公钥".to_string(),
        })
        .expect("status should serialize"),
        serde_json::json!({
            "status": "notConfigured",
            "reason": "尚未配置更新源地址与签名公钥",
        })
    );

    assert_eq!(
        serde_json::to_value(UpdateStatus::UpToDate {
            current_version: "0.0.0".to_string(),
        })
        .expect("status should serialize"),
        serde_json::json!({ "status": "upToDate", "currentVersion": "0.0.0" })
    );

    assert_eq!(
        serde_json::to_value(UpdateStatus::Available {
            current_version: "0.0.0".to_string(),
            version: "0.1.0".to_string(),
            notes: None,
        })
        .expect("status should serialize"),
        serde_json::json!({
            "status": "available",
            "currentVersion": "0.0.0",
            "version": "0.1.0",
            "notes": null,
        })
    );
}
