//! hcodex harness: model discovery for OpenAI-compatible providers (local proxy,
//! Ollama, LM Studio, custom `model_providers.*`).
//!
//! Most such providers speak the plain OpenAI `GET /v1/models` shape
//! (`{"data":[{"id":..}]}`); we map every id onto a fallback `ModelInfo` and let
//! the manager use that list as the whole catalog. A provider that already
//! returns Codex's `ModelsResponse` catalog (`{"models":[..]}`) is passed through.

use std::sync::Arc;
use std::time::Duration;

use codex_http_client::ClientRouteClass;
use codex_http_client::HttpClientFactory;
use codex_login::AuthManager;
use codex_login::default_client::ClientRedirectPolicy;
use codex_login::default_client::create_client_for_route_async;
use codex_model_provider_info::ModelProviderInfo;
use codex_models_manager::manager::ModelsEndpointClient;
use codex_models_manager::manager::ModelsEndpointFuture;
use codex_models_manager::manager::ModelsEndpointResponse;
use codex_models_manager::model_info::model_info_from_slug;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result as CoreResult;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::ReasoningEffortPreset;
use codex_utils_redacted_string::RedactedString;
use serde::Deserialize;
use sha2::Digest;
use sha2::Sha256;
use tokio::time::timeout;

const MODELS_REFRESH_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_CONTEXT_WINDOW: i64 = 1_000_000;
pub(crate) const HCODEX_INSTRUCTIONS_OPENING: &str = "You are a coding agent running in hcodex, a terminal-based development harness. You are expected to be precise, safe, and helpful.";

#[derive(Debug)]
pub(crate) struct LocalProxyModelsEndpoint {
    provider_info: ModelProviderInfo,
    auth_manager: Option<Arc<AuthManager>>,
}

#[derive(Deserialize)]
struct OpenAiModelList {
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize, Default, Clone)]
struct OpenAiModel {
    id: String,
    #[serde(default)]
    owned_by: Option<String>,
    /// hcodex: optional per-model metadata some proxies (Kiro-Go) publish.
    #[serde(default)]
    input_modalities: Option<Vec<String>>,
    #[serde(default)]
    modalities: Option<OpenAiModelModalities>,
    #[serde(default)]
    context_window: Option<i64>,
}

#[derive(Deserialize, Default, Clone)]
struct OpenAiModelModalities {
    #[serde(default)]
    input: Option<Vec<String>>,
}

/// hcodex: metadata derived from the provider's `/models` payload for one model.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct ProxyModelMetadata {
    pub input_modalities: Option<Vec<InputModality>>,
    pub context_window: Option<i64>,
    /// Effort levels advertised through `<slug>-effort-<level>` sibling ids.
    pub reasoning_efforts: Option<Vec<ReasoningEffort>>,
}

const EFFORT_VARIANT_MARKER: &str = "-effort-";

/// Split `claude-opus-5-effort-high` into (`claude-opus-5`, High).
fn split_effort_variant(id: &str) -> Option<(&str, ReasoningEffort)> {
    let idx = id.rfind(EFFORT_VARIANT_MARKER)?;
    let base = &id[..idx];
    let level = &id[idx + EFFORT_VARIANT_MARKER.len()..];
    if base.is_empty() || level.contains('-') {
        return None;
    }
    let effort = level.parse::<ReasoningEffort>().ok()?;
    Some((base, effort))
}

fn input_modalities_from_strings(values: &[String]) -> Option<Vec<InputModality>> {
    let mut modalities: Vec<InputModality> = values
        .iter()
        .filter_map(|value| match value.to_ascii_lowercase().as_str() {
            "text" => Some(InputModality::Text),
            "image" | "vision" => Some(InputModality::Image),
            "audio" => Some(InputModality::Audio),
            _ => None,
        })
        .collect();
    modalities.dedup();
    (!modalities.is_empty()).then_some(modalities)
}

/// hcodex: turn a plain OpenAI `/models` list into the harness catalog.
///
/// `<slug>-effort-<level>` ids (Kiro-Go publishes one per accepted level) are
/// folded into their base model's effort ladder and hidden from the picker;
/// `input_modalities`/`modalities.input` and `context_window` are honored when
/// present, otherwise the harness defaults apply.
fn models_from_openai_list(list: Vec<OpenAiModel>, provider_name: &str) -> Vec<ModelInfo> {
    let mut seen = std::collections::HashSet::new();
    let list: Vec<OpenAiModel> = list
        .into_iter()
        .filter(|m| seen.insert(m.id.clone()))
        .collect();
    let ids: std::collections::HashSet<String> = list.iter().map(|m| m.id.clone()).collect();

    // Effort ladders advertised as sibling ids, keyed by base model.
    let mut efforts: std::collections::HashMap<String, Vec<ReasoningEffort>> =
        std::collections::HashMap::new();
    for m in &list {
        if let Some((base, effort)) = split_effort_variant(&m.id)
            && ids.contains(base)
        {
            let ladder = efforts.entry(base.to_string()).or_default();
            if !ladder.contains(&effort) {
                ladder.push(effort);
            }
        }
    }

    list.into_iter()
        .filter(|m| {
            // Hide a variant only when its base model is listed; otherwise keep it
            // as a regular model so nothing the provider offers disappears.
            !split_effort_variant(&m.id).is_some_and(|(base, _)| ids.contains(base))
        })
        .enumerate()
        .map(|(index, m)| {
            let modalities = m
                .input_modalities
                .as_deref()
                .or(m.modalities.as_ref().and_then(|mods| mods.input.as_deref()))
                .and_then(input_modalities_from_strings);
            let metadata = ProxyModelMetadata {
                input_modalities: modalities,
                context_window: m.context_window.filter(|window| *window > 0),
                reasoning_efforts: efforts.remove(&m.id),
            };
            model_info_for(
                &m.id,
                m.owned_by.as_deref(),
                index as i32,
                provider_name,
                &metadata,
            )
        })
        .collect()
}

impl LocalProxyModelsEndpoint {
    pub(crate) fn new(
        provider_info: ModelProviderInfo,
        auth_manager: Option<Arc<AuthManager>>,
    ) -> Self {
        Self {
            provider_info,
            auth_manager,
        }
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
        let client = create_client_for_route_async(
            http_client_factory,
            url.clone(),
            ClientRouteClass::Api,
            ClientRedirectPolicy::Default,
        )
        .await
        .map_err(|err| CodexErr::Stream(format!("local-proxy models client: {err}")))?;
        let mut request = client.get(&url);
        let configured_bearer = self
            .provider_info
            .experimental_bearer_token
            .clone()
            .map(RedactedString::into_inner)
            .or_else(|| self.provider_info.api_key().ok().flatten());
        let bearer = match configured_bearer {
            Some(bearer) => Some(bearer),
            None => match self.auth_manager.as_ref() {
                Some(auth_manager) => auth_manager
                    .auth()
                    .await
                    .and_then(|auth| auth.get_token().ok()),
                None => None,
            },
        };
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

        // Codex-native catalog: preserve metadata while removing incompatible model identities.
        if body.get("models").is_some()
            && let Ok(catalog) = serde_json::from_value::<ModelsResponse>(body.clone())
        {
            return Ok(catalog
                .models
                .into_iter()
                .map(normalize_proxy_model_instructions)
                .collect());
        }

        let list: OpenAiModelList = serde_json::from_value(body)
            .map_err(|err| CodexErr::Stream(format!("local-proxy models decode: {err}")))?;
        Ok(models_from_openai_list(list.data, &self.provider_info.name))
    }
}

pub(crate) fn model_info_for(
    slug: &str,
    owned_by: Option<&str>,
    priority: i32,
    provider_name: &str,
    metadata: &ProxyModelMetadata,
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
    // Effort ladder: what the provider advertised (`<slug>-effort-<level>` ids)
    // or the standard ladder; the proxy forwards `reasoning.effort`.
    let efforts: Vec<ReasoningEffort> = metadata.reasoning_efforts.clone().unwrap_or_else(|| {
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::XHigh,
        ]
    });
    info.supported_reasoning_levels = efforts
        .iter()
        .map(|effort| ReasoningEffortPreset {
            effort: effort.clone(),
            description: effort_description(effort).to_string(),
        })
        .collect();
    info.default_reasoning_level = Some(if efforts.contains(&ReasoningEffort::Medium) {
        ReasoningEffort::Medium
    } else {
        efforts.first().cloned().unwrap_or(ReasoningEffort::Medium)
    });
    if let Some(modalities) = &metadata.input_modalities {
        info.input_modalities = modalities.clone();
    }
    info.context_window = Some(metadata.context_window.unwrap_or(DEFAULT_CONTEXT_WINDOW));
    info.max_context_window = None;
    // These entries are authoritative for the proxy, not a guess.
    info.used_fallback_model_metadata = false;
    normalize_proxy_model_instructions(info)
}

fn effort_description(effort: &ReasoningEffort) -> &'static str {
    match effort {
        ReasoningEffort::None => "No extended reasoning",
        ReasoningEffort::Minimal => "Minimal reasoning",
        ReasoningEffort::Low => "Fast, lighter reasoning",
        ReasoningEffort::Medium => "Balanced",
        ReasoningEffort::High => "Deeper reasoning",
        ReasoningEffort::XHigh => "Very deep reasoning",
        ReasoningEffort::Max => "Maximum reasoning",
        _ => "Provider-defined reasoning level",
    }
}

fn normalize_proxy_model_instructions(mut info: ModelInfo) -> ModelInfo {
    let Some(messages) = info.model_messages.as_mut() else {
        return info;
    };
    let Some(instructions) = messages.instructions_template.as_mut() else {
        return info;
    };
    let opening_end = instructions.find("\n\n").unwrap_or(instructions.len());
    let opening = &instructions[..opening_end];
    let opening_lowercase = opening.to_ascii_lowercase();
    let has_openai_identity = opening_lowercase.contains("you are codex")
        || opening_lowercase.contains("you are gpt")
        || opening_lowercase.contains("based on gpt");
    if !has_openai_identity {
        return info;
    }

    instructions.replace_range(..opening_end, HCODEX_INSTRUCTIONS_OPENING);
    info
}

pub(crate) fn normalize_proxy_model_catalog(mut catalog: ModelsResponse) -> ModelsResponse {
    catalog.models = catalog
        .models
        .into_iter()
        .map(normalize_proxy_model_instructions)
        .collect();
    catalog
}

/// hcodex: one-shot model listing for an ad-hoc provider definition (used by the
/// TUI `/provider` setup flow to validate a base URL / key before saving it).
pub async fn list_models_for_provider(
    provider_info: ModelProviderInfo,
    http_client_factory: HttpClientFactory,
) -> CoreResult<Vec<ModelInfo>> {
    let endpoint = LocalProxyModelsEndpoint::new(provider_info, /*auth_manager*/ None);
    timeout(MODELS_REFRESH_TIMEOUT, endpoint.fetch(http_client_factory))
        .await
        .map_err(|_| CodexErr::Timeout)?
}

impl LocalProxyModelsEndpoint {
    /// Provider + endpoint + credential scope, without exposing the credential.
    /// Used both as the cache identity and as the identity stamped on fetched catalogs.
    pub(crate) fn catalog_identity(&self) -> String {
        let auth_scope = if let Some(token) = self.provider_info.experimental_bearer_token.as_ref()
        {
            format!("inline:{:x}", Sha256::digest(token.as_bytes()))
        } else if let Some(env_key) = self.provider_info.env_key.as_deref() {
            let value = std::env::var(env_key).unwrap_or_default();
            format!("env:{env_key}:{:x}", Sha256::digest(value.as_bytes()))
        } else if self.provider_info.auth.is_some() {
            // Command auth: the command line is stable even when the token rotates.
            "command".to_string()
        } else {
            "none".to_string()
        };
        format!(
            "{}|{}|{}",
            self.provider_info.name,
            self.provider_info
                .base_url
                .as_deref()
                .unwrap_or(codex_model_provider_info::LOCAL_PROXY_DEFAULT_BASE_URL),
            auth_scope,
        )
    }
}

impl ModelsEndpointClient for LocalProxyModelsEndpoint {
    fn identity(&self) -> Option<String> {
        // A command may return a different token without changing its command
        // line; do not reuse a persisted catalog across those unobservable scopes.
        if self.provider_info.auth.is_some() {
            return None;
        }
        Some(self.catalog_identity())
    }

    /// Report "command auth" so the manager always refreshes; the proxy needs no auth.
    fn has_command_auth(&self) -> bool {
        true
    }

    fn uses_codex_backend(&self) -> ModelsEndpointFuture<'_, bool> {
        Box::pin(async { false })
    }

    fn list_models<'a>(
        &'a self,
        _client_version: &'a str,
        http_client_factory: HttpClientFactory,
    ) -> ModelsEndpointFuture<'a, CoreResult<ModelsEndpointResponse>> {
        Box::pin(async move {
            let models = timeout(MODELS_REFRESH_TIMEOUT, self.fetch(http_client_factory))
                .await
                .map_err(|_| CodexErr::Timeout)??;
            Ok(ModelsEndpointResponse {
                models,
                etag: None,
                identity: self.catalog_identity(),
            })
        })
    }
}

#[cfg(test)]
#[path = "local_proxy_models_tests.rs"]
mod tests;
