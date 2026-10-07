//! hcodex: `/provider` network + persistence on `App`.
//!
//! 1. `ProviderSetupSubmitted`: probe `GET {base_url}/models` with the draft
//!    credentials (same code path `/model` uses for OpenAI-compatible providers).
//! 2. `ProviderModelsFetched`: hand the list (or the failure) back to the widget.
//! 3. `ProviderSave`: write `[model_providers.<id>]` into config.toml, write the
//!    `<id>.config.toml` profile, optionally flip the top-level default.

use std::path::Path;
use std::path::PathBuf;

use codex_model_provider_info::ModelProviderInfo;
use codex_model_provider_info::WireApi;
use codex_utils_path::write_atomically;
use codex_utils_redacted_string::RedactedString;
use toml_edit::Array;
use toml_edit::Item as TomlItem;
use toml_edit::value;

use crate::app_event::AppEvent;
use crate::app_event::ProviderSetupDraft;
use crate::legacy_core::config::edit::ConfigEdit;
use crate::legacy_core::config::edit::ConfigEditsBuilder;

use super::App;
use crate::app_server_session::AppServerSession;

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
        tui: &mut crate::tui::Tui,
        app_server: &mut AppServerSession,
        draft: ProviderSetupDraft,
        model: String,
        make_default: bool,
        use_now: bool,
    ) {
        let codex_home = self.config.codex_home.clone();
        if let Err(err) = persist_provider(&codex_home, &draft, &model, make_default).await {
            self.chat_widget
                .add_error_message(format!("Failed to save provider `{}`: {err:#}", draft.id));
            return;
        }
        let profile_path = codex_home.join(format!("{}.config.toml", draft.id));
        let key_note = if draft.api_key.is_some() {
            ", key stored in an owner-only credential file"
        } else {
            ", no key"
        };
        let saved = format!(
            "Saved provider `{}` ({}) with model `{model}`{key_note}.",
            draft.id, draft.base_url
        );
        if !use_now {
            let hint = if make_default {
                format!(
                    "It is now the default; new hcodex sessions use it. Profile: {}",
                    profile_path.display()
                )
            } else {
                format!(
                    "Run `hcodex -p {}` to use it. Profile: {}",
                    draft.id,
                    profile_path.display()
                )
            };
            self.chat_widget.add_info_message(saved, Some(hint));
            return;
        }
        // Switch this process to the new provider the same way `-c model_provider=`
        // does, then open a fresh thread on it. The overrides persist for later
        // `/new` threads in this session too.
        self.harness_overrides.model_provider = Some(draft.id.clone());
        self.harness_overrides.model = Some(model.clone());
        self.chat_widget.add_info_message(
            saved,
            Some(format!(
                "Starting a new thread on `{}` / `{model}` (profile: {}).",
                draft.id,
                profile_path.display()
            )),
        );
        self.start_fresh_session(
            tui, app_server, /*session_start_source*/ None,
            /*initial_user_message*/ None, /*new_thread_name*/ None,
        )
        .await;
    }
}

/// Write the provider table + profile. Kept free of `App` so it is unit-testable.
pub(crate) async fn persist_provider(
    codex_home: &Path,
    draft: &ProviderSetupDraft,
    model: &str,
    make_default: bool,
) -> anyhow::Result<()> {
    let config_path = codex_home.join("config.toml");
    let profile_path = codex_home.join(format!("{}.config.toml", draft.id));
    let credential_path = provider_credential_path(codex_home, &draft.id);
    let snapshots = [
        (&config_path, read_optional_file(&config_path)?),
        (&profile_path, read_optional_file(&profile_path)?),
        (&credential_path, read_optional_file(&credential_path)?),
    ];

    let credential_result = match draft.api_key.as_deref() {
        Some(key) => write_provider_credential(&credential_path, key),
        None => remove_file_if_exists(&credential_path),
    };

    if let Err(error) = credential_result {
        rollback_provider_files(&snapshots);
        return Err(error.into());
    }

    if let Err(error) = persist_provider_config(codex_home, draft, model, make_default).await {
        rollback_provider_files(&snapshots);
        return Err(error);
    }
    Ok(())
}

fn rollback_provider_files(snapshots: &[(&PathBuf, Option<String>)]) {
    for (path, contents) in snapshots {
        if let Err(error) = restore_optional_file(path, contents.as_deref()) {
            tracing::error!(
                path = %path.display(),
                error = %error,
                "failed to roll back provider persistence"
            );
        }
    }
}

async fn persist_provider_config(
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
    let auth_seg = |key: &str| {
        vec![
            "model_providers".to_string(),
            draft.id.clone(),
            "auth".to_string(),
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
        ConfigEdit::ClearPath {
            segments: seg("env_key"),
        },
        ConfigEdit::ClearPath {
            segments: seg("experimental_bearer_token"),
        },
        ConfigEdit::ClearPath {
            segments: seg("auth"),
        },
    ];
    if draft.api_key.is_some() {
        let credential_reader = std::env::current_exe()?;
        let args = ["provider-credential".to_string(), draft.id.clone()]
            .into_iter()
            .collect::<Array>();
        edits.extend([
            ConfigEdit::SetPath {
                segments: auth_seg("command"),
                value: value(credential_reader.to_string_lossy().to_string()),
            },
            ConfigEdit::SetPath {
                segments: auth_seg("args"),
                value: TomlItem::Value(args.into()),
            },
        ]);
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

const PROVIDER_CREDENTIALS_DIR: &str = "provider-credentials";

fn provider_credential_path(codex_home: &Path, provider_id: &str) -> PathBuf {
    codex_home
        .join(PROVIDER_CREDENTIALS_DIR)
        .join(format!("{provider_id}.token"))
}

fn read_optional_file(path: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn remove_file_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn restore_optional_file(path: &Path, contents: Option<&str>) -> std::io::Result<()> {
    match contents {
        Some(contents) => write_atomically(path, contents),
        None => remove_file_if_exists(path),
    }
}

fn write_provider_credential(path: &Path, key: &str) -> std::io::Result<()> {
    write_atomically(path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
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
        assert!(!config.contains("sk-or-test"));
        assert!(!config.contains("experimental_bearer_token"));
        assert!(config.contains("[model_providers.openrouter.auth]"));
        assert!(config.contains("command = "));
        assert!(config.contains("provider-credential"));
        toml::from_str::<toml::Value>(&config).expect("generated config should parse");
        assert!(
            !config.contains("env_key"),
            "stale env_key must be removed: {config}"
        );
        assert!(!config.contains("model_provider = \"openrouter\""));

        let credential_path = provider_credential_path(home.path(), "openrouter");
        assert_eq!(
            std::fs::read_to_string(&credential_path).expect("credential file"),
            "sk-or-test"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&credential_path)
                    .expect("credential metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }

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
        assert!(!config.contains("[model_providers.openrouter.auth]"));

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
