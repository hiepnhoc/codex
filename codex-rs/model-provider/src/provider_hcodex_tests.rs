//! hcodex tests for `provider.rs`, kept out of upstream's `provider_tests.rs`
//! so a sync does not conflict there.
use super::*;
use codex_http_client::HttpClientFactory;
use codex_http_client::OutboundProxyPolicy;
use codex_model_provider_info::WireApi;
use codex_models_manager::manager::RefreshStrategy;
use codex_protocol::openai_models::ModelsResponse;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn proxy_provider_normalizes_static_model_catalog_instructions() {
    let provider = create_model_provider(
        ModelProviderInfo {
            name: "Proxy".to_string(),
            base_url: Some("http://localhost:1234/v1".to_string()),
            wire_api: WireApi::Responses,
            requires_openai_auth: false,
            ..Default::default()
        },
        /*auth_manager*/ None,
    );
    let mut model = codex_models_manager::model_info::model_info_from_slug("qwen3-coder");
    model
        .model_messages
        .as_mut()
        .expect("fallback model messages")
        .instructions_template =
        Some("You are Codex, a coding agent based on GPT-5.\n\nKeep proxy guidance.".to_string());

    let manager = provider.models_manager_without_cache(Some(ModelsResponse {
        models: vec![model],
    }));
    let catalog = manager
        .raw_model_catalog(
            RefreshStrategy::Offline,
            HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
        )
        .await;
    let instructions = codex_prompts::render_model_instructions(&catalog.models[0]);
    assert_eq!(
        instructions,
        format!(
            "{}\n\nKeep proxy guidance.",
            crate::local_proxy_models::HCODEX_INSTRUCTIONS_OPENING
        )
    );
}
