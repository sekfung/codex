use super::*;
use pretty_assertions::assert_eq;
use std::path::PathBuf;

/// The queue carries the same structured input a turn does, so its
/// summary has to survive attachments and skills rather than assuming a
/// queued submission is plain text.
#[test]
fn queued_submission_view_summarizes_structured_input() {
    let view = queued_submission_view(QueuedSubmission {
        id: "q1".to_string(),
        client_user_message_id: "c1".to_string(),
        input: build_turn_input(
            "run $review on this".to_string(),
            vec![ComposerAttachment::LocalImage {
                path: PathBuf::from("/tmp/a.png"),
            }],
            vec![ComposerSkill {
                name: "review".to_string(),
                path: PathBuf::from("/skills/review"),
            }],
            Vec::new(),
            Vec::new(),
        ),
    });

    assert_eq!(
        view,
        QueuedSubmissionView {
            id: "q1".to_string(),
            text: "run $review on this".to_string(),
            attachment_count: 1,
            skill_names: vec!["review".to_string()],
        }
    );
}

/// This client's composer offers only images, so audio and mentions reach
/// the queue from *another* client sharing `$CODEX_HOME` — which is
/// exactly why the summary must not drop them. Audio is an attachment;
/// a mention already rides in the accompanying text as its `@token`, so
/// it must not be counted again.
#[test]
fn queued_submission_view_counts_audio_and_leaves_mentions_to_the_text() {
    let view = queued_submission_view(QueuedSubmission {
        id: "q2".to_string(),
        client_user_message_id: "c2".to_string(),
        input: vec![
            UserInput::Text {
                text: "ask @Docs about this".to_string(),
                text_elements: Vec::new(),
            },
            UserInput::Audio {
                url: "https://example.invalid/a.wav".to_string(),
            },
            UserInput::LocalAudio {
                path: PathBuf::from("/tmp/b.wav"),
            },
            UserInput::Mention {
                name: "Docs".to_string(),
                path: "app://docs".to_string(),
            },
        ],
    });

    assert_eq!(
        view,
        QueuedSubmissionView {
            id: "q2".to_string(),
            text: "ask @Docs about this".to_string(),
            attachment_count: 2,
            skill_names: Vec::new(),
        }
    );
}

fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

/// Moving down has to account for the element having been removed first —
/// the classic off-by-one in "reorder expressed as a move".
#[test]
fn reorder_ids_moves_within_bounds() {
    let queue = ids(&["a", "b", "c"]);
    assert_eq!(
        reorder_ids(&queue, "a", /*delta*/ 1),
        Some(ids(&["b", "a", "c"]))
    );
    assert_eq!(
        reorder_ids(&queue, "c", /*delta*/ -1),
        Some(ids(&["a", "c", "b"]))
    );
    assert_eq!(
        reorder_ids(&queue, "a", /*delta*/ 2),
        Some(ids(&["b", "c", "a"]))
    );
}

/// A move that cannot happen is `None` rather than an unchanged list, so
/// the caller skips the RPC instead of asking the engine to reorder a
/// queue into the order it is already in.
#[test]
fn reorder_ids_rejects_no_op_moves() {
    let queue = ids(&["a", "b", "c"]);
    assert_eq!(reorder_ids(&queue, "a", /*delta*/ -1), None);
    assert_eq!(reorder_ids(&queue, "c", /*delta*/ 1), None);
    assert_eq!(reorder_ids(&queue, "a", /*delta*/ 0), None);
    assert_eq!(reorder_ids(&queue, "missing", /*delta*/ 1), None);
}

/// The three-way budget edit has to survive the round trip into the
/// protocol's double-`Option`, since "leave alone" and "clear" are
/// different requests that JSON `null` alone cannot tell apart.
#[test]
fn token_budget_edit_maps_onto_double_option() {
    assert_eq!(
        Option::<Option<i64>>::from(TokenBudgetEdit::Unchanged),
        None
    );
    assert_eq!(
        Option::<Option<i64>>::from(TokenBudgetEdit::Clear),
        Some(None)
    );
    assert_eq!(
        Option::<Option<i64>>::from(TokenBudgetEdit::Set { tokens: 50_000 }),
        Some(Some(50_000))
    );
}
