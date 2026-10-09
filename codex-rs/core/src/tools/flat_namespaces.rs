//! hcodex: flatten Responses API `namespace` tool specs into plain function
//! tools for providers that do not understand them.
//!
//! The `namespace` tool type is OpenAI-only. Local proxies and gateways that
//! translate to Anthropic/Gemini APIs (Kiro-Go, cliproxy, LiteLLM, ...) drop
//! unknown tool types, which silently removes multi-agent v2 and MCP tools
//! from the model. For such providers every nested tool is advertised as a
//! top-level function named like code mode does (`<namespace>__<tool>`), and
//! calls that come back under the flat name are mapped to the namespaced tool
//! before dispatch.

use codex_tools::JsonSchema;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use codex_tools::code_mode_name_for_tool_name;
use std::collections::BTreeMap;

/// Specs ready for the model plus the flat-name -> namespaced-name map used to
/// route calls back.
pub(crate) struct FlattenedToolSpecs {
    pub(crate) specs: Vec<ToolSpec>,
    pub(crate) flat_tool_names: BTreeMap<String, ToolName>,
}

pub(crate) fn flatten_namespace_specs(specs: Vec<ToolSpec>) -> FlattenedToolSpecs {
    let mut flat_specs = Vec::with_capacity(specs.len());
    let mut flat_tool_names = BTreeMap::new();
    for spec in specs {
        let ToolSpec::Namespace(namespace) = spec else {
            flat_specs.push(spec);
            continue;
        };
        for tool in namespace.tools {
            let (tool_name, spec) = match tool {
                ResponsesApiNamespaceTool::Function(mut tool) => {
                    let tool_name = ToolName::namespaced(namespace.name.clone(), tool.name.clone());
                    tool.name = code_mode_name_for_tool_name(&tool_name);
                    strip_encrypted_markers(&mut tool.parameters);
                    (tool_name, ToolSpec::Function(tool))
                }
                ResponsesApiNamespaceTool::Custom(mut tool) => {
                    let tool_name = ToolName::namespaced(namespace.name.clone(), tool.name.clone());
                    tool.name = code_mode_name_for_tool_name(&tool_name);
                    (tool_name, ToolSpec::Freeform(tool))
                }
            };
            flat_tool_names.insert(spec.name().to_string(), tool_name);
            flat_specs.push(spec);
        }
    }
    FlattenedToolSpecs {
        specs: flat_specs,
        flat_tool_names,
    }
}

/// Maps a call that arrived under a flat name back to its namespaced tool.
/// Calls that already carry a namespace, or that match no flattened tool, are
/// returned unchanged.
pub(crate) fn canonical_tool_name(
    flat_tool_names: &BTreeMap<String, ToolName>,
    tool_name: &ToolName,
) -> Option<ToolName> {
    if !tool_name.is_default_namespace() {
        return None;
    }
    flat_tool_names.get(&tool_name.name).cloned()
}

/// `encrypted` is a Responses-only schema marker; third-party APIs may reject
/// unknown keywords and a proxy never encrypts arguments anyway.
fn strip_encrypted_markers(schema: &mut JsonSchema) {
    schema.encrypted = None;
    if let Some(items) = schema.items.as_mut() {
        strip_encrypted_markers(items);
    }
    for nested in [
        schema.properties.as_mut(),
        schema.defs.as_mut(),
        schema.definitions.as_mut(),
    ]
    .into_iter()
    .flatten()
    {
        for schema in nested.values_mut() {
            strip_encrypted_markers(schema);
        }
    }
    for variants in [
        schema.any_of.as_mut(),
        schema.one_of.as_mut(),
        schema.all_of.as_mut(),
    ]
    .into_iter()
    .flatten()
    {
        for schema in variants {
            strip_encrypted_markers(schema);
        }
    }
}

#[cfg(test)]
#[path = "flat_namespaces_tests.rs"]
mod tests;
