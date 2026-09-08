//! hcodex harness: model discovery for OpenAI-compatible providers (local proxy,
//! Ollama, LM Studio, custom `model_providers.*`).
//!
//! Most such providers speak the plain OpenAI `GET /v1/models` shape
//! (`{"data":[{"id":..}]}`); we map every id onto a fallback `ModelInfo` and let
//! the manager use that list as the whole catalog. A provider that already
//! returns Codex's `ModelsResponse` catalog (`{"models":[..]}`) is passed through.

use std::time::Duration;

use codex_http_client::ClientRouteClass;
use codex_http_client::HttpClientFactory;
use codex_login::default_client::create_client_for_route_async;
use codex_model_provider_info::ModelProviderInfo;
use codex_models_manager::manager::ModelsEndpointClient;
use codex_models_manager::manager::ModelsEndpointFuture;
use codex_models_manager::model_info::model_info_from_slug;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result as CoreResult;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::ReasoningEffortPreset;
use codex_utils_redacted_string::RedactedString;
use serde::Deserialize;
use tokio::time::timeout;

const MODELS_REFRESH_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_CONTEXT_WINDOW: i64 = 1_000_000;

#[derive(Debug)]
pub(crate) struct LocalProxyModelsEndpoint {
    provider_info: ModelProviderInfo,
}

#[derive(Deserialize)]
struct OpenAiModelList {
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize)]
struct OpenAiModel {
    id: String,
    #[serde(default)]
    owned_by: Option<String>,
}

impl LocalProxyModelsEndpoint {
    pub(crate) fn new(provider_info: ModelProviderInfo) -> Self {
        Self { provider_info }
    }

    fn models_url(&self) -> String {
        let base =
            self.provider_info.base_url.clone().unwrap_or_else(|| {
                codex_model_provider_info::LOCAL_PROXY_DEFAULT_BASE_URL.to_string()
            });
        // Fail fast on typos instead of guessing a URL.
        format!("{}/models", base.trim_end_matches('/'))
    }

    async fn fetch(&self, http_client_factory: HttpClientFactory) -> CoreResult<Vec<ModelInfo>> {
        let url = self.models_url();
        let client =
            create_client_for_route_async(http_client_factory, url.clone(), ClientRouteClass::Api)
                .await
                .map_err(|err| CodexErr::Stream(format!("local-proxy models client: {err}")))?;
        let mut request = client.get(&url);
        let bearer = self
            .provider_info
            .experimental_bearer_token
            .clone()
            .map(RedactedString::into_inner)
            .or_else(|| self.provider_info.api_key().ok().flatten());
        if let Some(key) = bearer {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(|err| CodexErr::Stream(format!("local-proxy GET {url}: {err}")))?;
        if !response.status().is_success() {
            return Err(CodexErr::Stream(format!(
                "local-proxy GET {url} returned {}",
                response.status()
            )));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|err| CodexErr::Stream(format!("local-proxy models decode: {err}")))?;

        // Codex-native catalog: use as-is.
        if body.get("models").is_some()
            && let Ok(catalog) = serde_json::from_value::<ModelsResponse>(body.clone())
        {
            return Ok(catalog.models);
        }

        let list: OpenAiModelList = serde_json::from_value(body)
            .map_err(|err| CodexErr::Stream(format!("local-proxy models decode: {err}")))?;

        let mut seen = std::collections::HashSet::new();
        let models = list
            .data
            .into_iter()
            .filter(|m| seen.insert(m.id.clone()))
            .enumerate()
            .map(|(index, m)| {
                model_info_for(
                    &m.id,
                    m.owned_by.as_deref(),
                    index as i32,
                    &self.provider_info.name,
                )
            })
            .collect();
        Ok(models)
    }
}

pub(crate) fn model_info_for(
    slug: &str,
    owned_by: Option<&str>,
    priority: i32,
    provider_name: &str,
) -> ModelInfo {
    let mut info = model_info_from_slug(slug);
    info.display_name = slug.to_string();
    info.description = Some(match owned_by {
        Some(o) => format!("via {provider_name} ({o})"),
        None => format!("via {provider_name}"),
    });
    info.visibility = ModelVisibility::List;
    info.supported_in_api = true;
    // The harness default model sorts first so the picker marks it as default.
    info.priority = if slug == codex_model_provider_info::LOCAL_PROXY_DEFAULT_MODEL {
        -1
    } else {
        priority
    };
    // Expose the standard effort ladder; the proxy forwards `reasoning.effort`.
    info.supported_reasoning_levels = [
        (ReasoningEffort::Low, "Fast, lighter reasoning"),
        (ReasoningEffort::Medium, "Balanced"),
        (ReasoningEffort::High, "Deeper reasoning"),
        (ReasoningEffort::XHigh, "Maximum reasoning"),
    ]
    .into_iter()
    .map(|(effort, description)| ReasoningEffortPreset {
        effort,
        description: description.to_string(),
    })
    .collect();
    info.default_reasoning_level = Some(ReasoningEffort::Medium);
    info.context_window = Some(DEFAULT_CONTEXT_WINDOW);
    info.max_context_window = None;
    // These entries are authoritative for the proxy, not a guess.
    info.used_fallback_model_metadata = false;
    info
}

/// hcodex: one-shot model listing for an ad-hoc provider definition (used by the
/// TUI `/provider` setup flow to validate a base URL / key before saving it).
pub async fn list_models_for_provider(
    provider_info: ModelProviderInfo,
    http_client_factory: HttpClientFactory,
) -> CoreResult<Vec<ModelInfo>> {
    let endpoint = LocalProxyModelsEndpoint::new(provider_info);
    timeout(MODELS_REFRESH_TIMEOUT, endpoint.fetch(http_client_factory))
        .await
        .map_err(|_| CodexErr::Timeout)?
}

impl ModelsEndpointClient for LocalProxyModelsEndpoint {
    /// Report "command auth" so the manager always refreshes; the proxy needs no auth.
    fn has_command_auth(&self) -> bool {
        true
    }

    fn uses_codex_backend(&self) -> ModelsEndpointFuture<'_, bool> {
        Box::pin(async { false })
    }

    fn replaces_catalog(&self) -> bool {
        true
    }

    fn list_models<'a>(
        &'a self,
        _client_version: &'a str,
        http_client_factory: HttpClientFactory,
    ) -> ModelsEndpointFuture<'a, CoreResult<(Vec<ModelInfo>, Option<String>)>> {
        Box::pin(async move {
            let models = timeout(MODELS_REFRESH_TIMEOUT, self.fetch(http_client_factory))
                .await
                .map_err(|_| CodexErr::Timeout)??;
            Ok((models, None))
        })
    }
}
