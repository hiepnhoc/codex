//! hcodex tests for `config_manager.rs`, kept out of upstream's test files so a
//! sync does not conflict when upstream appends tests there.
use super::*;
use anyhow::Result;
use pretty_assertions::assert_eq;
use tempfile::tempdir;

/// hcodex: a thread recorded on another configured provider stays writable and resumable
/// under a profile that selects a different provider. hcodex used to patch this in behind
/// `thread_keeps_provider`; upstream e115d5f90d made it the default, and this guards it.
#[tokio::test]
async fn thread_on_other_configured_provider_stays_writable() -> Result<()> {
    let home = tempdir()?;
    std::fs::write(
        home.path().join("config.toml"),
        r#"
model_provider = "openai"
[model_providers.gateway]
name = "Gateway"
"#,
    )?;
    let selecting_gateway = ConfigManager::new_for_tests(
        home.path().to_path_buf(),
        vec![("model_provider".into(), TomlValue::String("gateway".into()))],
        LoaderOverrides::without_managed_config_for_tests(),
        CloudConfigBundleLoader::default(),
    );
    let gateway_thread = selecting_gateway
        .load_latest_config(Some(home.path().to_path_buf()))
        .await?;
    assert_eq!(gateway_thread.model_provider_id, "gateway");

    // The profile on disk selects `openai`; the thread recorded on `gateway` stays writable.
    let default_manager =
        ConfigManager::without_managed_config_for_tests(home.path().to_path_buf());
    default_manager
        .check_thread_model_provider(&gateway_thread)
        .await?;
    let resumed = default_manager
        .load_for_resume(
            Some("gateway"),
            None,
            ConfigOverrides::default(),
            Some(home.path().to_path_buf()),
        )
        .await?;
    assert_eq!(resumed.model_provider_id, "gateway");

    // A provider that is not configured is still rejected.
    let error = default_manager
        .load_for_resume(
            Some("ghost"),
            None,
            ConfigOverrides::default(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error
            .get_ref()
            .and_then(|error| error.downcast_ref::<ModelProviderError>()),
        Some(&ModelProviderError::ModelProviderNotConfigured {
            model_provider: "ghost".into(),
        })
    );
    Ok(())
}
