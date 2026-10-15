//! hcodex: merged `/model` picker across every configured provider.
//!
//! Providers stay configured separately (`[model_providers.<id>]`); only the
//! picker is merged. Picking a model of another provider forks the thread onto
//! that provider with the whole history (see `app::provider_setup`).

use super::*;
use crate::app_event::OtherProviderModels;
use codex_model_provider_info::ModelProviderInfo;
use std::time::Duration;
use std::time::Instant;

const OTHER_PROVIDER_MODELS_TTL: Duration = Duration::from_secs(300);
const OTHER_PROVIDER_LIST_TIMEOUT: Duration = Duration::from_secs(3);

impl ChatWidget {
    /// Providers other than the active one whose `/models` can be listed
    /// without an OpenAI/AWS login. `capabilities.list_models = false` opts out.
    pub(crate) fn other_listable_providers(&self) -> Vec<(String, ModelProviderInfo)> {
        let current = self.config.model_provider_id.as_str();
        let mut providers: Vec<(String, ModelProviderInfo)> = self
            .config
            .model_providers
            .iter()
            .filter(|(id, info)| {
                id.as_str() != current
                    && !info.requires_openai_auth
                    && info.aws.is_none()
                    && info
                        .capabilities
                        .and_then(|capabilities| capabilities.list_models)
                        .unwrap_or(true)
            })
            .map(|(id, info)| (id.clone(), info.clone()))
            .collect();
        providers.sort_by(|a, b| a.0.cmp(&b.0));
        providers
    }

    /// Refreshes the other providers' catalogs in the background (5-minute
    /// cache, 3-second timeout per provider). The open picker is updated when
    /// the reply arrives.
    pub(crate) fn refresh_other_provider_models(&mut self) {
        if self.other_provider_models_request_id.is_some() {
            return;
        }
        if self
            .other_provider_models_fetched_at
            .is_some_and(|at| at.elapsed() < OTHER_PROVIDER_MODELS_TTL)
        {
            return;
        }
        let providers = self.other_listable_providers();
        if providers.is_empty() {
            self.other_provider_models.clear();
            self.other_provider_models_fetched_at = Some(Instant::now());
            return;
        }
        let request_id = uuid::Uuid::new_v4();
        self.other_provider_models_request_id = Some(request_id);
        let app_event_tx = self.app_event_tx.clone();
        let http_client_factory = self.config.http_client_factory();
        tokio::spawn(async move {
            let fetches = providers.into_iter().map(|(provider_id, info)| {
                let http_client_factory = http_client_factory.clone();
                async move {
                    let listed = tokio::time::timeout(
                        OTHER_PROVIDER_LIST_TIMEOUT,
                        codex_model_provider::list_models_for_provider(info, http_client_factory),
                    )
                    .await;
                    match listed {
                        Ok(Ok(models)) => OtherProviderModels {
                            provider_id,
                            models: models.into_iter().map(|model| model.slug).collect(),
                            error: None,
                        },
                        Ok(Err(err)) => OtherProviderModels {
                            provider_id,
                            models: Vec::new(),
                            error: Some(err.to_string()),
                        },
                        Err(_) => OtherProviderModels {
                            provider_id,
                            models: Vec::new(),
                            error: Some("timed out after 3s".to_string()),
                        },
                    }
                }
            });
            let entries = futures::future::join_all(fetches).await;
            app_event_tx.send(AppEvent::OtherProviderModelsFetched {
                request_id,
                entries,
            });
        });
    }

    pub(crate) fn on_other_provider_models_fetched(
        &mut self,
        request_id: uuid::Uuid,
        entries: Vec<OtherProviderModels>,
    ) {
        if self.other_provider_models_request_id != Some(request_id) {
            return;
        }
        self.other_provider_models_request_id = None;
        self.other_provider_models_fetched_at = Some(Instant::now());
        if self.other_provider_models != entries {
            self.other_provider_models = entries;
            self.refresh_open_model_picker();
        }
    }

    /// Picker rows for the other providers' models: selecting one switches the
    /// conversation to that provider. Returns `(model ids, items)`.
    pub(super) fn other_provider_model_items(&self) -> (Vec<String>, Vec<SelectionItem>) {
        let mut model_ids = Vec::new();
        let mut items = Vec::new();
        for entry in &self.other_provider_models {
            if let Some(error) = &entry.error {
                model_ids.push(format!("{}:", entry.provider_id));
                items.push(SelectionItem {
                    name: format!("{} unavailable", entry.provider_id),
                    description: Some(error.clone()),
                    is_disabled: true,
                    ..Default::default()
                });
                continue;
            }
            for model in &entry.models {
                let provider_id = entry.provider_id.clone();
                let chosen = model.clone();
                model_ids.push(format!("{provider_id}:{model}"));
                items.push(SelectionItem {
                    name: model.clone(),
                    category_tag: Some(provider_id.clone()),
                    description: Some(format!(
                        "via {provider_id} — switches this conversation to that provider"
                    )),
                    actions: vec![Box::new(move |tx: &AppEventSender| {
                        tx.send(AppEvent::ProviderSwitch {
                            provider_id: provider_id.clone(),
                            model: Some(chosen.clone()),
                        });
                    })],
                    dismiss_on_select: true,
                    ..Default::default()
                });
            }
        }
        if self.other_provider_models_request_id.is_some() && self.other_provider_models.is_empty() {
            model_ids.push(String::from(":loading"));
            items.push(SelectionItem {
                name: "Listing other providers…".to_string(),
                is_disabled: true,
                ..Default::default()
            });
        }
        (model_ids, items)
    }
}
