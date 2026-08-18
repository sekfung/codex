use super::*;
use pretty_assertions::assert_eq;

fn server_error(message: &str, data: Option<JsonValue>) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32000,
        message: message.to_string(),
        data,
    }
}

/// The turn ended before the steer landed. The engine says so in the
/// message, and the caller must fall through to starting a new turn
/// rather than reporting a failure the user cannot act on.
#[test]
fn steer_race_detects_a_turn_that_already_ended() {
    assert_eq!(
        steer_race(&server_error("no active turn to steer", None)),
        Some(SteerRace::Missing)
    );
}

/// A stale cached turn id is recoverable: the engine names the turn it
/// actually has, which is what makes the single retry possible.
#[test]
fn steer_race_extracts_the_servers_actual_turn_id() {
    assert_eq!(
        steer_race(&server_error(
            "expected active turn id `turn-a` but found `turn-b`",
            None
        )),
        Some(SteerRace::ExpectedTurnMismatch {
            actual_turn_id: "turn-b".to_string()
        })
    );
}

/// An unrelated failure must not be mistaken for a race, or a real error
/// would be silently retried and then swallowed.
#[test]
fn steer_race_ignores_unrelated_errors() {
    assert_eq!(steer_race(&server_error("thread is archived", None)), None);
}

/// Review and compaction turns refuse steering, and they report it
/// through `data.codexErrorInfo` rather than the message — the reason
/// submission uses the bridge's detail-preserving request path. Missing
/// that would drop the user's message instead of queueing it.
#[test]
fn not_steerable_is_read_from_error_data_not_the_message() {
    let error = server_error(
        "active turn is not steerable",
        Some(serde_json::json!({
            "codexErrorInfo": { "type": "activeTurnNotSteerable", "turnKind": "review" }
        })),
    );
    assert!(active_turn_not_steerable(&error));
    // ...and it is not a race, so it must not be retried.
    assert_eq!(steer_race(&error), None);
}

#[test]
fn not_steerable_is_false_without_error_data() {
    assert!(!active_turn_not_steerable(&server_error(
        "no active turn to steer",
        None
    )));
}

fn kinds(input: &[UserInput]) -> Vec<&'static str> {
    input
        .iter()
        .map(|item| match item {
            UserInput::Text { .. } => "text",
            UserInput::Image { .. } => "image",
            UserInput::LocalImage { .. } => "localImage",
            UserInput::Skill { .. } => "skill",
            UserInput::Mention { .. } => "mention",
            _ => "other",
        })
        .collect()
}

/// Locks the TUI's ordering (`chatwidget/input_submission.rs`): images,
/// then text, then skills.
#[test]
fn turn_input_matches_tui_ordering() {
    let input = build_turn_input(
        "look at $review".to_string(),
        vec![
            ComposerAttachment::RemoteImage {
                url: "https://example.com/a.png".to_string(),
            },
            ComposerAttachment::LocalImage {
                path: PathBuf::from("/tmp/b.png"),
            },
        ],
        vec![ComposerSkill {
            name: "review".to_string(),
            path: PathBuf::from("/skills/review"),
        }],
        Vec::new(),
        Vec::new(),
    );

    assert_eq!(kinds(&input), vec!["image", "localImage", "text", "skill"]);
}

/// A referenced file rides in the `Text` item and produces no structured
/// item of its own.
///
/// This is the engine's model, established from the TUI rather than
/// assumed: `chat_composer.rs::insert_selected_path` replaces the `@token`
/// with a bare relative path — dropping the `@` — and records no mention
/// binding, while its sibling `insert_selected_mention` (used for skills,
/// plugins and apps) does record one. Correspondingly, every
/// `UserInput::Mention` constructed anywhere in the workspace carries a URI
/// path (`plugin://`, `app://`, `skill://`), never a file path; see
/// `chatwidget/input_submission.rs` and `ext/skills/src/selection.rs`.
///
/// So emitting `UserInput::Mention` for a file would be inventing a
/// capability no other client sends, which ADR-0021 forbids. The test
/// exists to keep that from being "fixed" later by someone who reads the
/// asymmetry as a bug.
#[test]
fn file_mentions_are_text_only() {
    let input = build_turn_input(
        "explain src/main.rs and $review it".to_string(),
        Vec::new(),
        vec![ComposerSkill {
            name: "review".to_string(),
            path: PathBuf::from("/skills/review"),
        }],
        Vec::new(),
        Vec::new(),
    );

    assert_eq!(kinds(&input), vec!["text", "skill"]);
}

/// An image with no caption is a real message; an empty `Text` item is not.
#[test]
fn attachment_only_message_omits_empty_text() {
    let input = build_turn_input(
        String::new(),
        vec![ComposerAttachment::LocalImage {
            path: PathBuf::from("/tmp/b.png"),
        }],
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );

    assert_eq!(kinds(&input), vec!["localImage"]);
}

fn text_of(input: &[UserInput]) -> Option<&str> {
    input.iter().find_map(|item| match item {
        UserInput::Text { text, .. } => Some(text.as_str()),
        _ => None,
    })
}

/// A chip-added file rides in the `Text` item ahead of what the user typed,
/// and still produces no structured item of its own.
#[test]
fn file_refs_lead_the_text_item() {
    let input = build_turn_input(
        "explain this".to_string(),
        Vec::new(),
        Vec::new(),
        vec![
            ComposerFileRef {
                path: "src/main.rs".to_string(),
            },
            ComposerFileRef {
                path: "docs/adr".to_string(),
            },
        ],
        Vec::new(),
    );

    assert_eq!(kinds(&input), vec!["text"]);
    assert_eq!(text_of(&input), Some("src/main.rs docs/adr explain this"));
}

/// A file reference alone is a real message: the `Text` item is emitted
/// even with nothing typed, unlike the empty-text case.
#[test]
fn file_ref_only_message_still_sends_text() {
    let input = build_turn_input(
        String::new(),
        Vec::new(),
        Vec::new(),
        vec![ComposerFileRef {
            path: "src/main.rs".to_string(),
        }],
        Vec::new(),
    );

    assert_eq!(kinds(&input), vec!["text"]);
    assert_eq!(text_of(&input), Some("src/main.rs"));
}

fn mention_paths(input: &[UserInput]) -> Vec<(&str, &str)> {
    input
        .iter()
        .filter_map(|item| match item {
            UserInput::Mention { name, path } => Some((name.as_str(), path.as_str())),
            _ => None,
        })
        .collect()
}

/// The URI shapes the engine matches on. A wrong prefix here does not
/// error — `input_submission.rs` simply fails to resolve the mention and
/// drops it — so the format is pinned rather than trusted.
///
/// `app://{AppInfo.id}` comes from `chat_composer.rs:4168`;
/// `plugin://{config_name}` from `mentions_v2/search_catalog.rs`, where
/// `config_name` is `PluginDetail.id` per `core-plugins/src/manager.rs`.
#[test]
fn mentions_use_the_engines_uri_scheme() {
    let input = build_turn_input(
        "ask @figma".to_string(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        vec![
            ComposerMention::App {
                id: "figma-1".to_string(),
                name: "Figma".to_string(),
            },
            ComposerMention::Plugin {
                id: "sample@test".to_string(),
                name: "Sample".to_string(),
            },
        ],
    );

    assert_eq!(
        mention_paths(&input),
        vec![
            ("Sample", "plugin://sample@test"),
            ("Figma", "app://figma-1"),
        ]
    );
}

/// Plugin mentions precede app mentions, and both follow skills — the
/// order `input_submission.rs` emits them in.
#[test]
fn mentions_follow_skills_with_plugins_before_apps() {
    let input = build_turn_input(
        "hi".to_string(),
        Vec::new(),
        vec![ComposerSkill {
            name: "review".to_string(),
            path: PathBuf::from("/skills/review"),
        }],
        Vec::new(),
        vec![
            ComposerMention::App {
                id: "a".to_string(),
                name: "A".to_string(),
            },
            ComposerMention::Plugin {
                id: "p".to_string(),
                name: "P".to_string(),
            },
        ],
    );

    assert_eq!(kinds(&input), vec!["text", "skill", "mention", "mention"]);
    assert_eq!(
        mention_paths(&input),
        vec![("P", "plugin://p"), ("A", "app://a")]
    );
}

/// Token derivation follows the engine's own helpers: an app slug is
/// `connector_name_slug` (lowercased, non-alphanumerics collapsed to `-`),
/// and a plugin keeps display casing when the display name is just a
/// prettier spelling of the config name, else title-cases it.
#[test]
fn mention_tokens_match_the_engines_naming() {
    let app = ComposerMention::App {
        id: "gcal".to_string(),
        name: "Google Calendar".to_string(),
    };
    assert_eq!(app.mention_token(), "@google-calendar");

    // Marketplace suffix is dropped before naming.
    let matching = ComposerMention::Plugin {
        id: "my-plugin@market".to_string(),
        name: "My Plugin".to_string(),
    };
    assert_eq!(matching.mention_token(), "@My-Plugin");

    // Display name unrelated to the config name: title-case the latter.
    let diverging = ComposerMention::Plugin {
        id: "pdf-tools".to_string(),
        name: "Documents".to_string(),
    };
    assert_eq!(diverging.mention_token(), "@Pdf-Tools");

    // Degenerate names still produce a usable token rather than "@".
    let punctuation = ComposerMention::App {
        id: "x".to_string(),
        name: "!!!".to_string(),
    };
    assert_eq!(punctuation.mention_token(), "@app");
}

/// Below the baseline the engine reports 0%, not a negative or clamped
/// percentage — verifying we are calling its function, not approximating.
#[test]
fn context_usage_defers_to_engine_formula() {
    let unknown_window = context_usage(5_000, 5_000, None);
    assert_eq!(unknown_window.percent_remaining, None);
    assert_eq!(unknown_window.used_tokens, 5_000);

    // Window at/below BASELINE_TOKENS is defined as 0% remaining.
    assert_eq!(context_usage(0, 0, Some(1_000)).percent_remaining, Some(0));

    // An empty window is fully available.
    assert_eq!(
        context_usage(0, 0, Some(112_000)).percent_remaining,
        Some(100)
    );
}
