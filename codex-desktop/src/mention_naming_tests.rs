use super::quote_path_for_prompt;
use pretty_assertions::assert_eq;

/// Quoting follows `chat_composer.rs::insert_selected_path` exactly:
/// whitespace forces quotes, an existing quote suppresses them.
#[test]
fn file_ref_paths_are_quoted_like_the_tui() {
    assert_eq!(quote_path_for_prompt("src/main.rs"), "src/main.rs");
    assert_eq!(quote_path_for_prompt("my docs/a.md"), "\"my docs/a.md\"");
    assert_eq!(quote_path_for_prompt("odd \"name\".md"), "odd \"name\".md");
}
