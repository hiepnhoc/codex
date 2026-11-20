//! hcodex tests for `role.rs`, kept out of upstream's `role_tests.rs` so a sync
//! does not conflict when upstream appends tests there.
use super::*;
use crate::config::ConfigBuilder;
use pretty_assertions::assert_eq;
use std::path::PathBuf;
use tempfile::TempDir;

// Same helpers as in `role_tests.rs` (private to that module).
async fn test_config_with_cli_overrides(
    cli_overrides: Vec<(String, TomlValue)>,
) -> (TempDir, Config) {
    let home = TempDir::new().expect("create temp dir");
    let home_path = home.path().to_path_buf();
    let config = ConfigBuilder::default()
        .codex_home(home_path.clone())
        .cli_overrides(cli_overrides)
        .fallback_cwd(Some(home_path))
        .build()
        .await
        .expect("load test config");
    (home, config)
}

async fn write_role_config(home: &TempDir, name: &str, contents: &str) -> PathBuf {
    let role_path = home.path().join(name);
    tokio::fs::write(&role_path, contents)
        .await
        .expect("write role config");
    role_path
}

// hcodex: a role may pin its own provider (`model_provider = "..."`).
#[tokio::test]
async fn hcodex_apply_role_switches_provider_when_role_pins_one() {
    let (home, mut config) = test_config_with_cli_overrides(vec![
        (
            "features.agent_role_provider".to_string(),
            TomlValue::Boolean(true),
        ),
        (
            "model_providers.alt.name".to_string(),
            TomlValue::String("alt".to_string()),
        ),
        (
            "model_providers.alt.base_url".to_string(),
            TomlValue::String("http://127.0.0.1:9/v1".to_string()),
        ),
        (
            "model_providers.alt.wire_api".to_string(),
            TomlValue::String("responses".to_string()),
        ),
    ])
    .await;
    let parent_provider = config.model_provider_id.clone();
    let role_path = write_role_config(
        &home,
        "alt-role.toml",
        "model = \"role-model\"\nmodel_provider = \"alt\"",
    )
    .await;
    config.agent_roles.insert(
        "custom".to_string(),
        AgentRoleConfig {
            description: None,
            config_file: Some(role_path),
            nickname_candidates: None,
        },
    );

    apply_role_to_config(&mut config, Some("custom"))
        .await
        .expect("role with a configured provider applies");

    assert_ne!(parent_provider, "alt");
    assert_eq!(config.model_provider_id, "alt");
    assert_eq!(config.model_provider.name, "alt");
    assert_eq!(config.model.as_deref(), Some("role-model"));
}

#[tokio::test]
async fn hcodex_apply_role_rejects_unknown_provider() {
    let (home, mut config) = test_config_with_cli_overrides(vec![(
        "features.agent_role_provider".to_string(),
        TomlValue::Boolean(true),
    )])
    .await;
    let role_path = write_role_config(
        &home,
        "bad-provider-role.toml",
        "model = \"role-model\"\nmodel_provider = \"nope\"",
    )
    .await;
    config.agent_roles.insert(
        "custom".to_string(),
        AgentRoleConfig {
            description: None,
            config_file: Some(role_path),
            nickname_candidates: None,
        },
    );

    let err = apply_role_to_config(&mut config, Some("custom"))
        .await
        .expect_err("unknown provider must fail");

    assert_eq!(err, AGENT_TYPE_UNAVAILABLE_ERROR);
}

#[tokio::test]
async fn hcodex_apply_role_ignores_provider_when_feature_off() {
    let (home, mut config) = test_config_with_cli_overrides(Vec::new()).await;
    let parent_provider = config.model_provider_id.clone();
    let role_path = write_role_config(
        &home,
        "off-role.toml",
        "model = \"role-model\"\nmodel_provider = \"ollama\"",
    )
    .await;
    config.agent_roles.insert(
        "custom".to_string(),
        AgentRoleConfig {
            description: None,
            config_file: Some(role_path),
            nickname_candidates: None,
        },
    );

    apply_role_to_config(&mut config, Some("custom"))
        .await
        .expect("role applies");

    assert_eq!(config.model_provider_id, parent_provider);
    assert_eq!(config.model.as_deref(), Some("role-model"));
}
