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
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::ReviewDelivery;
use codex_app_server_protocol::ReviewStartParams;
use codex_app_server_protocol::ReviewTarget;
use codex_app_server_protocol::SkillsListParams;
use codex_app_server_protocol::ThreadCompactStartParams;
use codex_app_server_protocol::ThreadQueueAddParams;
use codex_app_server_protocol::ThreadSettingsUpdateParams;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::TurnSteerParams;
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
use crate::bridge::RequestFailure;
use crate::cmd::CmdResult;
use crate::mention_naming::connector_name_slug;
use crate::mention_naming::plugin_mention_name;
use crate::mention_naming::quote_path_for_prompt;

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

/// How a submission that raced a running turn was resolved.
///
/// Steering is not a separate user intent in the engine's model: the TUI has
/// one submit action and picks steer / start / queue from live state and the
/// server's answer (`tui/src/app/thread_routing.rs`). This mirrors that, and
/// reports which path was taken so the UI can say what happened rather than
/// leaving the user guessing where their message went.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum TurnSubmission {
    /// Folded into the turn already running.
    Steered { turn_id: String },
    /// No turn was running (or it ended mid-submit), so a new one started.
    Started,
    /// The active turn refuses steering (review and compaction turns do), so
    /// the message was queued to run next instead of being dropped.
    Queued,
}

/// Why a `turn/steer` failed, when the reason is one this client can act on.
///
/// Ported from `active_turn_steer_race` in `tui/src/app.rs`. The engine
/// reports these as message text, so the strings are matched exactly as the
/// TUI matches them.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SteerRace {
    /// The turn ended between reading the active turn id and steering it.
    Missing,
    /// Our cached active turn id is stale; the server names the real one.
    ExpectedTurnMismatch { actual_turn_id: String },
}

fn steer_race(error: &JSONRPCErrorError) -> Option<SteerRace> {
    if error.message == "no active turn to steer" {
        return Some(SteerRace::Missing);
    }
    // e.g. "expected active turn id `abc` but found `def`"
    let actual_turn_id = error
        .message
        .strip_prefix("expected active turn id `")?
        .split_once("` but found `")?
        .1
        .strip_suffix('`')?
        .to_string();
    Some(SteerRace::ExpectedTurnMismatch { actual_turn_id })
}

/// True when the engine refused because this kind of turn cannot be steered.
///
/// Unlike the races above this arrives in `error.data.codexErrorInfo`, not the
/// message — which is why submission uses the bridge's detail-preserving
/// request path.
fn active_turn_not_steerable(error: &JSONRPCErrorError) -> bool {
    let Some(data) = error.data.as_ref() else {
        return false;
    };
    data.get("codexErrorInfo")
        .and_then(|info| info.get("type"))
        .and_then(JsonValue::as_str)
        == Some("activeTurnNotSteerable")
}

/// Submits composer input, choosing steer / start / queue the way the TUI
/// does.
///
/// `active_turn_id` is the turn the frontend believes is running, or `None`
/// when it believes the thread is idle. Every branch below exists because the
/// belief can be wrong by the time the request lands.
#[tauri::command]
pub async fn submit_turn(
    bridge: State<'_, AppServerBridge>,
    thread_id: String,
    active_turn_id: Option<String>,
    text: String,
    attachments: Vec<ComposerAttachment>,
    skills: Vec<ComposerSkill>,
    file_refs: Vec<ComposerFileRef>,
    mentions: Vec<ComposerMention>,
) -> CmdResult<TurnSubmission> {
    let input = build_turn_input(text, attachments, skills, file_refs, mentions);
    // One id for this submission, carried down whichever branch it takes. The
    // server echoes it back as `UserMessageItem.client_id`, so a client can tie
    // the item it receives to the message it sent; minting a fresh id per
    // branch would break that correlation exactly when the submission raced and
    // correlation matters most. `queue/add` requires the field outright, and
    // the TUI sets it on `turn/start` too.
    let client_user_message_id = uuid::Uuid::now_v7().to_string();

    if let Some(turn_id) = active_turn_id {
        let mut steer_turn_id = turn_id;
        let mut retried_after_mismatch = false;
        loop {
            let result = bridge
                .request_detailed(ClientRequest::TurnSteer {
                    request_id: bridge.next_request_id(),
                    params: TurnSteerParams {
                        thread_id: thread_id.clone(),
                        input: input.clone(),
                        expected_turn_id: steer_turn_id.clone(),
                        client_user_message_id: Some(client_user_message_id.clone()),
                        responsesapi_client_metadata: None,
                        additional_context: None,
                    },
                })
                .await;

            let failure = match result {
                Ok(value) => {
                    let turn_id = value
                        .get("turnId")
                        .and_then(JsonValue::as_str)
                        .unwrap_or(&steer_turn_id)
                        .to_string();
                    return Ok(TurnSubmission::Steered { turn_id });
                }
                Err(failure) => failure,
            };

            let RequestFailure::Server(error) = &failure else {
                return Err(failure.into());
            };

            if active_turn_not_steerable(error) {
                // Not an error the user should see: the message is still
                // wanted, just after this turn. Queue rather than drop it.
                queue_turn_input(&bridge, &thread_id, input, client_user_message_id).await?;
                return Ok(TurnSubmission::Queued);
            }

            match steer_race(error) {
                // The turn finished first; fall through and start a new one.
                Some(SteerRace::Missing) => break,
                // Review flows can swap the active turn before its
                // notification arrives. Retry once against the turn the
                // server names, then give up rather than loop.
                Some(SteerRace::ExpectedTurnMismatch { actual_turn_id })
                    if !retried_after_mismatch && actual_turn_id != steer_turn_id =>
                {
                    steer_turn_id = actual_turn_id;
                    retried_after_mismatch = true;
                }
                _ => return Err(failure.into()),
            }
        }
    }

    bridge
        .request(ClientRequest::TurnStart {
            request_id: bridge.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input,
                client_user_message_id: Some(client_user_message_id),
                // The remaining fields are per-turn *overrides* on top of the
                // thread's settings (`build_thread_settings_overrides` in
                // `turn_processor.rs`). This client applies model, effort,
                // approval mode and collaboration mode through
                // `thread/settings/update` instead, so leaving them unset is
                // what makes the turn honour those settings rather than
                // pinning a snapshot of them per turn.
                ..Default::default()
            },
        })
        .await?;
    Ok(TurnSubmission::Started)
}

/// Queues already-built input. Mirrors `thread_ops::queue_add`, which builds
/// its input from the same `build_turn_input`, so a queued fallback is
/// indistinguishable from an explicitly queued message.
async fn queue_turn_input(
    bridge: &AppServerBridge,
    thread_id: &str,
    input: Vec<UserInput>,
    client_user_message_id: String,
) -> CmdResult<()> {
    bridge
        .request(ClientRequest::ThreadQueueAdd {
            request_id: bridge.next_request_id(),
            params: ThreadQueueAddParams {
                thread_id: thread_id.to_string(),
                input,
                // Required by the API (non-`Option` on the wire). Carried in
                // from the caller so a submission that fell back to the queue
                // keeps the id it would have had as a turn.
                client_user_message_id,
            },
        })
        .await
        .map(|_| ())
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
    let response: FuzzyFileSearchResponse = bridge
        .request_as(ClientRequest::FuzzyFileSearch {
            request_id: bridge.next_request_id(),
            params: FuzzyFileSearchParams {
                query,
                roots,
                cancellation_token: Some(cancellation_token),
            },
        })
        .await?;

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
    let response: CollaborationModeListResponse = bridge
        .request_as(ClientRequest::CollaborationModeList {
            request_id: bridge.next_request_id(),
            params: CollaborationModeListParams {},
        })
        .await?;

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
    BaseBranch {
        branch: String,
    },
    Commit {
        sha: String,
        title: Option<String>,
    },
    /// Subversion's counterpart to `Commit`. A separate variant rather than a
    /// revision squeezed into `sha`, matching the protocol.
    Revision {
        revision: String,
        title: Option<String>,
    },
    Custom {
        instructions: String,
    },
}

impl From<ReviewTargetInput> for ReviewTarget {
    fn from(value: ReviewTargetInput) -> Self {
        match value {
            ReviewTargetInput::UncommittedChanges => ReviewTarget::UncommittedChanges,
            ReviewTargetInput::BaseBranch { branch } => ReviewTarget::BaseBranch { branch },
            ReviewTargetInput::Commit { sha, title } => ReviewTarget::Commit { sha, title },
            ReviewTargetInput::Revision { revision, title } => {
                ReviewTarget::Revision { revision, title }
            }
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
#[path = "composer_tests.rs"]
mod tests;
