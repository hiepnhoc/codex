use codex_protocol::config_types::Personality;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelMessages;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::ReasoningEffortPreset;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::collections::HashSet;
use std::io;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;

pub const MODEL_OVERRIDES_FILE: &str = "model_overrides.toml";

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelOverrides {
    #[serde(default)]
    models: BTreeMap<String, ModelMetadataOverride>,
    #[serde(default)]
    providers: BTreeMap<String, ProviderModelOverrides>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderModelOverrides {
    #[serde(default)]
    models: BTreeMap<String, ModelMetadataOverride>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelMetadataOverride {
    context_window: Option<i64>,
    default_reasoning_effort: Option<ReasoningEffort>,
    supported_reasoning_efforts: Option<Vec<ReasoningEffort>>,
    input_modalities: Option<Vec<InputModality>>,
    instructions: Option<String>,
    instructions_file: Option<PathBuf>,
}

impl ModelOverrides {
    pub fn load_optional(path: &Path) -> io::Result<Self> {
        let contents = match std::fs::read_to_string(path) {
            Ok(contents) => contents,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Self::default()),
            Err(err) => return Err(err),
        };
        let mut overrides = toml::from_str::<Self>(&contents).map_err(|err| {
            io::Error::new(
                ErrorKind::InvalidData,
                format!(
                    "failed to parse model overrides `{}`: {err}",
                    path.display()
                ),
            )
        })?;
        let base_dir = path.parent().unwrap_or_else(|| Path::new("."));
        for (model, model_override) in &mut overrides.models {
            model_override.resolve_and_validate(base_dir, "models", model)?;
        }
        for (provider, provider_overrides) in &mut overrides.providers {
            let scope = format!("providers.{provider}.models");
            for (model, model_override) in &mut provider_overrides.models {
                model_override.resolve_and_validate(base_dir, &scope, model)?;
            }
        }
        Ok(overrides)
    }

    pub(crate) fn apply_to_model(
        &self,
        provider_id: Option<&str>,
        model_slug: &str,
        mut model: ModelInfo,
    ) -> ModelInfo {
        let mut resolved = self.models.get(model_slug).cloned().unwrap_or_default();
        if let Some(provider_override) = provider_id
            .and_then(|provider_id| self.providers.get(provider_id))
            .and_then(|provider| provider.models.get(model_slug))
        {
            resolved.merge(provider_override);
        }
        resolved.apply(&mut model);
        model
    }

    pub(crate) fn apply_to_models(
        &self,
        provider_id: Option<&str>,
        models: Vec<ModelInfo>,
    ) -> Vec<ModelInfo> {
        models
            .into_iter()
            .map(|model| {
                let slug = model.slug.clone();
                self.apply_to_model(provider_id, &slug, model)
            })
            .collect()
    }
}

impl ModelMetadataOverride {
    fn resolve_and_validate(
        &mut self,
        base_dir: &Path,
        scope: &str,
        model: &str,
    ) -> io::Result<()> {
        let field = format!("{scope}.{model}");
        if self.context_window.is_some_and(|value| value <= 0) {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                format!("{field}.context_window must be greater than zero"),
            ));
        }
        if let Some(supported_reasoning_efforts) = &self.supported_reasoning_efforts {
            if supported_reasoning_efforts.is_empty() {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    format!("{field}.supported_reasoning_efforts must not be empty"),
                ));
            }
            let unique_efforts = supported_reasoning_efforts.iter().collect::<HashSet<_>>();
            if unique_efforts.len() != supported_reasoning_efforts.len() {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    format!("{field}.supported_reasoning_efforts must not contain duplicates"),
                ));
            }
            if let Some(default_reasoning_effort) = &self.default_reasoning_effort
                && !supported_reasoning_efforts.contains(default_reasoning_effort)
            {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    format!(
                        "{field}.default_reasoning_effort must be listed in supported_reasoning_efforts"
                    ),
                ));
            }
        }
        if self.input_modalities.as_ref().is_some_and(Vec::is_empty) {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                format!("{field}.input_modalities must not be empty"),
            ));
        }
        if self.instructions.is_some() && self.instructions_file.is_some() {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                format!("{field} cannot set both instructions and instructions_file"),
            ));
        }
        if let Some(path) = self.instructions_file.take() {
            let path = if path.is_absolute() {
                path
            } else {
                base_dir.join(path)
            };
            let instructions = std::fs::read_to_string(&path).map_err(|err| {
                io::Error::new(
                    err.kind(),
                    format!(
                        "failed to read {field}.instructions_file `{}`: {err}",
                        path.display()
                    ),
                )
            })?;
            if instructions.trim().is_empty() {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    format!("{field}.instructions_file is empty: {}", path.display()),
                ));
            }
            self.instructions = Some(instructions.trim().to_string());
        }
        Ok(())
    }

    fn merge(&mut self, overlay: &Self) {
        if overlay.context_window.is_some() {
            self.context_window = overlay.context_window;
        }
        if overlay.default_reasoning_effort.is_some() {
            self.default_reasoning_effort = overlay.default_reasoning_effort.clone();
        }
        if overlay.supported_reasoning_efforts.is_some() {
            self.supported_reasoning_efforts = overlay.supported_reasoning_efforts.clone();
        }
        if overlay.input_modalities.is_some() {
            self.input_modalities = overlay.input_modalities.clone();
        }
        if overlay.instructions.is_some() {
            self.instructions = overlay.instructions.clone();
        }
    }

    fn apply(self, model: &mut ModelInfo) {
        if let Some(context_window) = self.context_window {
            model.context_window = Some(context_window);
            // This file is the local authoritative metadata layer. Do not turn
            // the selected value into a ceiling: an explicit config/CLI
            // `model_context_window` override is applied afterwards.
            model.max_context_window = None;
        }
        if let Some(default_reasoning_effort) = self.default_reasoning_effort {
            model.default_reasoning_level = Some(default_reasoning_effort);
        }
        if let Some(supported_reasoning_efforts) = self.supported_reasoning_efforts {
            model.supported_reasoning_levels = supported_reasoning_efforts
                .into_iter()
                .map(|effort| ReasoningEffortPreset {
                    description: effort.to_string(),
                    effort,
                })
                .collect();
        }
        if let Some(input_modalities) = self.input_modalities {
            model.input_modalities = input_modalities;
        }
        if let Some(instructions) = self.instructions {
            let messages = model
                .model_messages
                .get_or_insert_with(empty_model_messages);
            messages.instructions_template = Some(instructions);
            messages.instructions_variables = None;
        }
    }
}

fn empty_model_messages() -> ModelMessages {
    ModelMessages {
        persistent_instructions: None,
        tools: None,
        instructions_template: None,
        instructions_variables: None,
        approvals: None,
        collaboration_modes: None,
        auto_review: None,
        permissions: None,
        multi_agent: None,
        token_budget: None,
        guardian_v2: None,
        confirmation_policies: None,
        content_filter_guidance: None,
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModelsManagerConfig {
    pub model_context_window: Option<i64>,
    pub model_auto_compact_token_limit: Option<i64>,
    pub tool_output_token_limit: Option<usize>,
    pub base_instructions: Option<String>,
    pub personality: Option<Personality>,
    pub model_catalog: Option<ModelsResponse>,
    pub model_provider_id: Option<String>,
    pub model_overrides: ModelOverrides,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_info::model_info_from_slug;
    use codex_protocol::openai_models::InputModality;
    use codex_protocol::openai_models::ReasoningEffort;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    #[test]
    fn provider_metadata_overrides_global_metadata_and_loads_relative_prompt() {
        let directory = tempdir().expect("create temp dir");
        std::fs::write(directory.path().join("cliproxy.md"), "Provider prompt\n")
            .expect("write prompt");
        let overrides_path = directory.path().join(MODEL_OVERRIDES_FILE);
        std::fs::write(
            &overrides_path,
            r#"
[models."model-a"]
context_window = 100000
default_reasoning_effort = "medium"
supported_reasoning_efforts = ["low", "medium"]
input_modalities = ["text"]
instructions = "Global prompt"

[providers.cliproxy.models."model-a"]
context_window = 200000
default_reasoning_effort = "high"
supported_reasoning_efforts = ["high", "xhigh"]
input_modalities = ["text", "image", "audio"]
instructions_file = "cliproxy.md"
"#,
        )
        .expect("write overrides");

        let overrides = ModelOverrides::load_optional(&overrides_path).expect("load overrides");
        let provider_model =
            overrides.apply_to_model(Some("cliproxy"), "model-a", model_info_from_slug("model-a"));
        assert_eq!(provider_model.context_window, Some(200_000));
        assert_eq!(provider_model.max_context_window, None);
        assert_eq!(
            provider_model.default_reasoning_level,
            Some(ReasoningEffort::High)
        );
        assert_eq!(
            provider_model
                .supported_reasoning_levels
                .iter()
                .map(|preset| preset.effort.clone())
                .collect::<Vec<_>>(),
            vec![ReasoningEffort::High, ReasoningEffort::XHigh]
        );
        assert_eq!(
            provider_model.input_modalities,
            vec![
                InputModality::Text,
                InputModality::Image,
                InputModality::Audio
            ]
        );
        assert_eq!(
            codex_prompts::render_model_instructions(&provider_model),
            "Provider prompt"
        );

        let other_provider_model =
            overrides.apply_to_model(Some("other"), "model-a", model_info_from_slug("model-a"));
        assert_eq!(other_provider_model.context_window, Some(100_000));
        assert_eq!(
            codex_prompts::render_model_instructions(&other_provider_model),
            "Global prompt"
        );
    }

    #[test]
    fn invalid_empty_metadata_lists_are_rejected() {
        let directory = tempdir().expect("create temp dir");
        let overrides_path = directory.path().join(MODEL_OVERRIDES_FILE);
        std::fs::write(
            &overrides_path,
            r#"
[models."model-a"]
supported_reasoning_efforts = []
"#,
        )
        .expect("write overrides");

        let error = ModelOverrides::load_optional(&overrides_path)
            .expect_err("empty supported efforts should fail");
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert!(
            error
                .to_string()
                .contains("models.model-a.supported_reasoning_efforts must not be empty")
        );
    }

    #[test]
    fn inconsistent_reasoning_efforts_are_rejected() {
        for (supported, expected) in [
            (
                r#"["low", "low"]"#,
                "supported_reasoning_efforts must not contain duplicates",
            ),
            (
                r#"["low", "medium"]"#,
                "default_reasoning_effort must be listed in supported_reasoning_efforts",
            ),
        ] {
            let directory = tempdir().expect("create temp dir");
            let overrides_path = directory.path().join(MODEL_OVERRIDES_FILE);
            std::fs::write(
                &overrides_path,
                format!(
                    r#"
[models."model-a"]
default_reasoning_effort = "high"
supported_reasoning_efforts = {supported}
"#
                ),
            )
            .expect("write overrides");

            let error = ModelOverrides::load_optional(&overrides_path)
                .expect_err("inconsistent reasoning metadata should fail");
            assert_eq!(error.kind(), ErrorKind::InvalidData);
            assert!(
                error.to_string().contains(expected),
                "unexpected error: {error}"
            );
        }
    }
}
