use super::canonical_tool_name;
use super::flatten_namespace_specs;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiNamespace;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use pretty_assertions::assert_eq;
use std::collections::BTreeMap;

fn function(name: &str) -> ResponsesApiTool {
    ResponsesApiTool {
        name: name.to_string(),
        description: format!("{name} tool"),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            BTreeMap::from([(
                "message".to_string(),
                JsonSchema::string(None).with_encrypted(),
            )]),
            Some(vec!["message".to_string()]),
            None,
        ),
        output_schema: None,
    }
}

#[test]
fn namespaces_become_flat_functions_and_calls_map_back() {
    let specs = vec![
        ToolSpec::Function(function("exec_command")),
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: "collaboration".to_string(),
            description: "Tools for spawning and managing sub-agents.".to_string(),
            tools: vec![
                ResponsesApiNamespaceTool::Function(function("spawn_agent")),
                ResponsesApiNamespaceTool::Function(function("send_message")),
            ],
        }),
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: "mcp__openviking_memory".to_string(),
            description: String::new(),
            tools: vec![ResponsesApiNamespaceTool::Function(function("search"))],
        }),
    ];

    let flattened = flatten_namespace_specs(specs);

    let names = flattened
        .specs
        .iter()
        .map(|spec| spec.name().to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            "exec_command",
            "collaboration__spawn_agent",
            "collaboration__send_message",
            "mcp__openviking_memory__search",
        ]
    );
    assert!(
        flattened
            .specs
            .iter()
            .all(|spec| !matches!(spec, ToolSpec::Namespace(_)))
    );

    let ToolSpec::Function(spawn) = &flattened.specs[1] else {
        panic!("spawn_agent should be a flat function");
    };
    let encrypted = spawn
        .parameters
        .properties
        .as_ref()
        .and_then(|properties| properties.get("message"))
        .and_then(|schema| schema.encrypted);
    assert_eq!(encrypted, None, "encrypted markers are OpenAI-only");

    assert_eq!(
        canonical_tool_name(
            &flattened.flat_tool_names,
            &ToolName::plain("collaboration__spawn_agent")
        ),
        Some(ToolName::namespaced("collaboration", "spawn_agent"))
    );
    assert_eq!(
        canonical_tool_name(
            &flattened.flat_tool_names,
            &ToolName::plain("collaboration__spawn_agent").with_default_namespace()
        ),
        Some(ToolName::namespaced("collaboration", "spawn_agent"))
    );
    assert_eq!(
        canonical_tool_name(&flattened.flat_tool_names, &ToolName::plain("exec_command")),
        None
    );
    assert_eq!(
        canonical_tool_name(
            &flattened.flat_tool_names,
            &ToolName::namespaced("collaboration", "spawn_agent")
        ),
        None,
        "already-namespaced calls are left alone"
    );
}
