//! hcodex tests for `manager.rs`, kept out of upstream's `manager_tests.rs` so
//! a sync does not conflict when upstream appends tests there.
use super::*;
use crate::ModelsManagerConfig;
use codex_http_client::HttpClientFactory;
use codex_http_client::OutboundProxyPolicy;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelOrigin;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use pretty_assertions::assert_eq;
use serde_json::json;
use tempfile::tempdir;

const DEFAULT_HTTP_CLIENT_FACTORY: HttpClientFactory =
    HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault);

/// Same fixture as `remote_model` in `manager_tests.rs` (private to that module).
fn remote_model(slug: &str, display: &str, priority: i32) -> ModelInfo {
    serde_json::from_value(json!({
            "slug": slug,
            "display_name": display,
            "description": format!("{display} desc"),
            "default_reasoning_level": "medium",
            "supported_reasoning_levels": [{"effort": "low", "description": "low"}, {"effort": "medium", "description": "medium"}],
            "shell_type": "shell_command",
            "visibility": "list",
            "minimal_client_version": [0, 1, 0],
            "supported_in_api": true,
            "priority": priority,
            "upgrade": null,
            "model_messages": {
                "instructions_template": "base instructions",
                "approvals": null,
                "auto_review": null,
                "permissions": null
            },
            "support_verbosity": false,
            "default_verbosity": null,
            "apply_patch_tool_type": null,
            "truncation_policy": {"mode": "bytes", "limit": 10_000},
            "supports_image_detail_original": false,
            "context_window": 272_000,
            "max_context_window": 272_000,
            "experimental_supported_tools": [],
        }))
        .expect("valid model")
}

fn static_manager_for_tests(model_catalog: ModelsResponse) -> StaticModelsManager {
    StaticModelsManager::new(
        /*auth_manager*/ None,
        model_catalog,
        ModelOrigin::ExplicitConfig,
    )
}

#[tokio::test]
async fn model_overrides_are_shared_by_picker_and_runtime_with_explicit_config_winning() {
    let directory = tempdir().expect("temp dir");
    let overrides_path = directory.path().join(crate::MODEL_OVERRIDES_FILE);
    std::fs::write(
        &overrides_path,
        r#"
[models."model-a"]
context_window = 180000
default_reasoning_effort = "high"
supported_reasoning_efforts = ["high", "xhigh"]
input_modalities = ["text"]
instructions = "Model-specific prompt"
"#,
    )
    .expect("write model overrides");
    let config = ModelsManagerConfig {
        model_context_window: Some(220_000),
        base_instructions: Some("Explicit prompt".to_string()),
        model_provider_id: Some("cliproxy".to_string()),
        model_overrides: crate::ModelOverrides::load_optional(&overrides_path)
            .expect("load model overrides"),
        ..Default::default()
    };
    let manager = static_manager_for_tests(ModelsResponse {
        models: vec![remote_model("model-a", "Model A", /*priority*/ 0)],
    });

    let picker_models = manager
        .list_models_with_config(
            RefreshStrategy::Offline,
            DEFAULT_HTTP_CLIENT_FACTORY,
            &config,
        )
        .await;
    let picker_model = picker_models.first().expect("picker model");
    assert_eq!(picker_model.default_reasoning_effort, ReasoningEffort::High);
    assert_eq!(
        picker_model
            .supported_reasoning_efforts
            .iter()
            .map(|preset| preset.effort.clone())
            .collect::<Vec<_>>(),
        vec![ReasoningEffort::High, ReasoningEffort::XHigh]
    );
    assert_eq!(picker_model.input_modalities, vec![InputModality::Text]);

    let runtime_model = manager.get_model_info("model-a", &config).await;
    assert_eq!(runtime_model.context_window, Some(220_000));
    assert_eq!(
        runtime_model.default_reasoning_level,
        Some(ReasoningEffort::High)
    );
    assert_eq!(runtime_model.input_modalities, vec![InputModality::Text]);
    assert_eq!(
        codex_prompts::render_model_instructions(&runtime_model),
        "Explicit prompt"
    );
}
