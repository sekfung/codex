//! Flattens MCP elicitation form schemas into something renderable, and
//! builds the response back.
//!
//! `McpElicitationPrimitiveSchema` is four `#[serde(untagged)]` layers deep
//! in places — `Enum(Enum(SingleSelect(Titled|Untitled)))` — plus renamed
//! fields (`enum`, `oneOf`, `anyOf`, `const`, `enumNames`, `$schema`) and a
//! custom integer serializer. Reproducing that shape in TypeScript is the
//! trap that has already produced one window-blanking crash in this app, and
//! `tsc` cannot check any of it. So the whole schema is reduced here to a
//! flat `Vec<ElicitationField>` the frontend renders without knowing the
//! protocol at all, and answers come back as a flat map that this module
//! turns into the response object.

use codex_app_server_protocol::McpElicitationEnumSchema;
use codex_app_server_protocol::McpElicitationMultiSelectEnumSchema;
use codex_app_server_protocol::McpElicitationNumberType;
use codex_app_server_protocol::McpElicitationPrimitiveSchema;
use codex_app_server_protocol::McpElicitationSchema;
use codex_app_server_protocol::McpElicitationSingleSelectEnumSchema;
use codex_app_server_protocol::McpServerElicitationRequest;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;
use serde_json::json;

/// One renderable form control.
///
/// Round-trips: the frontend sends these back with the user's answers so
/// [`accept_content`] knows each field's declared type without re-deriving it
/// from the schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationField {
    /// Property name; the key this field's answer goes under in `content`.
    pub key: String,
    pub label: String,
    pub description: Option<String>,
    pub required: bool,
    pub control: ElicitationControl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ElicitationControl {
    Text {
        default: Option<String>,
        /// `email`/`uri`/`date`/… — a hint for the input type, not validation
        /// this client enforces; the MCP server is the authority on that.
        format: Option<String>,
        min_length: Option<u32>,
        max_length: Option<u32>,
    },
    Number {
        /// Integer vs. float, so the control can step correctly.
        integer: bool,
        default: Option<f64>,
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
    Boolean {
        default: Option<bool>,
    },
    Select {
        options: Vec<ElicitationOption>,
        default: Option<String>,
    },
    MultiSelect {
        options: Vec<ElicitationOption>,
        default: Vec<String>,
        min_items: Option<u64>,
        max_items: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationOption {
    /// The value sent back.
    pub value: String,
    /// What the user reads. Falls back to `value` when the schema carries no
    /// separate title.
    pub label: String,
}

/// What the frontend renders for one elicitation request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationView {
    pub message: String,
    /// `form`, `openai/form` or `url` — the frontend branches on this only
    /// for presentation.
    pub mode: String,
    /// Present for `url` mode: the page the user is asked to visit.
    pub url: Option<String>,
    /// Empty for `url` mode, and for schemas this build cannot render.
    pub fields: Vec<ElicitationField>,
    /// Set when the request carries a form this build cannot represent. The
    /// card explains it and offers only decline/cancel, rather than
    /// pretending to have collected input it never showed.
    pub unrenderable_reason: Option<String>,
}

pub fn view_for(request: &McpServerElicitationRequest) -> ElicitationView {
    match request {
        McpServerElicitationRequest::Form {
            message,
            requested_schema,
            ..
        } => ElicitationView {
            message: message.clone(),
            mode: "form".to_string(),
            url: None,
            fields: fields_for(requested_schema),
            unrenderable_reason: None,
        },
        // Gated behind the `mcpServerOpenaiFormElicitation` capability, which
        // `main.rs` sets to `false`, so the engine should never send this. If
        // it arrives anyway the schema is a bare `JsonValue` with no declared
        // shape — there is nothing to render faithfully, and guessing would
        // be inventing a form. The user can still decline or cancel, which is
        // what matters: the request gets answered.
        McpServerElicitationRequest::OpenAiForm { message, .. } => ElicitationView {
            message: message.clone(),
            mode: "openai/form".to_string(),
            url: None,
            fields: Vec::new(),
            unrenderable_reason: Some(
                "此表单需要 openai/form 支持，当前版本未启用，无法在此填写。".to_string(),
            ),
        },
        McpServerElicitationRequest::Url { message, url, .. } => ElicitationView {
            message: message.clone(),
            mode: "url".to_string(),
            url: Some(url.clone()),
            fields: Vec::new(),
            unrenderable_reason: None,
        },
    }
}

fn fields_for(schema: &McpElicitationSchema) -> Vec<ElicitationField> {
    let required = schema.required.clone().unwrap_or_default();
    schema
        .properties
        .iter()
        .map(|(key, property)| {
            let (label, description, control) = control_for(key, property);
            ElicitationField {
                key: key.clone(),
                label,
                description,
                required: required.contains(key),
                control,
            }
        })
        .collect()
}

/// Collapses the untagged schema tower into one control. Titles fall back to
/// the property key so a field is never rendered nameless.
fn control_for(
    key: &str,
    property: &McpElicitationPrimitiveSchema,
) -> (String, Option<String>, ElicitationControl) {
    match property {
        McpElicitationPrimitiveSchema::String(schema) => (
            schema.title.clone().unwrap_or_else(|| key.to_string()),
            schema.description.clone(),
            ElicitationControl::Text {
                default: schema.default.clone(),
                format: schema
                    .format
                    .map(|format| {
                        serde_json::to_value(format)
                            .ok()
                            .and_then(|value| value.as_str().map(str::to_owned))
                            .unwrap_or_default()
                    })
                    .filter(|format| !format.is_empty()),
                min_length: schema.min_length,
                max_length: schema.max_length,
            },
        ),
        McpElicitationPrimitiveSchema::Number(schema) => (
            schema.title.clone().unwrap_or_else(|| key.to_string()),
            schema.description.clone(),
            ElicitationControl::Number {
                integer: schema.type_ == McpElicitationNumberType::Integer,
                default: schema.default,
                minimum: schema.minimum,
                maximum: schema.maximum,
            },
        ),
        McpElicitationPrimitiveSchema::Boolean(schema) => (
            schema.title.clone().unwrap_or_else(|| key.to_string()),
            schema.description.clone(),
            ElicitationControl::Boolean {
                default: schema.default,
            },
        ),
        McpElicitationPrimitiveSchema::Enum(schema) => enum_control(key, schema),
    }
}

fn enum_control(
    key: &str,
    schema: &McpElicitationEnumSchema,
) -> (String, Option<String>, ElicitationControl) {
    match schema {
        // `enum` + optional parallel `enumNames`. The arrays can disagree in
        // length, so pair positionally and fall back to the value.
        McpElicitationEnumSchema::Legacy(legacy) => (
            legacy.title.clone().unwrap_or_else(|| key.to_string()),
            legacy.description.clone(),
            ElicitationControl::Select {
                options: legacy
                    .enum_
                    .iter()
                    .enumerate()
                    .map(|(index, value)| ElicitationOption {
                        value: value.clone(),
                        label: legacy
                            .enum_names
                            .as_ref()
                            .and_then(|names| names.get(index))
                            .cloned()
                            .unwrap_or_else(|| value.clone()),
                    })
                    .collect(),
                default: legacy.default.clone(),
            },
        ),
        McpElicitationEnumSchema::SingleSelect(single) => match single {
            McpElicitationSingleSelectEnumSchema::Untitled(inner) => (
                inner.title.clone().unwrap_or_else(|| key.to_string()),
                inner.description.clone(),
                ElicitationControl::Select {
                    options: inner
                        .enum_
                        .iter()
                        .map(|value| ElicitationOption {
                            value: value.clone(),
                            label: value.clone(),
                        })
                        .collect(),
                    default: inner.default.clone(),
                },
            ),
            McpElicitationSingleSelectEnumSchema::Titled(inner) => (
                inner.title.clone().unwrap_or_else(|| key.to_string()),
                inner.description.clone(),
                ElicitationControl::Select {
                    options: inner
                        .one_of
                        .iter()
                        .map(|option| ElicitationOption {
                            value: option.const_.clone(),
                            label: option.title.clone(),
                        })
                        .collect(),
                    default: inner.default.clone(),
                },
            ),
        },
        McpElicitationEnumSchema::MultiSelect(multi) => match multi {
            McpElicitationMultiSelectEnumSchema::Untitled(inner) => (
                inner.title.clone().unwrap_or_else(|| key.to_string()),
                inner.description.clone(),
                ElicitationControl::MultiSelect {
                    options: inner
                        .items
                        .enum_
                        .iter()
                        .map(|value| ElicitationOption {
                            value: value.clone(),
                            label: value.clone(),
                        })
                        .collect(),
                    default: inner.default.clone().unwrap_or_default(),
                    min_items: inner.min_items,
                    max_items: inner.max_items,
                },
            ),
            McpElicitationMultiSelectEnumSchema::Titled(inner) => (
                inner.title.clone().unwrap_or_else(|| key.to_string()),
                inner.description.clone(),
                ElicitationControl::MultiSelect {
                    options: inner
                        .items
                        .any_of
                        .iter()
                        .map(|option| ElicitationOption {
                            value: option.const_.clone(),
                            label: option.title.clone(),
                        })
                        .collect(),
                    default: inner.default.clone().unwrap_or_default(),
                    min_items: inner.min_items,
                    max_items: inner.max_items,
                },
            ),
        },
    }
}

/// One answer from the frontend, kept deliberately flat and stringly-typed:
/// the frontend collects what the user typed or picked, and this module is
/// the only thing that knows how to turn it into the JSON the schema wants.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationAnswer {
    pub key: String,
    /// Present for text/number/select controls.
    pub value: Option<String>,
    /// Present for boolean controls.
    pub checked: Option<bool>,
    /// Present for multi-select controls.
    pub values: Option<Vec<String>>,
}

/// Builds the `content` object for an accepted elicitation.
///
/// Values are typed from the *schema*, not guessed from the string: a number
/// field must send `3`, not `"3"`, or a server validating its own schema will
/// reject the response.
pub fn accept_content(fields: &[ElicitationField], answers: &[ElicitationAnswer]) -> JsonValue {
    let mut content = serde_json::Map::new();
    for field in fields {
        let Some(answer) = answers.iter().find(|answer| answer.key == field.key) else {
            continue;
        };
        let value = match &field.control {
            ElicitationControl::Boolean { .. } => answer.checked.map(JsonValue::from),
            ElicitationControl::Number { integer, .. } => answer.value.as_deref().and_then(|raw| {
                let raw = raw.trim();
                if raw.is_empty() {
                    return None;
                }
                if *integer {
                    raw.parse::<i64>().ok().map(JsonValue::from)
                } else {
                    raw.parse::<f64>().ok().map(JsonValue::from)
                }
            }),
            ElicitationControl::MultiSelect { .. } => answer
                .values
                .as_ref()
                .map(|values| JsonValue::from(values.clone())),
            ElicitationControl::Text { .. } | ElicitationControl::Select { .. } => answer
                .value
                .as_ref()
                .filter(|value| !value.is_empty())
                .map(|value| JsonValue::from(value.clone())),
        };
        if let Some(value) = value {
            content.insert(field.key.clone(), value);
        }
    }
    JsonValue::Object(content)
}

/// The response envelope. `action` is the engine's own
/// `McpServerElicitationAction` (`accept`/`decline`/`cancel`); `content` is
/// null for anything but accept, which the protocol documents explicitly.
pub fn response(action: &str, content: Option<JsonValue>) -> JsonValue {
    json!({
        "action": action,
        "content": if action == "accept" { content } else { None },
        // Left null: the protocol calls this "optional client metadata for
        // form-mode action handling" without defining what a client should
        // put there, and inventing a value would be guessing at semantics.
        "_meta": JsonValue::Null,
    })
}

/// Turns the raw `mcpServer/elicitation/request` params into the flat view
/// the card renders. Called from a Tauri command rather than at emit time so
/// the bridge stays a dumb pipe; the frontend hands back the params it
/// received and gets a renderable form.
#[tauri::command]
pub fn elicitation_view(params: JsonValue) -> Result<ElicitationView, String> {
    // The request is `#[serde(flatten)]`ed into the params alongside
    // `threadId`/`turnId`/`serverName`, so it deserializes straight from the
    // same object.
    let request: McpServerElicitationRequest = serde_json::from_value(params)
        .map_err(|err| format!("unrecognized elicitation request: {err}"))?;
    Ok(view_for(&request))
}

/// Answers a pending `mcpServer/elicitation/request`.
#[tauri::command]
pub async fn resolve_elicitation(
    bridge: tauri::State<'_, crate::bridge::AppServerBridge>,
    request_id: JsonValue,
    action: String,
    fields: Vec<ElicitationField>,
    answers: Vec<ElicitationAnswer>,
) -> Result<(), String> {
    let request_id =
        serde_json::from_value(request_id).map_err(|err| format!("invalid requestId: {err}"))?;
    let content = match action.as_str() {
        "accept" => Some(accept_content(&fields, &answers)),
        "decline" | "cancel" => None,
        other => return Err(format!("unknown elicitation action `{other}`")),
    };
    bridge
        .resolve_server_request(request_id, response(&action, content))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_app_server_protocol::McpElicitationBooleanSchema;
    use codex_app_server_protocol::McpElicitationBooleanType;
    use codex_app_server_protocol::McpElicitationConstOption;
    use codex_app_server_protocol::McpElicitationNumberSchema;
    use codex_app_server_protocol::McpElicitationStringType;
    use codex_app_server_protocol::McpElicitationTitledSingleSelectEnumSchema;

    fn field(key: &str, control: ElicitationControl) -> ElicitationField {
        ElicitationField {
            key: key.to_string(),
            label: key.to_string(),
            description: None,
            required: false,
            control,
        }
    }

    /// A number field must not answer with a string, or a server validating
    /// against its own schema rejects the whole response.
    #[test]
    fn numbers_are_sent_as_numbers_not_strings() {
        let fields = vec![
            field(
                "count",
                ElicitationControl::Number {
                    integer: true,
                    default: None,
                    minimum: None,
                    maximum: None,
                },
            ),
            field(
                "ratio",
                ElicitationControl::Number {
                    integer: false,
                    default: None,
                    minimum: None,
                    maximum: None,
                },
            ),
        ];
        let answers = vec![
            ElicitationAnswer {
                key: "count".to_string(),
                value: Some("3".to_string()),
                checked: None,
                values: None,
            },
            ElicitationAnswer {
                key: "ratio".to_string(),
                value: Some("1.5".to_string()),
                checked: None,
                values: None,
            },
        ];

        let content = accept_content(&fields, &answers);
        assert_eq!(content["count"], json!(3));
        assert_eq!(content["ratio"], json!(1.5));
    }

    #[test]
    fn booleans_use_checked_not_value() {
        let fields = vec![field(
            "agree",
            ElicitationControl::Boolean {
                default: Some(false),
            },
        )];
        let answers = vec![ElicitationAnswer {
            key: "agree".to_string(),
            value: None,
            checked: Some(true),
            values: None,
        }];
        assert_eq!(accept_content(&fields, &answers)["agree"], json!(true));
    }

    /// Decline and cancel carry no content — the protocol says content is
    /// "structured user input for accepted elicitations".
    #[test]
    fn only_accept_carries_content() {
        let content = json!({"a": 1});
        assert_eq!(
            response("accept", Some(content.clone()))["content"],
            content
        );
        assert_eq!(
            response("decline", Some(content.clone()))["content"],
            json!(null)
        );
        assert_eq!(response("cancel", Some(content))["content"], json!(null));
    }

    /// `oneOf` options carry a separate human title; the value sent back is
    /// `const`, not the title.
    #[test]
    fn titled_options_send_const_and_display_title() {
        let schema = McpElicitationPrimitiveSchema::Enum(McpElicitationEnumSchema::SingleSelect(
            McpElicitationSingleSelectEnumSchema::Titled(
                McpElicitationTitledSingleSelectEnumSchema {
                    type_: McpElicitationStringType::String,
                    title: Some("Environment".to_string()),
                    description: None,
                    one_of: vec![McpElicitationConstOption {
                        const_: "prod".to_string(),
                        title: "Production".to_string(),
                    }],
                    default: None,
                },
            ),
        ));

        let (label, _, control) = control_for("env", &schema);
        assert_eq!(label, "Environment");
        let ElicitationControl::Select { options, .. } = control else {
            panic!("a single-select schema must render as a select");
        };
        assert_eq!(options[0].value, "prod");
        assert_eq!(options[0].label, "Production");
    }

    /// A field with no title still needs a name in the UI.
    #[test]
    fn untitled_fields_fall_back_to_their_key() {
        let schema = McpElicitationPrimitiveSchema::Boolean(McpElicitationBooleanSchema {
            type_: McpElicitationBooleanType::Boolean,
            title: None,
            description: None,
            default: None,
        });
        let (label, _, _) = control_for("dry_run", &schema);
        assert_eq!(label, "dry_run");
    }

    #[test]
    fn integer_and_float_schemas_are_distinguished() {
        let schema = McpElicitationPrimitiveSchema::Number(McpElicitationNumberSchema {
            type_: McpElicitationNumberType::Integer,
            title: None,
            description: None,
            minimum: Some(1.0),
            maximum: Some(10.0),
            default: None,
        });
        let (_, _, control) = control_for("count", &schema);
        assert!(
            matches!(control, ElicitationControl::Number { integer: true, .. }),
            "integer schemas must be marked so the control can step correctly"
        );
    }
}
