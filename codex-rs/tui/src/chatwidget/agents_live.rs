//! hcodex: pass the live sub-agents block (built in `app::agents_live`) to the bottom pane.
use super::ChatWidget;
use ratatui::text::Line;

impl ChatWidget {
    pub(crate) fn set_agents_live_block(&mut self, lines: Vec<Line<'static>>) {
        self.bottom_pane.set_agents_live_block(lines);
    }
}
