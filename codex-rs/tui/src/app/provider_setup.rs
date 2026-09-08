//! hcodex: `/provider` network + persistence on `App`.
//!
//! 1. `ProviderSetupSubmitted`: probe `GET {base_url}/models` with the draft
//!    credentials (same code path `/model` uses for OpenAI-compatible providers).
//! 2. `ProviderModelsFetched`: hand the list (or the failure) back to the widget.
//! 3. `ProviderSave`: write `[model_providers.<id>]` into config.toml, write the
//!    `<id>.config.toml` profile, optionally flip the top-level default.

use std::path::Path;

use codex_model_provider_info::ModelProviderInfo;
use codex_model_provider_info::WireApi;
use codex_utils_redacted_string::RedactedString;
use toml_edit::value;

use crate::app_event::AppEvent;
use crate::app_event::ProviderSetupDraft;
use crate::legacy_core::config::edit::ConfigEdit;
use crate::legacy_core::config::edit::ConfigEditsBuilder;

use super::App;

impl App {
    pub(super) fn probe_provider_models(&mut self, draft: ProviderSetupDraft) {
        self.chat_widget.add_info_message(
            format!("Checking {}/models …", draft.base_url),
            /*hint*/ None,
        );
        let app_event_tx = self.app_event_tx.clone();
        let http_client_factory = self.config.http_client_factory();
        let info = ModelProviderInfo {
            name: draft.id.clone(),
            base_url: Some(draft.base_url.clone()),
            experimental_bearer_token: draft.api_key.clone().map(RedactedString::from),
            wire_api: WireApi::Responses,
            ..ModelProviderInfo::default()
        };
        tokio::spawn(async move {
            let result = codex_model_provider::list_models_for_provider(info, http_client_factory)
                .await
                .map(|models| {
                    models
                        .into_iter()
                        .map(|model| model.slug)
                        .collect::<Vec<String>>()
                })
                .map_err(|err| err.to_string());
            app_event_tx.send(AppEvent::ProviderModelsFetched { draft, result });
        });
    }

    pub(super) fn handle_provider_models_fetched(
        &mut self,
        draft: ProviderSetupDraft,
        result: Result<Vec<String>, String>,
    ) {
        match result {
            Ok(models) if !models.is_empty() => {
                self.chat_widget.open_provider_model_picker(draft, models);
            }
            Ok(_) => {
                let note = format!("{}/models returned no models.", draft.base_url);
                self.chat_widget.open_provider_model_prompt(draft, note);
            }
            Err(err) => {
                let note = format!("Could not list {}/models: {err}", draft.base_url);
                self.chat_widget.open_provider_model_prompt(draft, note);
            }
        }
    }

    pub(super) async fn save_provider(
        &mut self,
        draft: ProviderSetupDraft,
        model: String,
        make_default: bool,
    ) {
        let codex_home = self.config.codex_home.clone();
        match persist_provider(&codex_home, &draft, &model, make_default).await {
            Ok(()) => {
                let profile_path = codex_home.join(format!("{}.config.toml", draft.id));
                let hint = if make_default {
                    format!(
                        "Restart hcodex to use it (already the default). Profile: {}",
                        profile_path.display()
                    )
                } else {
                    format!(
                        "Run `hcodex -p {}` to use it. Profile: {}",
                        draft.id,
                        profile_path.display()
                    )
                };
                self.chat_widget.add_info_message(
                    format!(
                        "Saved provider `{}` ({}) with model `{model}`{}.",
                        draft.id,
                        draft.base_url,
                        if draft.api_key.is_some() {
                            ", key stored in config.toml"
                        } else {
                            ", no key"
                        }
                    ),
                    Some(hint),
                );
            }
            Err(err) => {
                self.chat_widget
                    .add_error_message(format!("Failed to save provider `{}`: {err:#}", draft.id));
            }
        }
    }
}

/// Write the provider table + profile. Kept free of `App` so it is unit-testable.
pub(crate) async fn persist_provider(
    codex_home: &Path,
    draft: &ProviderSetupDraft,
    model: &str,
    make_default: bool,
) -> anyhow::Result<()> {
    let seg = |key: &str| {
        vec![
            "model_providers".to_string(),
            draft.id.clone(),
            key.to_string(),
        ]
    };
    let mut edits = vec![
        ConfigEdit::SetPath {
            segments: seg("name"),
            value: value(draft.id.clone()),
        },
        ConfigEdit::SetPath {
            segments: seg("base_url"),
            value: value(draft.base_url.clone()),
        },
        ConfigEdit::SetPath {
            segments: seg("wire_api"),
            value: value("responses"),
        },
        // `env_key` and `experimental_bearer_token` are mutually exclusive; the
        // wizard always uses the inline token (or none), so drop a stale env_key.
        ConfigEdit::ClearPath {
            segments: seg("env_key"),
        },
    ];
    match &draft.api_key {
        Some(key) => edits.push(ConfigEdit::SetPath {
            segments: seg("experimental_bearer_token"),
            value: value(key.clone()),
        }),
        None => edits.push(ConfigEdit::ClearPath {
            segments: seg("experimental_bearer_token"),
        }),
    }
    if make_default {
        edits.push(ConfigEdit::SetPath {
            segments: vec!["model_provider".to_string()],
            value: value(draft.id.clone()),
        });
        edits.push(ConfigEdit::SetPath {
            segments: vec!["model".to_string()],
            value: value(model.to_string()),
        });
    }
    ConfigEditsBuilder::new(codex_home)
        .with_edits(edits)
        .apply()
        .await?;

    // Profile file (`hcodex -p <id>`): merge into an existing one rather than
    // clobbering user edits.
    let profile_path = codex_home.join(format!("{}.config.toml", draft.id));
    ConfigEditsBuilder::for_config_path(&profile_path)
        .with_edits([
            ConfigEdit::SetPath {
                segments: vec!["model_provider".to_string()],
                value: value(draft.id.clone()),
            },
            ConfigEdit::SetPath {
                segments: vec!["model".to_string()],
                value: value(model.to_string()),
            },
        ])
        .apply()
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    fn draft(key: Option<&str>) -> ProviderSetupDraft {
        ProviderSetupDraft {
            id: "openrouter".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            api_key: key.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn writes_provider_table_and_profile() {
        let home = tempdir().expect("tempdir");
        std::fs::write(
            home.path().join("config.toml"),
            "model = \"claude-sonnet-5\"\n\n[model_providers.openrouter]\nname = \"old\"\nenv_key = \"OPENROUTER_API_KEY\"\n",
        )
        .expect("seed config");

        persist_provider(
            home.path(),
            &draft(Some("sk-or-test")),
            "anthropic/claude-fable-5.1",
            false,
        )
        .await
        .expect("persist");

        let config = std::fs::read_to_string(home.path().join("config.toml")).expect("read");
        assert!(
            config.contains("model = \"claude-sonnet-5\""),
            "default untouched: {config}"
        );
        assert!(config.contains("[model_providers.openrouter]"));
        assert!(config.contains("base_url = \"https://openrouter.ai/api/v1\""));
        assert!(config.contains("wire_api = \"responses\""));
        assert!(config.contains("experimental_bearer_token = \"sk-or-test\""));
        assert!(
            !config.contains("env_key"),
            "stale env_key must be removed: {config}"
        );
        assert!(!config.contains("model_provider = \"openrouter\""));

        let profile = std::fs::read_to_string(home.path().join("openrouter.config.toml"))
            .expect("profile written");
        assert_eq!(
            profile.trim(),
            "model_provider = \"openrouter\"\nmodel = \"anthropic/claude-fable-5.1\""
        );
    }

    #[tokio::test]
    async fn make_default_sets_top_level_keys_and_keeps_profile_extras() {
        let home = tempdir().expect("tempdir");
        std::fs::write(home.path().join("config.toml"), "").expect("seed config");
        std::fs::write(
            home.path().join("openrouter.config.toml"),
            "model_reasoning_effort = \"low\"\n",
        )
        .expect("seed profile");

        persist_provider(home.path(), &draft(None), "google/gemini-3.8-pro", true)
            .await
            .expect("persist");

        let config = std::fs::read_to_string(home.path().join("config.toml")).expect("read");
        assert!(config.contains("model_provider = \"openrouter\""));
        assert!(config.contains("model = \"google/gemini-3.8-pro\""));
        assert!(!config.contains("experimental_bearer_token"));

        let profile =
            std::fs::read_to_string(home.path().join("openrouter.config.toml")).expect("profile");
        assert!(
            profile.contains("model_reasoning_effort = \"low\""),
            "{profile}"
        );
        assert!(profile.contains("model_provider = \"openrouter\""));
        assert!(profile.contains("model = \"google/gemini-3.8-pro\""));
    }
}
