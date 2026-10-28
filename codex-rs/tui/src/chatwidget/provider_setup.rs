//! hcodex: `/provider` UI flow on `ChatWidget` (input overlay, model picker,
//! default prompt). Network + persistence live in `app::provider_setup`.

use super::*;
use crate::app_event::ProviderSetupDraft;
use crate::bottom_pane::ProviderSetupView;
use crate::bottom_pane::provider_setup_view::normalize_base_url;
use crate::bottom_pane::provider_setup_view::sanitize_provider_id;

pub(crate) const PROVIDER_USAGE: &str = "Usage: /provider                      open the setup wizard (id, base URL, masked API key)\n       /provider <id> <https://base/url/v1>   add a provider inline\n       /provider use <id> [model]      continue this conversation on a configured provider";

/// What `/provider <args>` asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProviderCommand {
    /// Open the wizard.
    Wizard,
    /// Add a provider inline: id + base URL.
    Setup {
        id: String,
        base_url: String,
    },
    /// Switch this conversation to an already configured provider.
    Switch {
        provider_id: String,
        model: Option<String>,
    },
    Usage,
}

/// Parses `/provider` arguments. `use` is optional: `/provider <id> [model]`
/// also switches when the second token is not a URL.
pub(crate) fn parse_provider_command(inline_args: Option<&str>) -> ProviderCommand {
    let args = inline_args.map(str::trim).filter(|s| !s.is_empty());
    let Some(args) = args else {
        return ProviderCommand::Wizard;
    };
    let mut parts = args.split_whitespace().peekable();
    let explicit_use = parts.peek().is_some_and(|first| *first == "use");
    if explicit_use {
        parts.next();
    }
    let Some(first) = parts.next() else {
        return ProviderCommand::Usage;
    };
    let second = parts.next();
    if parts.next().is_some() {
        return ProviderCommand::Usage;
    }
    if !explicit_use && let Some(base_url) = second.and_then(normalize_base_url) {
        let id = sanitize_provider_id(first);
        if id.is_empty() {
            return ProviderCommand::Usage;
        }
        return ProviderCommand::Setup { id, base_url };
    }
    let provider_id = sanitize_provider_id(first);
    if provider_id.is_empty() {
        return ProviderCommand::Usage;
    }
    ProviderCommand::Switch {
        provider_id,
        model: second.map(str::to_string),
    }
}

impl ChatWidget {
    /// `/provider` with no args opens the step-by-step overlay; with inline
    /// args (`/provider <id> <base_url>`) it skips straight to the model
    /// listing; `/provider use <id> [model]` switches this conversation.
    pub(crate) fn open_provider_setup(&mut self, inline_args: Option<&str>) {
        match parse_provider_command(inline_args) {
            ProviderCommand::Wizard => {
                let view = ProviderSetupView::new(self.app_event_tx.clone());
                self.bottom_pane.show_view(Box::new(view));
                self.request_redraw();
            }
            ProviderCommand::Setup { id, base_url } => {
                self.app_event_tx.send(AppEvent::ProviderSetupSubmitted {
                    draft: ProviderSetupDraft {
                        id,
                        base_url,
                        api_key: None,
                    },
                });
            }
            ProviderCommand::Switch { provider_id, model } => {
                self.app_event_tx
                    .send(AppEvent::ProviderSwitch { provider_id, model });
            }
            ProviderCommand::Usage => self.add_error_message(PROVIDER_USAGE.to_string()),
        }
    }

    /// `/provider use <id>` without a model: pick one from the provider's list.
    pub(crate) fn open_provider_switch_model_picker(
        &mut self,
        provider_id: String,
        models: Vec<String>,
    ) {
        let items: Vec<SelectionItem> = models
            .into_iter()
            .map(|model| {
                let provider_id = provider_id.clone();
                let chosen = model.clone();
                SelectionItem {
                    name: model,
                    actions: vec![Box::new(move |tx: &AppEventSender| {
                        tx.send(AppEvent::ProviderSwitch {
                            provider_id: provider_id.clone(),
                            model: Some(chosen.clone()),
                        });
                    })],
                    dismiss_on_select: true,
                    ..Default::default()
                }
            })
            .collect();
        let count = items.len();
        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some(format!("Switch this conversation to `{provider_id}`")),
            subtitle: Some(format!(
                "{count} models — the history carries over; the thread is forked on the new provider"
            )),
            footer_hint: Some(crate::bottom_pane::popup_consts::standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to filter models...".to_string()),
            ..Default::default()
        });
        self.request_redraw();
    }

    /// Searchable picker over the models the provider reported.
    pub(crate) fn open_provider_model_picker(
        &mut self,
        draft: ProviderSetupDraft,
        models: Vec<String>,
    ) {
        let items: Vec<SelectionItem> = models
            .into_iter()
            .map(|model| {
                let draft = draft.clone();
                let chosen = model.clone();
                SelectionItem {
                    name: model,
                    actions: vec![Box::new(move |tx: &AppEventSender| {
                        tx.send(AppEvent::ProviderModelChosen {
                            draft: draft.clone(),
                            model: chosen.clone(),
                        });
                    })],
                    dismiss_on_select: true,
                    ..Default::default()
                }
            })
            .collect();
        let count = items.len();
        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some(format!("Default model for `{}`", draft.id)),
            subtitle: Some(format!(
                "{count} models from {}/models — you can change it later with /model",
                draft.base_url
            )),
            footer_hint: Some(crate::bottom_pane::popup_consts::standard_popup_hint_line()),
            items,
            is_searchable: true,
            search_placeholder: Some("Type to filter models...".to_string()),
            ..Default::default()
        });
        self.request_redraw();
    }

    /// Listing failed: explain and fall back to typing the model id.
    pub(crate) fn open_provider_model_prompt(&mut self, draft: ProviderSetupDraft, note: String) {
        let view = ProviderSetupView::model_prompt(draft, self.app_event_tx.clone(), Some(note));
        self.bottom_pane.show_view(Box::new(view));
        self.request_redraw();
    }

    /// Ask whether the new provider becomes the default in config.toml or
    /// stays reachable only via `hcodex -p <id>`.
    pub(crate) fn open_provider_default_prompt(
        &mut self,
        draft: ProviderSetupDraft,
        model: String,
    ) {
        let make_item = |name: String, description: String, make_default: bool, use_now: bool| {
            let draft = draft.clone();
            let model = model.clone();
            SelectionItem {
                name,
                description: Some(description),
                actions: vec![Box::new(move |tx: &AppEventSender| {
                    tx.send(AppEvent::ProviderSave {
                        draft: draft.clone(),
                        model: model.clone(),
                        make_default,
                        use_now,
                    });
                })],
                dismiss_on_select: true,
                ..Default::default()
            }
        };
        let items = vec![
            make_item(
                "Use it now".to_string(),
                format!(
                    "save the `{}` profile and continue this conversation on it; the default in config.toml stays unchanged",
                    draft.id
                ),
                false,
                true,
            ),
            make_item(
                "Make it the default and use it now".to_string(),
                "sets model_provider + model at the top of config.toml, then continues this conversation on it"
                    .to_string(),
                true,
                true,
            ),
            make_item(
                "Save profile only".to_string(),
                format!(
                    "keep this thread; use it later with `hcodex -p {}`",
                    draft.id
                ),
                false,
                false,
            ),
        ];
        self.bottom_pane.show_selection_view(SelectionViewParams {
            title: Some(format!("Save provider `{}` with model `{model}`", draft.id)),
            footer_hint: Some(crate::bottom_pane::popup_consts::standard_popup_hint_line()),
            items,
            ..Default::default()
        });
        self.request_redraw();
    }
}

#[cfg(test)]
mod parse_tests {
    use super::ProviderCommand;
    use super::parse_provider_command;
    use pretty_assertions::assert_eq;

    #[test]
    fn provider_args_route_to_wizard_setup_or_switch() {
        assert_eq!(parse_provider_command(None), ProviderCommand::Wizard);
        assert_eq!(parse_provider_command(Some("   ")), ProviderCommand::Wizard);
        assert_eq!(
            parse_provider_command(Some("groq https://api.groq.com/openai/v1")),
            ProviderCommand::Setup {
                id: "groq".to_string(),
                base_url: "https://api.groq.com/openai/v1".to_string(),
            }
        );
        assert_eq!(
            parse_provider_command(Some("use cliproxy")),
            ProviderCommand::Switch {
                provider_id: "cliproxy".to_string(),
                model: None,
            }
        );
        assert_eq!(
            parse_provider_command(Some("use cliproxy gpt-6-sol")),
            ProviderCommand::Switch {
                provider_id: "cliproxy".to_string(),
                model: Some("gpt-6-sol".to_string()),
            }
        );
        // `use` is optional when the second token is not a URL.
        assert_eq!(
            parse_provider_command(Some("local-proxy claude-sonnet-5.5")),
            ProviderCommand::Switch {
                provider_id: "local-proxy".to_string(),
                model: Some("claude-sonnet-5.5".to_string()),
            }
        );
        assert_eq!(
            parse_provider_command(Some("use groq https://api.groq.com/openai/v1 extra")),
            ProviderCommand::Usage
        );
        assert_eq!(parse_provider_command(Some("use")), ProviderCommand::Usage);
    }
}
