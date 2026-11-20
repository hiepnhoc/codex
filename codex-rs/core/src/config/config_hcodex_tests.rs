//! hcodex tests for `config/mod.rs`, kept out of upstream's `config_tests.rs`
//! so a sync does not conflict there.
use super::*;
use core_test_support::TempDirExt;
use pretty_assertions::assert_eq;
use tempfile::TempDir;

#[tokio::test]
async fn model_overrides_load_from_codex_home() -> std::io::Result<()> {
    let codex_home = TempDir::new()?;
    std::fs::write(
        codex_home.path().join("model_overrides.toml"),
        r#"
[models."custom-model"]
context_window = 123456
instructions = "Custom model prompt"
"#,
    )?;

    let config = Config::load_from_base_config_with_overrides(
        ConfigToml::default(),
        ConfigOverrides::default(),
        codex_home.abs(),
    )
    .await?;
    let model_info = codex_models_manager::test_support::construct_model_info_offline_for_tests(
        "custom-model",
        &config.to_models_manager_config(),
    );

    assert_eq!(model_info.context_window, Some(123_456));
    assert_eq!(
        codex_prompts::render_model_instructions(&model_info),
        "Custom model prompt"
    );
    Ok(())
}
