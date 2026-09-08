//! hcodex: `/provider` UI flow on `ChatWidget` (input overlay, model picker,
//! default prompt). Network + persistence live in `app::provider_setup`.

use super::*;
use crate::app_event::ProviderSetupDraft;
use crate::bottom_pane::ProviderSetupView;
use crate::bottom_pane::provider_setup_view::normalize_base_url;
use crate::bottom_pane::provider_setup_view::sanitize_provider_id;

impl ChatWidget {
    /// `/provider` with no args opens the step-by-step overlay; with inline
    /// args (`/provider <id> <base_url> [api_key]`) it skips straight to the
    /// model listing.
    pub(crate) fn open_provider_setup(&mut self, inline_args: Option<&str>) {
        let args = inline_args.map(str::trim).filter(|s| !s.is_empty());
        let Some(args) = args else {
            let view = ProviderSetupView::new(self.app_event_tx.clone());
            self.bottom_pane.show_view(Box::new(view));
            self.request_redraw();
            return;
        };
        let mut parts = args.split_whitespace();
        let id = parts.next().map(sanitize_provider_id).unwrap_or_default();
        let base_url = parts.next().and_then(normalize_base_url);
        let api_key = parts.next().map(str::to_string);
        match (id.is_empty(), base_url) {
            (false, Some(base_url)) => {
                self.app_event_tx.send(AppEvent::ProviderSetupSubmitted {
                    draft: ProviderSetupDraft {
                        id,
                        base_url,
                        api_key,
                    },
                });
            }
            _ => self.add_error_message(
                "Usage: /provider <id> <https://base/url/v1> [api_key]  (or just /provider)"
                    .to_string(),
            ),
        }
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
            footer_hint: Some(self.bottom_pane.standard_popup_hint_line()),
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
                    "save the `{}` profile and start a new thread on it; the default in config.toml stays unchanged",
                    draft.id
                ),
                false,
                true,
            ),
            make_item(
                "Make it the default and use it now".to_string(),
                "sets model_provider + model at the top of config.toml, then starts a new thread"
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
            footer_hint: Some(self.bottom_pane.standard_popup_hint_line()),
            items,
            ..Default::default()
        });
        self.request_redraw();
    }
}
