//! hcodex: `/provider` network + persistence on `App`.
//!
//! 1. `ProviderSetupSubmitted`: probe `GET {base_url}/models` with the draft
//!    credentials (same code path `/model` uses for OpenAI-compatible providers).
//! 2. `ProviderModelsFetched`: hand the list (or the failure) back to the widget.
//! 3. `ProviderSave`: write `[model_providers.<id>]` into config.toml, write the
//!    `<id>.config.toml` profile, optionally flip the top-level default.
//! 4. `ProviderSwitch`: continue the current conversation on another configured
//!    provider by forking the thread with the new provider/model (`thread/fork`
//!    carries the whole history). "Use it now" after setup goes through the
//!    same path, so switching providers no longer means a new session.

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
use super::session_lifecycle::ThreadAttachPresentation;
use crate::app_server_session::AppServerSession;
use crate::app_server_session::ForkGoalContinuation;

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
        self.chat_widget
            .add_info_message(saved, Some(format!("Profile: {}", profile_path.display())));
        // The provider table was just written; reload so the switch sees it.
        self.refresh_in_memory_config_from_disk_best_effort("switching provider")
            .await;
        let info = self
            .config
            .model_providers
            .get(&draft.id)
            .cloned()
            .unwrap_or_else(|| ModelProviderInfo {
                name: draft.id.clone(),
                base_url: Some(draft.base_url.clone()),
                experimental_bearer_token: draft.api_key.clone().map(RedactedString::from),
                wire_api: WireApi::Responses,
                ..ModelProviderInfo::default()
            });
        self.switch_provider_in_place(tui, app_server, draft.id, info, model)
            .await;
    }

    /// `/provider use <id> [model]`: validate the provider, pick a model if
    /// none was given, then fork this conversation onto it.
    pub(super) async fn handle_provider_switch(
        &mut self,
        tui: &mut crate::tui::Tui,
        app_server: &mut AppServerSession,
        provider_id: String,
        model: Option<String>,
    ) {
        let Some(info) = self.config.model_providers.get(&provider_id).cloned() else {
            let mut known: Vec<&String> = self.config.model_providers.keys().collect();
            known.sort();
            let known = known
                .iter()
                .map(|id| id.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            self.chat_widget.add_error_message(format!(
                "Unknown provider `{provider_id}`. Configured providers: {known}. Add one with /provider <id> <base_url>."
            ));
            return;
        };
        let Some(model) = model else {
            self.chat_widget.add_info_message(
                format!("Listing models from `{provider_id}` …"),
                /*hint*/ None,
            );
            let app_event_tx = self.app_event_tx.clone();
            let http_client_factory = self.config.http_client_factory();
            tokio::spawn(async move {
                let result =
                    codex_model_provider::list_models_for_provider(info, http_client_factory)
                        .await
                        .map(|models| models.into_iter().map(|m| m.slug).collect::<Vec<_>>())
                        .map_err(|err| err.to_string());
                app_event_tx.send(AppEvent::ProviderSwitchModelsFetched {
                    provider_id,
                    result,
                });
            });
            return;
        };
        self.switch_provider_in_place(tui, app_server, provider_id, info, model)
            .await;
    }

    pub(super) fn handle_provider_switch_models_fetched(
        &mut self,
        provider_id: String,
        result: Result<Vec<String>, String>,
    ) {
        match result {
            Ok(models) if !models.is_empty() => {
                self.chat_widget
                    .open_provider_switch_model_picker(provider_id, models);
            }
            Ok(_) => self.chat_widget.add_error_message(format!(
                "`{provider_id}` returned no models; pass one explicitly: /provider use {provider_id} <model>"
            )),
            Err(err) => self.chat_widget.add_error_message(format!(
                "Could not list models from `{provider_id}`: {err}. Pass one explicitly: /provider use {provider_id} <model>"
            )),
        }
    }

    /// Forks the current thread with a new provider/model so the conversation
    /// continues there (same history, new thread id). Without a thread yet,
    /// a fresh one is started on the provider instead. Later `/new` threads in
    /// this process keep the provider too.
    pub(super) async fn switch_provider_in_place(
        &mut self,
        tui: &mut crate::tui::Tui,
        app_server: &mut AppServerSession,
        provider_id: String,
        info: ModelProviderInfo,
        model: String,
    ) {
        self.harness_overrides.model_provider = Some(provider_id.clone());
        self.harness_overrides.model = Some(model.clone());
        app_server.model_provider_override = Some(provider_id.clone());

        let Some(thread_id) = self.chat_widget.thread_id() else {
            self.start_fresh_session(
                tui, app_server, /*session_start_source*/ None,
                /*initial_user_message*/ None, /*new_thread_name*/ None,
            )
            .await;
            return;
        };
        if self.pending_server_profiles.contains_key(&thread_id) {
            self.chat_widget.add_error_message(
                "Wait for permissions to update before switching provider.".into(),
            );
            return;
        }
        self.chat_widget.fork_in_progress = true;
        let screen_size = tui.terminal.last_known_screen_size;
        if let Err(err) = self.handle_draw_pre_render(tui, screen_size) {
            tracing::warn!(%err, "pre-render before provider switch failed");
        }
        self.chat_widget.pre_draw_tick();
        if let Err(err) = self.render_chat_widget_frame(tui, screen_size) {
            tracing::warn!(%err, "render before provider switch failed");
        }

        let mut fork_config = self.config.clone();
        fork_config.daybreak_enabled = self.chat_widget.daybreak_enabled;
        if app_server.uses_remote_workspace() {
            fork_config
                .workspace_roots
                .clone_from(&self.chat_widget.config_ref().workspace_roots);
        }
        fork_config.model_provider_id = provider_id.clone();
        let provider_info = info.clone();
        fork_config.model_provider = info;
        fork_config.model = Some(model.clone());
        // The new model picks its own default effort; `/model` can adjust it.
        fork_config.model_reasoning_effort = None;
        let selected_profile = self.selected_server_profile(thread_id);
        match app_server
            .fork_thread_at(
                &self.local_settings,
                fork_config.clone(),
                thread_id,
                /*last_turn_id*/ None,
                /*before_turn_id*/ None,
                ForkGoalContinuation::StartIfIdle,
                selected_profile.as_ref(),
            )
            .await
        {
            Ok(forked) => {
                self.detach_current_thread_for_navigation(
                    app_server,
                    Some(forked.session.thread_id),
                )
                .await;
                self.config = fork_config;
                // The replacement widget takes its `/model` catalog from
                // `self.model_catalog`, which bootstrap loaded for the startup
                // provider; reload it for the provider we just switched to so the
                // picker does not show the old provider's models under the new id.
                self.refresh_model_catalog_for_provider(&provider_id, &provider_info)
                    .await;
                match self
                    .replace_chat_widget_with_app_server_thread(
                        tui,
                        forked,
                        ThreadAttachPresentation::SessionLineage,
                        /*initial_user_message*/ None,
                    )
                    .await
                {
                    Ok(()) => {
                        if selected_profile.is_some() {
                            self.adopt_inherited_server_selection();
                        }
                        // Belt and braces: the widget must carry the reloaded catalog.
                        self.chat_widget
                            .set_model_catalog(std::sync::Arc::clone(&self.model_catalog));
                        self.chat_widget.add_info_message(
                            format!("Now using `{model}` via `{provider_id}`; the conversation continues with its full history."),
                            /*hint*/ None,
                        );
                    }
                    Err(err) => {
                        self.chat_widget.add_error_message(format!(
                            "Failed to attach after provider switch: {err}"
                        ));
                    }
                }
            }
            Err(err) => {
                self.chat_widget
                    .add_error_message(format!("Failed to switch to `{provider_id}`: {err}"));
            }
        }
        // The replacement widget inherits `fork_in_progress`; clear it so the
        // composer accepts input again (mirrors the upstream /fork handler).
        self.chat_widget.fork_in_progress = false;
        self.chat_widget.maybe_send_next_queued_input();
        tui.frame_requester().schedule_frame();
    }
}

impl App {
    /// hcodex: rebuild the shared model catalog from `{base_url}/models` of
    /// `provider_info` (same listing the merged picker uses). Keeps the previous
    /// catalog when the provider cannot be listed, and says so.
    pub(super) async fn refresh_model_catalog_for_provider(
        &mut self,
        provider_id: &str,
        provider_info: &codex_model_provider_info::ModelProviderInfo,
    ) {
        let http_client_factory = self.config.http_client_factory();
        let listed = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            codex_model_provider::list_models_for_provider(
                provider_info.clone(),
                http_client_factory,
            ),
        )
        .await;
        let outcome = match listed {
            Ok(Ok(models)) if !models.is_empty() => {
                let presets: Vec<codex_protocol::openai_models::ModelPreset> =
                    models.into_iter().map(Into::into).collect();
                tracing::info!(
                    provider_id,
                    count = presets.len(),
                    first = presets.first().map(|p| p.model.as_str()),
                    "hcodex: model catalog reloaded for provider switch"
                );
                let modes = self.model_catalog.collaboration_modes.clone();
                self.model_catalog = std::sync::Arc::new(
                    crate::model_catalog::ModelCatalog::new(presets)
                        .with_collaboration_modes(modes),
                );
                return;
            }
            Ok(Ok(_)) => "returned no models".to_string(),
            Ok(Err(err)) => err.to_string(),
            Err(_) => "timed out after 10s".to_string(),
        };
        self.chat_widget.add_info_message(
            format!(
                "Could not load the model list of `{provider_id}` ({outcome}); `/model` keeps the previous provider's list."
            ),
            /*hint*/ None,
        );
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
