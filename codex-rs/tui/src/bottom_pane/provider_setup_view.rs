//! hcodex: `/provider` step-by-step input overlay.
//!
//! Collects provider id, base URL and (optional) API key, then hands off to the
//! app to validate via `GET {base_url}/models`. The same view is reused as a
//! single-step "type the model name" prompt when listing models fails.

use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use crossterm::event::KeyModifiers;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Clear;
use ratatui::widgets::Paragraph;
use ratatui::widgets::StatefulWidgetRef;
use ratatui::widgets::Widget;
use std::cell::RefCell;

use crate::app_event::AppEvent;
use crate::app_event::ProviderSetupDraft;
use crate::app_event_sender::AppEventSender;
use crate::render::renderable::Renderable;

use super::CancellationEvent;
use super::bottom_pane_view::BottomPaneView;
use super::popup_consts::standard_popup_hint_line;
use super::textarea::TextArea;
use super::textarea::TextAreaState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Id,
    BaseUrl,
    ApiKey,
    ModelName,
}

impl Step {
    fn label(self) -> &'static str {
        match self {
            Step::Id => "Provider id",
            Step::BaseUrl => "Base URL",
            Step::ApiKey => "API key (optional)",
            Step::ModelName => "Model name",
        }
    }

    fn help(self) -> &'static str {
        match self {
            Step::Id => {
                "short name used for `[model_providers.<id>]` and `hcodex -p <id>` (a-z, 0-9, -, _)"
            }
            Step::BaseUrl => {
                "OpenAI-compatible Responses API root, e.g. https://openrouter.ai/api/v1"
            }
            Step::ApiKey => {
                "masked while typing and stored in an owner-only credential file; leave empty if not needed"
            }
            Step::ModelName => {
                "listing models failed, so type the model id to use with this provider"
            }
        }
    }

    fn placeholder(self) -> &'static str {
        match self {
            Step::Id => "openrouter",
            Step::BaseUrl => "https://api.example.com/v1",
            Step::ApiKey => "sk-... (Enter to skip)",
            Step::ModelName => "anthropic/claude-fable-5.1",
        }
    }
}

pub(crate) struct ProviderSetupView {
    steps: Vec<Step>,
    idx: usize,
    draft: ProviderSetupDraft,
    error: Option<String>,
    app_event_tx: AppEventSender,
    textarea: TextArea,
    textarea_state: RefCell<TextAreaState>,
    complete: bool,
}

impl ProviderSetupView {
    /// Full flow: id -> base URL -> API key.
    pub(crate) fn new(app_event_tx: AppEventSender) -> Self {
        Self::with_steps(
            vec![Step::Id, Step::BaseUrl, Step::ApiKey],
            ProviderSetupDraft {
                id: String::new(),
                base_url: String::new(),
                api_key: None,
            },
            app_event_tx,
            None,
        )
    }

    /// Fallback: ask only for the model name for an already-collected draft.
    pub(crate) fn model_prompt(
        draft: ProviderSetupDraft,
        app_event_tx: AppEventSender,
        note: Option<String>,
    ) -> Self {
        Self::with_steps(vec![Step::ModelName], draft, app_event_tx, note)
    }

    fn with_steps(
        steps: Vec<Step>,
        draft: ProviderSetupDraft,
        app_event_tx: AppEventSender,
        error: Option<String>,
    ) -> Self {
        Self {
            steps,
            idx: 0,
            draft,
            error,
            app_event_tx,
            textarea: TextArea::new(),
            textarea_state: RefCell::new(TextAreaState::default()),
            complete: false,
        }
    }

    fn step(&self) -> Step {
        self.steps[self.idx]
    }

    fn submit_step(&mut self) {
        let raw = self.textarea.text().trim().to_string();
        match self.step() {
            Step::Id => {
                let id = sanitize_provider_id(&raw);
                if id.is_empty() {
                    self.error = Some("Provider id cannot be empty.".to_string());
                    return;
                }
                self.draft.id = id;
            }
            Step::BaseUrl => match normalize_base_url(&raw) {
                Some(url) => self.draft.base_url = url,
                None => {
                    self.error = Some("Base URL must start with http:// or https://.".to_string());
                    return;
                }
            },
            Step::ApiKey => {
                self.draft.api_key = (!raw.is_empty()).then_some(raw);
            }
            Step::ModelName => {
                if raw.is_empty() {
                    self.error = Some("Model name cannot be empty.".to_string());
                    return;
                }
                self.app_event_tx.send(AppEvent::ProviderModelChosen {
                    draft: self.draft.clone(),
                    model: raw,
                });
                self.complete = true;
                return;
            }
        }
        self.error = None;
        self.textarea.set_text_clearing_elements("");
        if self.idx + 1 < self.steps.len() {
            self.idx += 1;
        } else {
            self.app_event_tx.send(AppEvent::ProviderSetupSubmitted {
                draft: self.draft.clone(),
            });
            self.complete = true;
        }
    }

    fn input_height(&self, width: u16) -> u16 {
        let usable_width = width.saturating_sub(2);
        let text_height = self.textarea.desired_height(usable_width).clamp(1, 4);
        text_height.saturating_add(1).min(5)
    }

    fn intro_lines(&self, _width: u16) -> Vec<Line<'static>> {
        let step = self.step();
        let title = if self.steps.len() > 1 {
            format!(
                "Add provider — step {}/{}: {}",
                self.idx + 1,
                self.steps.len(),
                step.label()
            )
        } else {
            format!("Add provider `{}` — {}", self.draft.id, step.label())
        };
        let mut lines = vec![
            Line::from(vec![gutter(), title.bold()]),
            Line::from(vec![gutter(), step.help().dim()]),
        ];
        if self.idx > 0 || self.steps.len() == 1 {
            let mut so_far = Vec::new();
            if !self.draft.id.is_empty() {
                so_far.push(format!("id={}", self.draft.id));
            }
            if !self.draft.base_url.is_empty() {
                so_far.push(format!("base_url={}", self.draft.base_url));
            }
            if self.draft.api_key.is_some() {
                so_far.push("key=<set>".to_string());
            }
            if !so_far.is_empty() {
                lines.push(Line::from(vec![gutter(), so_far.join("  ").dim()]));
            }
        }
        if let Some(err) = &self.error {
            lines.push(Line::from(vec![gutter(), err.clone().red()]));
        }
        lines
    }
}

impl BottomPaneView for ProviderSetupView {
    fn handle_key_event(&mut self, key_event: KeyEvent) {
        match key_event {
            KeyEvent {
                code: KeyCode::Esc, ..
            } => {
                self.on_ctrl_c();
            }
            KeyEvent {
                code: KeyCode::Enter,
                modifiers: KeyModifiers::NONE,
                ..
            } => {
                self.submit_step();
            }
            other => {
                self.textarea.input(other);
            }
        }
    }

    fn on_ctrl_c(&mut self) -> CancellationEvent {
        self.complete = true;
        CancellationEvent::Handled
    }

    fn is_complete(&self) -> bool {
        self.complete
    }

    fn handle_paste(&mut self, pasted: String) -> bool {
        if pasted.is_empty() {
            return false;
        }
        // Keys/URLs are single-line; collapse whitespace so a trailing newline
        // from the clipboard does not submit or corrupt the value.
        self.textarea.insert_str(pasted.trim());
        true
    }
}

impl Renderable for ProviderSetupView {
    fn desired_height(&self, width: u16) -> u16 {
        self.intro_lines(width).len() as u16 + self.input_height(width) + 2u16
    }

    fn cursor_pos(&self, area: Rect) -> Option<(u16, u16)> {
        if area.height < 2 || area.width <= 2 {
            return None;
        }
        let intro_height = self.intro_lines(area.width).len() as u16;
        let text_area_height = self.input_height(area.width).saturating_sub(1);
        if text_area_height == 0 {
            return None;
        }
        let textarea_rect = Rect {
            x: area.x.saturating_add(2),
            y: area.y.saturating_add(intro_height).saturating_add(1),
            width: area.width.saturating_sub(2),
            height: text_area_height,
        };
        let state = *self.textarea_state.borrow();
        self.textarea.cursor_pos_with_state(textarea_rect, state)
    }

    fn render(&self, area: Rect, buf: &mut Buffer) {
        if area.height == 0 || area.width == 0 {
            return;
        }
        let intro_lines = self.intro_lines(area.width);
        let input_height = self.input_height(area.width);

        for (offset, line) in intro_lines.iter().enumerate() {
            Paragraph::new(line.clone()).render(
                Rect {
                    x: area.x,
                    y: area.y.saturating_add(offset as u16),
                    width: area.width,
                    height: 1,
                },
                buf,
            );
        }

        let input_area = Rect {
            x: area.x,
            y: area.y.saturating_add(intro_lines.len() as u16),
            width: area.width,
            height: input_height,
        };
        if input_area.width >= 2 {
            for row in 0..input_area.height {
                Paragraph::new(Line::from(vec![gutter()])).render(
                    Rect {
                        x: input_area.x,
                        y: input_area.y.saturating_add(row),
                        width: 2,
                        height: 1,
                    },
                    buf,
                );
            }
            let text_area_height = input_area.height.saturating_sub(1);
            if text_area_height > 0 {
                if input_area.width > 2 {
                    Clear.render(
                        Rect {
                            x: input_area.x.saturating_add(2),
                            y: input_area.y,
                            width: input_area.width.saturating_sub(2),
                            height: 1,
                        },
                        buf,
                    );
                }
                let textarea_rect = Rect {
                    x: input_area.x.saturating_add(2),
                    y: input_area.y.saturating_add(1),
                    width: input_area.width.saturating_sub(2),
                    height: text_area_height,
                };
                let mut state = self.textarea_state.borrow_mut();
                if self.step() == Step::ApiKey {
                    self.textarea
                        .render_ref_masked(textarea_rect, buf, &mut state, '•');
                } else {
                    StatefulWidgetRef::render_ref(
                        &(&self.textarea),
                        textarea_rect,
                        buf,
                        &mut state,
                    );
                }
                if self.textarea.text().is_empty() {
                    Paragraph::new(Line::from(self.step().placeholder().dim()))
                        .render(textarea_rect, buf);
                }
            }
        }

        let hint_blank_y = input_area.y.saturating_add(input_height);
        if hint_blank_y < area.y.saturating_add(area.height) {
            Clear.render(
                Rect {
                    x: area.x,
                    y: hint_blank_y,
                    width: area.width,
                    height: 1,
                },
                buf,
            );
        }
        let hint_y = hint_blank_y.saturating_add(1);
        if hint_y < area.y.saturating_add(area.height) {
            Paragraph::new(standard_popup_hint_line()).render(
                Rect {
                    x: area.x,
                    y: hint_y,
                    width: area.width,
                    height: 1,
                },
                buf,
            );
        }
    }
}

fn gutter() -> Span<'static> {
    "▌ ".cyan()
}

/// Lowercase and keep only `[a-z0-9_-]` so the id is a bare TOML key and a
/// safe file name for `<id>.config.toml`.
pub(crate) fn sanitize_provider_id(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Require an http(s) scheme and drop trailing slashes so `{base_url}/models`
/// and `{base_url}/responses` compose cleanly.
pub(crate) fn normalize_base_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let lower = trimmed.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        .then(|| trimmed.to_string())
        .filter(|url| url.len() > "https://".len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_id_lowercases_and_strips_junk() {
        assert_eq!(sanitize_provider_id("  My Provider! "), "my-provider");
        assert_eq!(sanitize_provider_id("open_router-2"), "open_router-2");
        assert_eq!(sanitize_provider_id("---"), "");
    }

    #[test]
    fn normalize_base_url_requires_scheme_and_trims_slash() {
        assert_eq!(
            normalize_base_url(" https://openrouter.ai/api/v1/ "),
            Some("https://openrouter.ai/api/v1".to_string())
        );
        assert_eq!(normalize_base_url("openrouter.ai/api/v1"), None);
        assert_eq!(normalize_base_url("https://"), None);
    }
}
