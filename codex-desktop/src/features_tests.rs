use super::*;
use pretty_assertions::assert_eq;

/// `network_proxy` is the one beta-stage flag in the engine's table and is
/// off by default, so switching it off must *clear* the key rather than
/// write `false` — matching `build_feature_enabled_edit` in the TUI, which
/// keeps `config.toml` free of entries that merely restate a default.
#[test]
fn disabling_a_default_off_feature_clears_the_key() {
    let edit = feature_enabled_edit("network_proxy", /*enabled*/ false)
        .expect("network_proxy is a known feature");
    assert_eq!(edit.key_path, "features.network_proxy");
    assert_eq!(edit.value, serde_json::Value::Null);
}

#[test]
fn enabling_writes_true() {
    let edit = feature_enabled_edit("network_proxy", /*enabled*/ true)
        .expect("network_proxy is a known feature");
    assert_eq!(edit.value, serde_json::json!(true));
}

/// A default-*on* feature writes `false` explicitly: clearing it would
/// restore the default, which is the opposite of what was asked.
#[test]
fn disabling_a_default_on_feature_writes_false() {
    let edit = feature_enabled_edit("enable_request_compression", /*enabled*/ false)
        .expect("enable_request_compression is a known feature");
    assert_eq!(edit.value, serde_json::json!(false));
}

/// An unknown key must fail rather than write `features.<typo>`, which
/// config validation would reject anyway but less legibly.
#[test]
fn unknown_feature_is_rejected() {
    assert!(feature_enabled_edit("not_a_real_feature", /*enabled*/ true).is_err());
}
