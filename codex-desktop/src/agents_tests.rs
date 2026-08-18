#![allow(clippy::expect_used)]

use super::*;
use pretty_assertions::assert_eq;

/// Builds a `Thread` through serde rather than a struct literal, so the test
/// exercises the real wire shape. A literal would need every field and would
/// still not prove the field *names* match what the server sends.
fn thread_from_json(extra: serde_json::Value) -> codex_app_server_protocol::Thread {
    let mut value = serde_json::json!({
        "id": "t-1",
        "sessionId": "s-1",
        "forkedFromId": null,
        "parentThreadId": null,
        "preview": "",
        "ephemeral": false,
        "modelProvider": "openai",
        "createdAt": 0,
        "updatedAt": 0,
        "recencyAt": null,
        // `ThreadStatus` is internally tagged, not a bare string.
        "status": {"type": "idle"},
        "path": null,
        "cwd": "/repo",
        "cliVersion": "0.0.0",
        "source": "cli",
        "threadSource": null,
        "agentNickname": null,
        "agentRole": null,
        "gitInfo": null,
        "name": null,
        "turns": [],
    });
    let serde_json::Value::Object(fields) = extra else {
        panic!("extra must be an object");
    };
    let target = value.as_object_mut().expect("object");
    for (key, val) in fields {
        target.insert(key, val);
    }
    serde_json::from_value(value).expect("Thread should deserialize")
}

/// The nickname and role are the labels the stream shows, and they arrive
/// camelCase. Reading them from the wrong case would leave every agent
/// rendered as a bare UUID with no error anywhere.
#[test]
fn agent_info_reads_the_nickname_and_role() {
    let thread = thread_from_json(serde_json::json!({
        "agentNickname": "swift-otter",
        "agentRole": "worker",
        "name": "Investigate flake",
    }));

    assert_eq!(
        AgentThreadInfo::from_thread(&thread),
        AgentThreadInfo {
            id: "t-1".to_string(),
            nickname: Some("swift-otter".to_string()),
            role: Some("worker".to_string()),
            name: Some("Investigate flake".to_string()),
        }
    );
}

/// A thread that was not spawned by AgentControl has neither, which the
/// protocol declares by making both `Option`. The frontend falls back to the
/// thread id, so absence must survive as `None` rather than an empty string.
#[test]
fn agent_info_tolerates_a_thread_that_is_not_an_agent() {
    let thread = thread_from_json(serde_json::json!({}));

    assert_eq!(
        AgentThreadInfo::from_thread(&thread),
        AgentThreadInfo {
            id: "t-1".to_string(),
            nickname: None,
            role: None,
            name: None,
        }
    );
}
