use super::*;
use pretty_assertions::assert_eq;

/// `memories` is not a named field on `v2::Config`, so it arrives in the
/// flattened map with snake_case children while its siblings are
/// camelCase. Reading it with the wrong casing would silently report
/// defaults instead of the stored values.
#[test]
fn memory_settings_read_snake_case_keys_from_the_flattened_table() {
    let response = serde_json::json!({
        "config": {
            "approvalPolicy": "on-request",
            "memories": { "use_memories": false, "generate_memories": true },
        }
    });
    assert_eq!(
        memory_settings_from_config(&response),
        MemorySettings {
            use_memories: false,
            generate_memories: true,
        }
    );
}

/// An absent key means "engine default", which for both of these is on.
/// Treating absent as `false` would show both toggles off on a fresh
/// install while memories were in fact running.
#[test]
fn absent_memory_keys_default_to_enabled() {
    assert_eq!(
        memory_settings_from_config(&serde_json::json!({ "config": {} })),
        MemorySettings::default()
    );
    assert_eq!(
        memory_settings_from_config(&serde_json::json!({
            "config": { "memories": { "use_memories": false } }
        })),
        MemorySettings {
            use_memories: false,
            generate_memories: true,
        }
    );
}
