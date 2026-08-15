//! Composer-side capability: structured turn input, skills, file search,
//! context usage, compaction and review.
//!
//! Note the asymmetry between `$` and `@`: a `$skill` produces a structured
//! `UserInput::Skill` *alongside* the text, but an `@file` produces **only**
//! text. That is the engine's model, not an omission here — see
//! `file_mentions_are_text_only`.
//!
//! Everything that touches the wire format is built here rather than in
//! TypeScript. `UserInput` is a `#[serde(tag = "type")]` union whose variants
//! carry differently-named fields, and `percent_of_context_window_remaining`
//! is engine arithmetic with an engine-owned `BASELINE_TOKENS` constant — both
//! are exactly the kind of thing ADR-0021 says a client must render rather
//! than re-derive. The frontend sends its own flat shapes; this module maps
//! them onto the protocol.

use codex_app_server_protocol::AppsListParams;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::CollaborationModeListParams;
use codex_app_server_protocol::CollaborationModeListResponse;
use codex_app_server_protocol::FuzzyFileSearchMatchType;
use codex_app_server_protocol::FuzzyFileSearchParams;
use codex_app_server_protocol::FuzzyFileSearchResponse;
use codex_app_server_protocol::ReviewDelivery;
use codex_app_server_protocol::ReviewStartParams;
use codex_app_server_protocol::ReviewTarget;
use codex_app_server_protocol::SkillsListParams;
use codex_app_server_protocol::ThreadCompactStartParams;
use codex_app_server_protocol::ThreadSettingsUpdateParams;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::UserInput;
use codex_protocol::config_types::CollaborationMode;
use codex_protocol::config_types::CollaborationModeMask as CoreCollaborationModeMask;
use codex_protocol::config_types::ModeKind;
use codex_protocol::config_types::Settings;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::protocol::TokenUsage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::State;

use crate::bridge::AppServerBridge;

type CmdResult<T> = Result<T, String>;

/// An image the user attached in the composer.
///
/// Mirrors what the TUI's composer accepts (`bottom_pane/chat_composer/
/// attachment_state.rs`): local image paths and remote image URLs. The TUI
/// composer has no audio affordance, and `UserInput`'s audio variants exist
/// for other callers, so this deliberately does not offer them — matching the
/// engine's own notion of what is attachable rather than inventing a wider one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ComposerAttachment {
    /// A file chosen from disk.
    LocalImage { path: PathBuf },
    /// An image referenced by URL.
    RemoteImage { url: String },
}

/// A skill the user referenced with `$name` in the composer.
///
/// The engine wants both halves: `UserInput::Skill { name, path }`. The `$name`
/// token stays in the message text as well — that is the TUI's model
/// (`chatwidget/input_submission.rs` pushes the `Text` item *and* a `Skill`
/// item per mention), not a redundancy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSkill {
    pub name: String,
    pub path: PathBuf,
}

/// A file or folder the user added through the `@` menu's 文件和文件夹 entry.
///
/// Presented as a removable chip above the input rather than typed into the
/// text, matching the Official App. That is presentation only (ADR-0021 test
/// 2): the reference still travels to the engine as **text**, exactly as a
/// `@`-completed path does, because a file reference has no structured
/// `UserInput` variant — see `file_mentions_are_text_only`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerFileRef {
    /// What gets folded into the message. Relative to a Project root when the
    /// pick came from inside one, absolute otherwise.
    pub path: String,
}

/// An app (connector) or plugin the user referenced from the `@` menu's 插件
/// section.
///
/// Unlike a file — which is plain text — these *are* structured mentions. The
/// canonical construction is in the TUI and is reproduced exactly here,
/// because a wrong URI means the engine silently fails to resolve the mention
/// rather than erroring:
///
/// - app: `UserInput::Mention { name: <app name>, path: "app://{app id}" }`
///   (`chat_composer.rs:4163-4171`, consumed in
///   `chatwidget/input_submission.rs` by `strip_prefix("app://")`)
/// - plugin: `UserInput::Mention { name: <display name>,
///   path: "plugin://{config_name}" }`
///   (`mentions_v2/search_catalog.rs::plugin_candidate`, consumed by
///   `strip_prefix("plugin://")`)
///
/// `config_name` is not a protocol field, but it is not a guess either:
/// `impl From<PluginDetail> for PluginCapabilitySummary`
/// (`core-plugins/src/manager.rs:412`) sets `config_name: value.id`, and `id`
/// *is* on the wire as `PluginSummary.id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ComposerMention {
    /// A connector from `app/list`. `id` is `AppInfo.id`.
    App { id: String, name: String },
    /// A plugin from `plugin/list`. `id` is `PluginSummary.id`, which is the
    /// `config_name` the engine matches on.
    Plugin { id: String, name: String },
}

impl ComposerMention {
    fn into_user_input(self) -> UserInput {
        match self {
            Self::App { id, name } => UserInput::Mention {
                name,
                path: format!("app://{id}"),
            },
            Self::Plugin { id, name } => UserInput::Mention {
                name,
                path: format!("plugin://{id}"),
            },
        }
    }

    /// The visible token left in the message text.
    ///
    /// The structured item above is what the engine resolves; this is what the
    /// model reads. Both TUI popups derive it from the entity rather than from
    /// the raw id, so this does too.
    ///
    /// One deliberate divergence: the TUI's connector popup inserts `${slug}`
    /// (`chat_composer.rs:4167`) while its plugin popup inserts `@{name}`.
    /// This client uses `@` for both, matching the Official App's single `@`
    /// menu and `PLUGIN_TEXT_MENTION_SIGIL`, whose doc comment is explicitly
    /// "Plugins use `@` in linked plaintext outside TUI". The sigil is
    /// presentation (ADR-0021 test 2); the resolved mention is unaffected.
    pub fn mention_token(&self) -> String {
        match self {
            Self::App { name, .. } => format!("@{}", connector_name_slug(name)),
            Self::Plugin { id, name } => {
                let plugin_name = id.split_once('@').map_or(id.as_str(), |(name, _)| name);
                format!("@{}", plugin_mention_name(plugin_name, name))
            }
        }
    }
}

/// Ported from `connectors/src/lib.rs::connector_name_slug`.
fn connector_name_slug(name: &str) -> String {
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
fn plugin_mention_name(plugin_name: &str, display_name: &str) -> String {
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

fn split_plugin_name_segments(plugin_name: &str) -> Vec<(String, Option<char>)> {
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

fn title_case_plugin_name(plugin_name: &str) -> String {
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
fn quote_path_for_prompt(path: &str) -> String {
    if path.chars().any(char::is_whitespace) && !path.contains('"') {
        format!("\"{path}\"")
    } else {
        path.to_string()
    }
}

/// Assembles the turn payload in the same order the TUI does: images, then
/// text, then skills, then plugin mentions, then app mentions
/// (`chatwidget/input_submission.rs`, which emits them in exactly that
/// sequence). Order is part of what the model sees, so it is copied rather
/// than chosen.
///
/// `file_refs` are folded into the `Text` item rather than becoming items of
/// their own. They are placed **before** the typed text: the TUI inserts a
/// completed path at the caret, which has no analogue once a chip replaces the
/// inline token, and leading is the closer reading — the chips render above
/// the input, so top-to-bottom the paths already precede the prose, and a
/// message like `src/main.rs explain this` keeps the request as the last thing
/// the model reads.
pub(crate) fn build_turn_input(
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
    file_refs: Vec<ComposerFileRef>,
    mentions: Vec<ComposerMention>,
) -> Vec<UserInput> {
    let mut input = Vec::new();

    for attachment in attachments {
        match attachment {
            ComposerAttachment::RemoteImage { url } => {
                input.push(UserInput::Image { url, detail: None });
            }
            ComposerAttachment::LocalImage { path } => {
                input.push(UserInput::LocalImage { path, detail: None });
            }
        }
    }

    let mut parts: Vec<String> = file_refs
        .into_iter()
        .map(|file_ref| quote_path_for_prompt(&file_ref.path))
        .collect();
    if !text.is_empty() {
        parts.push(text);
    }
    let text = parts.join(" ");

    // An attachment-only message is legitimate; an empty `Text` item is not.
    if !text.is_empty() {
        input.push(UserInput::Text {
            text,
            text_elements: Vec::new(),
        });
    }

    for skill in skills {
        input.push(UserInput::Skill {
            name: skill.name,
            path: skill.path,
        });
    }

    // Plugins before apps, matching `input_submission.rs`'s two loops.
    let (plugins, apps): (Vec<_>, Vec<_>) = mentions
        .into_iter()
        .partition(|mention| matches!(mention, ComposerMention::Plugin { .. }));
    for mention in plugins.into_iter().chain(apps) {
        input.push(mention.into_user_input());
    }

    input
}

#[tauri::command]
pub async fn send_turn(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
    file_refs: Vec<ComposerFileRef>,
    mentions: Vec<ComposerMention>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::TurnStart {
            request_id: bridge.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: build_turn_input(text, attachments, skills, file_refs, mentions),
                ..Default::default()
            },
        })
        .await
}

/// The `@…` token to insert for a chosen app/plugin.
///
/// Exposed as a command so the slug and title-casing rules stay next to the
/// engine functions they were ported from, rather than being a second
/// implementation in TypeScript that drifts on the next upstream merge.
#[tauri::command]
pub fn mention_token(mention: ComposerMention) -> String {
    mention.mention_token()
}

/// `app/list` — the connectors the Official App shows in the `@` menu's 插件
/// section.
///
/// Experimental, like the rest of the apps surface. `threadId` is left `None`:
/// the composer's catalog is the global one, and the per-thread form only
/// changes feature gating.
#[tauri::command]
pub async fn list_apps(bridge: State<'_, AppServerBridge>) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::AppsList {
            request_id: bridge.next_request_id(),
            params: AppsListParams {
                cursor: None,
                limit: None,
                thread_id: None,
                force_refetch: false,
            },
        })
        .await
}

/// `skills/list`. `cwds` empty means "the session working directory"; the
/// frontend passes the open Projects so repo-local skills resolve.
#[tauri::command]
pub async fn list_skills(
    bridge: State<'_, AppServerBridge>,
    cwds: Vec<PathBuf>,
    force_reload: bool,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::SkillsList {
            request_id: bridge.next_request_id(),
            params: SkillsListParams { cwds, force_reload },
        })
        .await
}

/// One `@` file-search hit, flattened for the frontend.
///
/// `FuzzyFileSearchResult` is the one type in this corner of the protocol with
/// **no** `#[serde(rename_all = "camelCase")]`, so it arrives with snake_case
/// `match_type`/`file_name` while everything around it is camelCase. Mapping
/// it here means the frontend never has to encode that inconsistency — the
/// same reasoning that keeps `UserInput` construction on this side.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchHit {
    /// Path relative to `root`, which is what gets inserted into the message.
    pub path: String,
    pub file_name: String,
    pub root: String,
    pub is_directory: bool,
}

/// `fuzzyFileSearch` — the protocol's exposure of the same `codex-file-search`
/// engine the TUI drives in-process for its `@` completions
/// (`tui/src/file_search.rs`).
///
/// `cancellation_token` is the engine's own concurrency contract: "if provided,
/// will cancel any previous request that used the same value". The caller
/// therefore passes one *stable* token for the whole typing session, so each
/// keystroke's request cancels the previous in-flight one rather than racing it.
#[tauri::command]
pub async fn search_files(
    bridge: State<'_, AppServerBridge>,
    query: String,
    roots: Vec<String>,
    cancellation_token: String,
) -> CmdResult<Vec<FileSearchHit>> {
    let response = bridge
        .request(ClientRequest::FuzzyFileSearch {
            request_id: bridge.next_request_id(),
            params: FuzzyFileSearchParams {
                query,
                roots,
                cancellation_token: Some(cancellation_token),
            },
        })
        .await?;

    let response: FuzzyFileSearchResponse =
        serde_json::from_value(response).map_err(|err| format!("fuzzyFileSearch: {err}"))?;

    Ok(response
        .files
        .into_iter()
        .map(|hit| FileSearchHit {
            path: hit.path,
            file_name: hit.file_name,
            root: hit.root,
            is_directory: matches!(hit.match_type, FuzzyFileSearchMatchType::Directory),
        })
        .collect())
}

/// A collaboration-mode preset, flattened for the frontend.
///
/// `v2::CollaborationModeMask` carries `#[serde(rename = "reasoning_effort")]`
/// — snake_case among camelCase siblings, the same trap `FuzzyFileSearchResult`
/// sets. Flattening here keeps that inconsistency out of TypeScript.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationModePreset {
    pub name: String,
    /// `"plan"` / `"default"`, or `None` when the preset leaves the mode alone.
    pub mode: Option<String>,
    pub model: Option<String>,
    /// Whether this preset is one the engine considers user-visible
    /// (`TUI_VISIBLE_COLLABORATION_MODES`), so this client offers the same set
    /// the TUI does rather than a different one.
    pub visible: bool,
}

fn mode_kind_name(mode: ModeKind) -> &'static str {
    match mode {
        ModeKind::Plan => "plan",
        ModeKind::Default => "default",
    }
}

fn mode_kind_from_name(name: &str) -> Option<ModeKind> {
    match name {
        "plan" => Some(ModeKind::Plan),
        "default" => Some(ModeKind::Default),
        _ => None,
    }
}

/// `collaborationMode/list` — the presets behind the Official App's 计划模式
/// entry. Experimental; `experimental_api: true` is set at startup.
#[tauri::command]
pub async fn list_collaboration_modes(
    bridge: State<'_, AppServerBridge>,
) -> CmdResult<Vec<CollaborationModePreset>> {
    let response = bridge
        .request(ClientRequest::CollaborationModeList {
            request_id: bridge.next_request_id(),
            params: CollaborationModeListParams {},
        })
        .await?;

    let response: CollaborationModeListResponse =
        serde_json::from_value(response).map_err(|err| format!("collaborationMode/list: {err}"))?;

    Ok(response
        .data
        .into_iter()
        .map(|mask| CollaborationModePreset {
            name: mask.name,
            mode: mask.mode.map(|mode| mode_kind_name(mode).to_string()),
            model: mask.model,
            visible: mask.mode.is_none_or(ModeKind::is_tui_visible),
        })
        .collect())
}

/// Applies a collaboration-mode preset to a thread.
///
/// The engine's model is base-plus-mask, not a flag: the client holds an
/// unmasked `CollaborationMode` (always `Default` kind) and derives the
/// effective mode by applying a preset mask on top
/// (`chatwidget/settings.rs::effective_collaboration_mode`). That merge is done
/// here by the engine's own `CollaborationMode::apply_mask` rather than
/// re-implemented, so a future change to how a mask overrides the base cannot
/// drift (ADR-0021).
///
/// `developer_instructions` is left `None` deliberately —
/// `ThreadSettingsUpdateParams`'s own doc says null means "use the built-in
/// instructions for the selected mode", which is exactly what selecting a
/// preset should do.
#[tauri::command]
pub async fn set_collaboration_mode(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    mode: String,
    model: Option<String>,
    effort: Option<ReasoningEffort>,
) -> CmdResult<JsonValue> {
    let mode_kind =
        mode_kind_from_name(&mode).ok_or_else(|| format!("unknown collaboration mode: {mode}"))?;

    let base = CollaborationMode {
        mode: ModeKind::Default,
        settings: Settings {
            model: model.unwrap_or_default(),
            reasoning_effort: effort,
            developer_instructions: None,
        },
    };
    let mask = CoreCollaborationModeMask {
        name: mode.clone(),
        mode: Some(mode_kind),
        model: None,
        reasoning_effort: None,
        developer_instructions: None,
    };

    bridge
        .request(ClientRequest::ThreadSettingsUpdate {
            request_id: bridge.next_request_id(),
            params: ThreadSettingsUpdateParams {
                thread_id,
                collaboration_mode: Some(base.apply_mask(&mask)),
                ..Default::default()
            },
        })
        .await
}

/// `thread/compact/start` — the TUI's `/compact`.
#[tauri::command]
pub async fn compact_thread(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ThreadCompactStart {
            request_id: bridge.next_request_id(),
            params: ThreadCompactStartParams { thread_id },
        })
        .await
}

/// What the review should look at. Flattened from `ReviewTarget` so the
/// frontend sends one flat object; the tagged union is rebuilt here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewTargetInput {
    UncommittedChanges,
    BaseBranch { branch: String },
    Commit { sha: String, title: Option<String> },
    Custom { instructions: String },
}

impl From<ReviewTargetInput> for ReviewTarget {
    fn from(value: ReviewTargetInput) -> Self {
        match value {
            ReviewTargetInput::UncommittedChanges => ReviewTarget::UncommittedChanges,
            ReviewTargetInput::BaseBranch { branch } => ReviewTarget::BaseBranch { branch },
            ReviewTargetInput::Commit { sha, title } => ReviewTarget::Commit { sha, title },
            ReviewTargetInput::Custom { instructions } => ReviewTarget::Custom { instructions },
        }
    }
}

/// Where the review runs. The Official App exposes this as "代码审查发送方式"
/// (在此聊天中进行 / 独立), which maps onto the protocol's `ReviewDelivery` —
/// so it is a real user choice, not an implementation detail to hardcode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDeliveryInput {
    Inline,
    Detached,
}

impl From<ReviewDeliveryInput> for ReviewDelivery {
    fn from(value: ReviewDeliveryInput) -> Self {
        match value {
            ReviewDeliveryInput::Inline => ReviewDelivery::Inline,
            ReviewDeliveryInput::Detached => ReviewDelivery::Detached,
        }
    }
}

/// `review/start` — the CLI's `codex review`.
///
/// Returns the raw response because the caller needs `reviewThreadId`: for a
/// detached review that is a *different* thread, and leaving the user with no
/// way to reach it would be a dead end.
#[tauri::command]
pub async fn start_review(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    target: ReviewTargetInput,
    delivery: Option<ReviewDeliveryInput>,
) -> CmdResult<JsonValue> {
    bridge
        .request(ClientRequest::ReviewStart {
            request_id: bridge.next_request_id(),
            params: ReviewStartParams {
                thread_id,
                target: target.into(),
                delivery: delivery.map(Into::into),
            },
        })
        .await
}

/// What the composer shows for context pressure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// `None` when the model's context window is unknown, in which case the
    /// UI shows used tokens instead of a percentage — the same fallback the
    /// TUI makes (`chatwidget.rs::context_used_tokens`).
    pub percent_remaining: Option<i64>,
    pub used_tokens: i64,
}

/// Computes context pressure using the engine's own
/// `TokenUsage::percent_of_context_window_remaining`.
///
/// This is a Tauri command rather than TypeScript arithmetic on purpose: the
/// formula subtracts an engine-owned `BASELINE_TOKENS` (12,000 at the time of
/// writing) from both sides, and a copy of that constant in the frontend would
/// silently drift from the engine on the next upstream merge (ADR-0021).
///
/// Note it reads `last`, not `total` — matching `chatwidget.rs::
/// context_remaining_percent`. `last` is what currently occupies the window;
/// `total` is cumulative across the thread and would keep climbing past 100%.
#[tauri::command]
pub fn context_usage(
    last_total_tokens: i64,
    total_tokens_in_window: i64,
    model_context_window: Option<i64>,
) -> ContextUsage {
    let last = TokenUsage {
        total_tokens: last_total_tokens,
        ..Default::default()
    };
    ContextUsage {
        percent_remaining: model_context_window
            .map(|window| last.percent_of_context_window_remaining(window)),
        used_tokens: total_tokens_in_window,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

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

    /// Quoting follows `chat_composer.rs::insert_selected_path` exactly:
    /// whitespace forces quotes, an existing quote suppresses them.
    #[test]
    fn file_ref_paths_are_quoted_like_the_tui() {
        assert_eq!(quote_path_for_prompt("src/main.rs"), "src/main.rs");
        assert_eq!(quote_path_for_prompt("my docs/a.md"), "\"my docs/a.md\"");
        assert_eq!(quote_path_for_prompt("odd \"name\".md"), "odd \"name\".md");
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
}
