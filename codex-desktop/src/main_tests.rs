use super::StartupStatus;
use pretty_assertions::assert_eq;

/// The frontend blocks the whole app on this being `Some`, so inverting it
/// would either hide a dead engine or refuse to start a healthy one.
#[test]
fn startup_failure_is_reported_only_when_startup_failed() {
    assert_eq!(StartupStatus::Ready.failure(), None);
    assert_eq!(
        StartupStatus::Failed("boom".to_string()).failure(),
        Some("boom".to_string())
    );
}
