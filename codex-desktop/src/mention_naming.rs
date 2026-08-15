//! Naming and quoting rules for `@` mentions and file references.
//!
//! Every function here is a port of an engine function, kept together and
//! away from the composer's request plumbing so the provenance stays legible:
//! a wrong slug or an unquoted path does not error, it just makes the engine
//! silently fail to resolve a mention. Ports are named after their sources.

/// Ported from `connectors/src/lib.rs::connector_name_slug`.
pub(crate) fn connector_name_slug(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
        } else {
            normalized.push('-');
        }
    }
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "app".to_string()
    } else {
        normalized.to_string()
    }
}

/// Ported from `mentions_v2/search_catalog.rs::plugin_mention_name`: when the
/// display name is just a prettier spelling of the config name, keep the
/// display casing and the config separators; otherwise title-case the config
/// name.
pub(crate) fn plugin_mention_name(plugin_name: &str, display_name: &str) -> String {
    let plugin_segments = split_plugin_name_segments(plugin_name);
    let display_segments: Vec<String> = display_name
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect();

    if plugin_segments.len() == display_segments.len()
        && plugin_segments
            .iter()
            .zip(&display_segments)
            .all(|((segment, _), display)| segment.eq_ignore_ascii_case(display))
    {
        let mut result = String::new();
        for ((_, separator), display) in plugin_segments.into_iter().zip(display_segments) {
            result.push_str(&display);
            if let Some(separator) = separator {
                result.push(separator);
            }
        }
        return result;
    }

    title_case_plugin_name(plugin_name)
}

pub(crate) fn split_plugin_name_segments(plugin_name: &str) -> Vec<(String, Option<char>)> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for character in plugin_name.chars() {
        if matches!(character, '-' | '_') {
            if !current.is_empty() {
                segments.push((std::mem::take(&mut current), Some(character)));
            }
        } else {
            current.push(character);
        }
    }
    if !current.is_empty() {
        segments.push((current, None));
    }
    segments
}

pub(crate) fn title_case_plugin_name(plugin_name: &str) -> String {
    let mut result = String::with_capacity(plugin_name.len());
    let mut capitalize_next = true;
    for character in plugin_name.chars() {
        if matches!(character, '-' | '_') {
            capitalize_next = true;
            result.push(character);
            continue;
        }
        if capitalize_next && character.is_ascii_alphabetic() {
            result.push(character.to_ascii_uppercase());
            capitalize_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

/// Quotes a path the way the TUI does before putting it in the message.
///
/// Copied from `chat_composer.rs::insert_selected_path`: wrap in double quotes
/// when the path contains whitespace, unless it already contains a quote (the
/// TUI keeps that case simple rather than escaping). The rule exists so the
/// prompt's own arg parser treats the path as one token.
pub(crate) fn quote_path_for_prompt(path: &str) -> String {
    if path.chars().any(char::is_whitespace) && !path.contains('"') {
        format!("\"{path}\"")
    } else {
        path.to_string()
    }
}

#[cfg(test)]
#[path = "mention_naming_tests.rs"]
mod tests;
