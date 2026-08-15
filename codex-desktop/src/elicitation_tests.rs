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
        McpElicitationSingleSelectEnumSchema::Titled(McpElicitationTitledSingleSelectEnumSchema {
            type_: McpElicitationStringType::String,
            title: Some("Environment".to_string()),
            description: None,
            one_of: vec![McpElicitationConstOption {
                const_: "prod".to_string(),
                title: "Production".to_string(),
            }],
            default: None,
        }),
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
