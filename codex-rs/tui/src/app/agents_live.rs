//! hcodex: live "sub-agents" block rendered under the `Working` status row of the
//! displayed thread. Built from the per-thread event buffers the TUI already keeps
//! for every sub-agent (see `thread_events.rs`), so it costs no extra requests.
//!
//! Each running agent gets two lines: `● name  model  elapsed  current tool` and the
//! agent's latest message or activity. Finished agents collapse to one `✓` line and
//! disappear once nothing is running any more.

use super::App;
use super::agent_status_feed::activity_summary;
use super::thread_events::ThreadBufferedEvent;
use super::thread_events::ThreadEventStore;
use crate::style::accent_color;
use crate::text_formatting::truncate_text;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ThreadItemPayload;
use codex_protocol::ThreadId;
use ratatui::style::Stylize;
use ratatui::text::Line;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

const MAX_DONE_ROWS: usize = 3;
const TEXT_GRAPHEMES: usize = 160;

/// First time each agent was seen running, for the elapsed column. Kept outside
/// `App` so the harness adds no field to the upstream struct.
static STARTED_AT: Mutex<Option<HashMap<ThreadId, Instant>>> = Mutex::new(None);
/// When each agent was last seen going idle, for the picker's "done N ago" column.
static STOPPED_AT: Mutex<Option<HashMap<ThreadId, Instant>>> = Mutex::new(None);

#[derive(Default)]
pub(super) struct AgentGlance {
    pub(super) model: Option<String>,
    /// A command that started but has not completed yet.
    pub(super) running_tool: Option<String>,
    /// Latest activity (message, reasoning, command, file change).
    pub(super) last_activity: Option<String>,
}

/// Start/stop instants recorded by the live block, if it has seen the agent run.
pub(super) fn agent_timing(thread_id: ThreadId) -> (Option<Instant>, Option<Instant>) {
    let started = STARTED_AT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|map| map.get(&thread_id).copied());
    let stopped = STOPPED_AT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|map| map.get(&thread_id).copied());
    (started, stopped)
}

pub(super) fn glance(store: &ThreadEventStore) -> AgentGlance {
    let mut out = AgentGlance {
        model: store
            .session
            .as_ref()
            .map(|session| session.model.clone())
            .filter(|model| !model.is_empty()),
        ..Default::default()
    };
    let mut completed_ids: Vec<String> = Vec::new();
    for event in store.buffer.iter().rev() {
        let ThreadBufferedEvent::Notification(notification) = event else {
            continue;
        };
        let (item, started) = match notification.as_ref() {
            ServerNotification::ItemCompleted(event) => (&event.item, false),
            ServerNotification::ItemStarted(event) => (&event.item, true),
            _ => continue,
        };
        let id = item.id().to_string();
        if !started {
            completed_ids.push(id);
        } else if out.running_tool.is_none()
            && !completed_ids.contains(&id)
            && let ThreadItemPayload::CommandExecution { command, .. } = &item.payload
        {
            out.running_tool = Some(truncate_text(command, TEXT_GRAPHEMES));
        }
        if out.last_activity.is_none()
            && !started
            && let Some(summary) = activity_summary(&item.payload)
        {
            out.last_activity = Some(summary);
        }
        if out.last_activity.is_some() && out.running_tool.is_some() {
            break;
        }
    }
    out
}

pub(super) fn elapsed_label(since: Instant) -> String {
    let secs = since.elapsed().as_secs();
    if secs >= 3600 {
        format!("{}h {:02}m", secs / 3600, (secs % 3600) / 60)
    } else {
        format!("{}m {:02}s", secs / 60, secs % 60)
    }
}

/// Coarse "N ago" label for finished agents.
pub(super) fn ago_label(since: Instant) -> String {
    let secs = since.elapsed().as_secs();
    if secs < 60 {
        "just now".to_string()
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else {
        format!("{}h {:02}m ago", secs / 3600, (secs % 3600) / 60)
    }
}

/// Model/activity snapshot of a sub-agent thread for the picker, if its events are buffered.
pub(super) fn glance_thread(app: &App, thread_id: ThreadId) -> AgentGlance {
    app.thread_event_channels
        .get(&thread_id)
        .and_then(|channel| channel.store.try_lock().ok().map(|store| glance(&store)))
        .unwrap_or_default()
}

impl App {
    /// Recompute the block and hand it to the displayed chat widget. Cheap enough to
    /// run on every sub-agent item/turn notification.
    pub(super) fn refresh_agents_live_block(&mut self) {
        let primary = self.primary_thread_id;
        let threads = self
            .agent_navigation
            .ordered_path_backed_subagent_threads(primary);
        let mut started_guard = STARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
        let started = started_guard.get_or_insert_with(HashMap::new);
        let mut stopped_guard = STOPPED_AT.lock().unwrap_or_else(|e| e.into_inner());
        let stopped = stopped_guard.get_or_insert_with(HashMap::new);

        let mut running_rows: Vec<Line<'static>> = Vec::new();
        let mut done_rows: Vec<Line<'static>> = Vec::new();
        for (thread_id, entry) in threads {
            if entry.is_closed {
                started.remove(&thread_id);
                stopped.remove(&thread_id);
                continue;
            }
            let name = entry
                .agent_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .trim_start_matches("/root/")
                .to_string();
            let glance = self
                .thread_event_channels
                .get(&thread_id)
                .and_then(|channel| channel.store.try_lock().ok().map(|store| glance(&store)))
                .unwrap_or_default();
            if entry.is_running {
                stopped.remove(&thread_id);
                let since = *started.entry(thread_id).or_insert_with(Instant::now);
                let mut head: Vec<ratatui::text::Span<'static>> =
                    vec!["  ● ".green(), format!("{name:<10}").fg(accent_color())];
                if let Some(model) = &glance.model {
                    head.push(format!(" {model}").dim());
                }
                head.push(format!("  {}", elapsed_label(since)).dim());
                if let Some(tool) = &glance.running_tool {
                    head.push(format!("  $ {tool}").into());
                }
                running_rows.push(Line::from(head));
                if let Some(text) = &glance.last_activity {
                    running_rows.push(Line::from(vec![
                        "    ".into(),
                        truncate_text(text, TEXT_GRAPHEMES).dim().italic(),
                    ]));
                }
            } else if started.contains_key(&thread_id) {
                stopped.entry(thread_id).or_insert_with(Instant::now);
                if done_rows.len() >= MAX_DONE_ROWS {
                    continue;
                }
                let mut row: Vec<ratatui::text::Span<'static>> =
                    vec!["  ✓ ".dim(), format!("{name:<10}").dim()];
                if let Some(text) = &glance.last_activity {
                    row.push(format!("  {}", truncate_text(text, TEXT_GRAPHEMES)).dim());
                }
                done_rows.push(Line::from(row));
            }
        }
        let lines = if running_rows.is_empty() {
            // Nothing running: drop the block (and forget start times) so a finished
            // batch does not linger under the next unrelated turn.
            started.clear();
            Vec::new()
        } else {
            let mut lines = Vec::with_capacity(running_rows.len() + done_rows.len() + 1);
            lines.push(Line::from(vec![
                "  sub-agents".dim(),
                " · ⌥→ open · /subagents details".dim(),
            ]));
            lines.extend(running_rows);
            lines.extend(done_rows);
            lines
        };
        drop(stopped_guard);
        drop(started_guard);
        self.chat_widget.set_agents_live_block(lines);
    }

    /// Only these notifications can change what the block shows.
    pub(super) fn notification_affects_agents_live_block(
        notification: &ServerNotification,
    ) -> bool {
        matches!(
            notification,
            ServerNotification::ItemStarted(_)
                | ServerNotification::ItemCompleted(_)
                | ServerNotification::TurnStarted(_)
                | ServerNotification::TurnCompleted(_)
                | ServerNotification::ThreadClosed(_)
                | ServerNotification::ThreadStatusChanged(_)
        )
    }
}
