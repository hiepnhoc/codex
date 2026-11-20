use codex_protocol::config_types::Personality;
use codex_protocol::openai_models::ModelsResponse;

mod model_overrides;
pub use model_overrides::MODEL_OVERRIDES_FILE;
pub use model_overrides::ModelOverrides;

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
