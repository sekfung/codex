use super::*;

fn draft(id: &str, label: Option<&str>, note: Option<&str>) -> UserInputAnswerDraft {
    UserInputAnswerDraft {
        question_id: id.to_string(),
        selected_label: label.map(str::to_string),
        note: note.map(str::to_string),
    }
}

/// The engine reads free text back with `strip_prefix("user_note: ")`
/// (`tui/src/history_cell/request_user_input.rs`), so dropping the prefix
/// would make a typed answer indistinguishable from a chosen label.
#[test]
fn free_text_carries_the_user_note_prefix() {
    let response = build_response(vec![draft(
        "q1",
        /*label*/ None,
        Some("use the staging bucket"),
    )]);
    assert_eq!(
        response.answers["q1"].answers,
        vec!["user_note: use the staging bucket".to_string()]
    );
}

/// A chosen option answers with its label verbatim — the reference client
/// pushes `option.label`, never an index.
#[test]
fn selected_option_answers_with_its_label() {
    let response = build_response(vec![draft("q1", Some("Rebuild"), /*note*/ None)]);
    assert_eq!(response.answers["q1"].answers, vec!["Rebuild".to_string()]);
}

/// The TUI appends a note *after* a selected label rather than treating
/// them as alternatives, so both can be present and order matters.
#[test]
fn label_and_note_are_both_sent_in_order() {
    let response = build_response(vec![draft("q1", Some("Rebuild"), Some("but skip tests"))]);
    assert_eq!(
        response.answers["q1"].answers,
        vec![
            "Rebuild".to_string(),
            "user_note: but skip tests".to_string(),
        ]
    );
}

/// Declining has no protocol verb: an unanswered question is submitted as
/// an empty list, which is what the TUI does for uncommitted answers. The
/// question id must still be present.
#[test]
fn unanswered_question_sends_an_empty_answer_list() {
    let response = build_response(vec![draft("q1", /*label*/ None, Some("   "))]);
    assert!(response.answers.contains_key("q1"));
    assert!(response.answers["q1"].answers.is_empty());
}
