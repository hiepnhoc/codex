use pretty_assertions::assert_eq;

use super::*;

fn model_with_instructions(slug: &str, instructions: &str) -> ModelInfo {
    let mut model = model_info_from_slug(slug);
    model
        .model_messages
        .as_mut()
        .expect("fallback model messages")
        .instructions_template = Some(instructions.to_string());
    model
}

#[test]
fn proxy_models_replace_openai_identity_without_changing_guidance() {
    let cases = [
        (
            "gpt-5.2-codex",
            "You are Codex, a coding agent based on GPT-5.",
        ),
        (
            "anthropic/claude-sonnet-5",
            "You are GPT-5 running in the Codex CLI.",
        ),
        ("google/gemini-2.5-pro", "You are Codex, based on GPT-5."),
        (
            "qwen3-coder",
            "You are Codex, a coding agent based on GPT-5.",
        ),
        ("glm-4.7", "You are GPT-5 running in the Codex CLI."),
    ];

    for (slug, opening) in cases {
        let model = model_with_instructions(slug, &format!("{opening}\n\nKeep this guidance."));
        let normalized = normalize_proxy_model_instructions(model);

        assert_eq!(
            codex_prompts::render_model_instructions(&normalized),
            format!("{HCODEX_INSTRUCTIONS_OPENING}\n\nKeep this guidance.")
        );
        let instructions = codex_prompts::render_model_instructions(&normalized);
        assert!(!instructions.contains("OpenAI"));
        assert!(!instructions.contains("Codex CLI"));
        assert!(!instructions.contains("GPT-5"));
    }
}

#[test]
fn command_auth_disables_file_cache_without_exposing_credential_scope() {
    use codex_protocol::config_types::ModelProviderAuthInfo;
    use std::num::NonZeroU64;

    let endpoint = LocalProxyModelsEndpoint::new(
        ModelProviderInfo {
            name: "Proxy".to_string(),
            base_url: Some("https://proxy.example/v1".to_string()),
            auth: Some(ModelProviderAuthInfo {
                command: "token-fetcher".to_string(),
                args: vec!["account-a".into()],
                timeout_ms: NonZeroU64::new(5_000).expect("non-zero timeout"),
                refresh_interval_ms: 300_000,
                cwd: std::env::current_dir()
                    .expect("current directory")
                    .try_into()
                    .expect("absolute current directory"),
            }),
            ..Default::default()
        },
        /*auth_manager*/ None,
    );

    assert_eq!(endpoint.identity(), None);
}

#[test]
fn cache_key_separates_auth_scopes_without_exposing_tokens() {
    let endpoint = |token: &str| {
        LocalProxyModelsEndpoint::new(
            ModelProviderInfo {
                name: "Proxy".to_string(),
                base_url: Some("https://proxy.example/v1".to_string()),
                experimental_bearer_token: Some(token.into()),
                ..Default::default()
            },
            /*auth_manager*/ None,
        )
    };
    let first = endpoint("secret-one").identity().expect("identity");
    let second = endpoint("secret-two").identity().expect("identity");

    assert_ne!(first, second);
    assert!(!first.contains("secret-one"));
    assert!(!second.contains("secret-two"));
}

#[test]
fn command_auth_disables_persistent_model_cache() {
    use codex_protocol::config_types::ModelProviderAuthInfo;
    use std::num::NonZeroU64;

    let endpoint = LocalProxyModelsEndpoint::new(
        ModelProviderInfo {
            name: "Proxy".to_string(),
            base_url: Some("https://proxy.example/v1".to_string()),
            auth: Some(ModelProviderAuthInfo {
                command: "hcodex".to_string(),
                args: vec!["provider-credential".into(), "proxy".into()],
                timeout_ms: NonZeroU64::new(5_000).expect("non-zero timeout"),
                refresh_interval_ms: 300_000,
                cwd: std::env::current_dir()
                    .expect("current directory")
                    .try_into()
                    .expect("absolute current directory"),
            }),
            ..Default::default()
        },
        /*auth_manager*/ None,
    );

    assert_eq!(endpoint.identity(), None);
}

#[test]
fn external_model_preserves_provider_neutral_catalog_instructions() {
    let instructions = "You are a coding agent.\n\nProvider guidance.";
    let model = model_with_instructions("gemini-2.5-pro", instructions);

    let normalized = normalize_proxy_model_instructions(model);

    assert_eq!(
        codex_prompts::render_model_instructions(&normalized),
        instructions
    );
}

fn openai_model(id: &str) -> OpenAiModel {
    OpenAiModel {
        id: id.to_string(),
        ..Default::default()
    }
}

#[test]
fn effort_variant_ids_fold_into_base_model_and_hide_from_picker() {
    let mut list = vec![
        openai_model("claude-opus-5"),
        openai_model("claude-opus-5-thinking"),
        openai_model("gpt-4o"),
    ];
    for level in ["low", "medium", "high", "xhigh", "max"] {
        list.push(openai_model(&format!("claude-opus-5-effort-{level}")));
        list.push(openai_model(&format!(
            "claude-opus-5-thinking-effort-{level}"
        )));
    }
    list.push(openai_model("gpt-4o-effort-none"));
    // Orphan variant: its base is not listed, so it stays a regular model.
    list.push(openai_model("mystery-effort-high"));

    let models = models_from_openai_list(list, "Local Proxy");
    let ids: Vec<&str> = models.iter().map(|m| m.slug.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "claude-opus-5",
            "claude-opus-5-thinking",
            "gpt-4o",
            "mystery-effort-high"
        ]
    );

    let opus = models.iter().find(|m| m.slug == "claude-opus-5").unwrap();
    let efforts: Vec<ReasoningEffort> = opus
        .supported_reasoning_levels
        .iter()
        .map(|preset| preset.effort.clone())
        .collect();
    assert_eq!(
        efforts,
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::XHigh,
            ReasoningEffort::Max,
        ]
    );
    assert_eq!(opus.default_reasoning_level, Some(ReasoningEffort::Medium));

    let gpt4o = models.iter().find(|m| m.slug == "gpt-4o").unwrap();
    assert_eq!(gpt4o.supported_reasoning_levels.len(), 1);
    assert_eq!(gpt4o.default_reasoning_level, Some(ReasoningEffort::None));

    // No advertised ladder: the standard one applies.
    let mystery = models
        .iter()
        .find(|m| m.slug == "mystery-effort-high")
        .unwrap();
    assert_eq!(mystery.supported_reasoning_levels.len(), 4);
}

#[test]
fn provider_metadata_sets_modalities_and_context_window() {
    let mut text_only = openai_model("qwen3-coder");
    text_only.input_modalities = Some(vec!["text".to_string()]);
    text_only.context_window = Some(131_072);
    let mut vision = openai_model("claude-sonnet-5");
    vision.modalities = Some(OpenAiModelModalities {
        input: Some(vec!["text".to_string(), "image".to_string()]),
    });
    let mut bogus = openai_model("bogus");
    bogus.context_window = Some(0);
    let plain = openai_model("plain");

    let models = models_from_openai_list(vec![text_only, vision, bogus, plain], "Local Proxy");
    let by_slug = |slug: &str| models.iter().find(|m| m.slug == slug).unwrap();

    assert_eq!(
        by_slug("qwen3-coder").input_modalities,
        vec![InputModality::Text]
    );
    assert_eq!(by_slug("qwen3-coder").context_window, Some(131_072));
    assert_eq!(
        by_slug("claude-sonnet-5").input_modalities,
        vec![InputModality::Text, InputModality::Image]
    );
    // Zero/absent limits fall back to the harness default; absent modalities keep the fallback.
    assert_eq!(
        by_slug("bogus").context_window,
        Some(DEFAULT_CONTEXT_WINDOW)
    );
    assert_eq!(
        by_slug("plain").context_window,
        Some(DEFAULT_CONTEXT_WINDOW)
    );
    assert!(!by_slug("plain").input_modalities.is_empty());
}
