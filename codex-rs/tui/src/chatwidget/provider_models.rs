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
    /// without an OpenAI/AWS login. `[tui] model_picker_providers` whitelists
    /// ids; unset means every provider except the upstream built-ins.
    /// `capabilities.list_models = false` opts a provider out either way.
    pub(crate) fn other_listable_providers(&self) -> Vec<(String, ModelProviderInfo)> {
        let current = self.config.model_provider_id.as_str();
        let whitelist = self.local_settings.tui.model_picker_providers.as_ref();
        let upstream_built_ins: Vec<String> =
            codex_model_provider_info::built_in_model_providers(/*openai_base_url*/ None)
                .into_keys()
                .filter(|id| id != codex_model_provider_info::LOCAL_PROXY_PROVIDER_ID)
                .collect();
        let mut providers: Vec<(String, ModelProviderInfo)> = self
            .config
            .model_providers
            .iter()
            .filter(|(id, info)| {
                let wanted = match whitelist {
                    Some(ids) => ids.iter().any(|wanted| wanted == *id),
                    None => !upstream_built_ins.contains(id),
                };
                wanted
                    && id.as_str() != current
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
        let picker_filters = self.local_settings.tui.model_picker_models.clone();
        tokio::spawn(async move {
            let fetches = providers.into_iter().map(|(provider_id, info)| {
                let http_client_factory = http_client_factory.clone();
                let filters = picker_filters
                    .as_ref()
                    .and_then(|filters| filters.get(&provider_id).cloned());
                async move {
                    let listed = tokio::time::timeout(
                        OTHER_PROVIDER_LIST_TIMEOUT,
                        codex_model_provider::list_models_for_provider(info, http_client_factory),
                    )
                    .await;
                    match listed {
                        Ok(Ok(models)) => OtherProviderModels {
                            provider_id,
                            models: models
                                .into_iter()
                                .map(|model| model.slug)
                                .filter(|slug| model_matches_filters(filters.as_deref(), slug))
                                .collect(),
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
                    search_value: Some(format!("{model} {provider_id}")),
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

/// `*` matches any run of characters; matching is case-insensitive. No
/// filters (or an empty list) keeps every model.
pub(crate) fn model_matches_filters(filters: Option<&[String]>, slug: &str) -> bool {
    let Some(filters) = filters.filter(|filters| !filters.is_empty()) else {
        return true;
    };
    let slug = slug.to_ascii_lowercase();
    filters
        .iter()
        .any(|pattern| glob_match(&pattern.to_ascii_lowercase(), &slug))
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let mut parts = pattern.split('*');
    let Some(first) = parts.next() else {
        return true;
    };
    if !text.starts_with(first) {
        return false;
    }
    let mut rest = &text[first.len()..];
    let mut last: Option<&str> = None;
    for part in parts {
        last = Some(part);
        match rest.find(part) {
            Some(idx) => rest = &rest[idx + part.len()..],
            None => return false,
        }
    }
    match last {
        // No `*` in the pattern: exact match only.
        None => rest.is_empty(),
        // Trailing `*` accepts any suffix; otherwise the last segment must end the text.
        Some(part) => part.is_empty() || rest.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::model_matches_filters;

    #[test]
    fn picker_filters_use_simple_globs() {
        let f = |patterns: &[&str], slug: &str| {
            let patterns: Vec<String> = patterns.iter().map(|p| p.to_string()).collect();
            model_matches_filters(Some(&patterns), slug)
        };
        assert!(model_matches_filters(None, "anything"));
        assert!(f(&[], "anything"));
        assert!(f(&["gpt-6*"], "gpt-6-sol"));
        assert!(f(&["GPT-6*"], "gpt-6-sol-thinking"));
        assert!(!f(&["gpt-6*"], "gpt-5.6-sol"));
        assert!(f(&["*flash*"], "gemini-3.8-flash-high"));
        assert!(f(&["gemini-3.8-flash-high"], "gemini-3.8-flash-high"));
        assert!(!f(&["gemini-3.8-flash-high"], "gemini-3.8-flash-high-x"));
        assert!(f(&["*-sol"], "gpt-6-sol"));
        assert!(!f(&["*-sol"], "gpt-6-sol-thinking"));
    }
}
