//! The first prompt of each thread's running turn, followed from the event
//! stream, so a `thread.updated` projected from the stream shows a new
//! thread's preview before Claude persisted the prompt (the host's
//! `livePrompt`). Only the turn's first item counts: a provider turn (a
//! background wake, `/compact`) has no prompt.

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, PoisonError},
};

use agent_core::model::{AgentEvent, AgentItem, AgentTurn, AppThreadId};

use crate::live::prompt::content_text;

/// The prompt of a turn whose first item is a non-empty user message.
#[must_use]
pub fn turn_prompt(turn: &AgentTurn) -> Option<String> {
    turn.items.first().and_then(first_item_prompt)
}

fn first_item_prompt(item: &AgentItem) -> Option<String> {
    match item {
        AgentItem::UserMessage { content, .. } => {
            Some(content_text(content)).filter(|text| !text.is_empty())
        }
        _ => None,
    }
}

/// A running turn: whether its first item was seen, and its prompt.
enum LiveTurn {
    AwaitingFirstItem,
    Started(Option<String>),
}

/// Running turns' prompts by thread.
#[derive(Default)]
pub struct LivePrompts {
    turns: Mutex<HashMap<AppThreadId, LiveTurn>>,
}

impl LivePrompts {
    fn turns(&self) -> MutexGuard<'_, HashMap<AppThreadId, LiveTurn>> {
        self.turns.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Follows one event of the stream.
    pub fn observe(&self, event: &AgentEvent) {
        match event {
            AgentEvent::TurnStarted {
                app_thread_id,
                turn,
            } => {
                let live = match turn.items.first() {
                    Some(item) => LiveTurn::Started(first_item_prompt(item)),
                    None => LiveTurn::AwaitingFirstItem,
                };
                self.turns().insert(app_thread_id.clone(), live);
            }
            AgentEvent::ItemStarted {
                app_thread_id,
                item,
                ..
            } => {
                if let Some(live) = self.turns().get_mut(app_thread_id)
                    && matches!(live, LiveTurn::AwaitingFirstItem)
                {
                    *live = LiveTurn::Started(first_item_prompt(item));
                }
            }
            AgentEvent::TurnCompleted { app_thread_id, .. } => {
                self.turns().remove(app_thread_id);
            }
            _ => {}
        }
    }

    /// The prompt of the thread's running turn, as the stream last showed it.
    #[must_use]
    pub fn prompt(&self, app_thread_id: &AppThreadId) -> Option<String> {
        match self.turns().get(app_thread_id) {
            Some(LiveTurn::Started(prompt)) => prompt.clone(),
            Some(LiveTurn::AwaitingFirstItem) | None => None,
        }
    }
}
