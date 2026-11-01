//! Compatibility live watch of spawned agents, driven by turn lifecycle
//! on the client wire. Waiters subscribe to a `watch` channel per agent, so
//! `codewide_wait_agent` wakes on the event that settles the turn instead of
//! polling. The tracker also holds each agent's queued messages, delivered
//! one by one when a turn ends.

use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};

use serde_json::Value;
use tokio::sync::watch;

use super::super::tools::AgentStatus;
use crate::agent::client_wire::observe::{TurnEnd, TurnFact, turn_fact};
use crate::agent::model::ProviderId;

/// One agent's turn state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ChildState {
    /// A turn is running; its id is unknown until the provider reports it.
    Running { turn_id: Option<String> },
    /// No turn is running. `turn_id` is the last turn, when there was one.
    Settled {
        end: TurnEnd,
        turn_id: Option<String>,
        final_message: Option<String>,
    },
}

impl ChildState {
    #[must_use]
    pub const fn is_running(&self) -> bool {
        matches!(self, Self::Running { .. })
    }

    #[must_use]
    pub const fn status(&self) -> AgentStatus {
        match self {
            Self::Running { .. } => AgentStatus::Running,
            Self::Settled { end, .. } => match end {
                TurnEnd::Completed => AgentStatus::Completed,
                TurnEnd::Interrupted => AgentStatus::Interrupted,
                TurnEnd::Failed => AgentStatus::Failed,
            },
        }
    }
}

/// Agent messages of the running turn: the final answer wins over the last
/// commentary.
#[derive(Default)]
struct TurnMessages {
    turn_id: String,
    final_answer: Option<String>,
    last: Option<String>,
}

struct Tracked {
    state: watch::Sender<ChildState>,
    messages: TurnMessages,
    queue: VecDeque<String>,
    ended_turns: VecDeque<String>,
}

impl Tracked {
    fn new(state: ChildState) -> Self {
        let mut ended_turns = VecDeque::new();
        if let ChildState::Settled {
            turn_id: Some(turn_id),
            ..
        } = &state
        {
            ended_turns.push_back(turn_id.clone());
        }
        Self {
            state: watch::Sender::new(state),
            messages: TurnMessages::default(),
            queue: VecDeque::new(),
            ended_turns,
        }
    }

    fn remember_ended(&mut self, turn_id: &str) {
        const MAX_ENDED_TURNS: usize = 64;
        if self.ended_turns.back().is_none_or(|known| known != turn_id) {
            self.ended_turns.push_back(turn_id.to_owned());
            if self.ended_turns.len() > MAX_ENDED_TURNS {
                self.ended_turns.pop_front();
            }
        }
    }
}

/// A queued message to deliver now that the agent's turn ended.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delivery {
    pub child: String,
    pub message: String,
}

#[derive(Default)]
pub struct ChildTracker {
    /// Durable provider owner of linked agents; foreign events are ignored.
    owners: Mutex<HashMap<String, ProviderId>>,
    tracked: Mutex<HashMap<String, Tracked>>,
}

impl ChildTracker {
    #[must_use]
    pub fn with_known(children: impl IntoIterator<Item = (String, ProviderId)>) -> Self {
        Self {
            owners: Mutex::new(children.into_iter().collect()),
            tracked: Mutex::new(HashMap::new()),
        }
    }

    fn tracked(&self) -> std::sync::MutexGuard<'_, HashMap<String, Tracked>> {
        self.tracked
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn is_known(&self, child: &str) -> bool {
        self.owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(child)
            || self.tracked().contains_key(child)
    }

    pub fn authorize(&self, child: &str, provider: ProviderId) {
        self.owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(child.to_owned(), provider);
    }

    #[must_use]
    pub fn provider_matches(&self, child: &str, provider: &ProviderId) -> bool {
        self.owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(child)
            == Some(provider)
    }

    #[must_use]
    pub fn accepts_turn(&self, child: &str, turn_id: &str) -> bool {
        self.tracked()
            .get(child)
            .is_some_and(|entry| match entry.state.borrow().clone() {
                ChildState::Running {
                    turn_id: Some(known),
                } => known == turn_id,
                // Queue release marks the next turn pending before its receipt
                // arrives. A terminal event can overtake that receipt.
                ChildState::Running { turn_id: None } => true,
                ChildState::Settled { .. } => false,
            })
    }

    /// Starts tracking a linked agent with its current state.
    pub fn register(&self, child: &str, state: ChildState) {
        let mut tracked = self.tracked();
        match tracked.get_mut(child) {
            Some(entry) => {
                if let ChildState::Settled {
                    turn_id: Some(turn_id),
                    ..
                } = &state
                {
                    entry.remember_ended(turn_id);
                }
                entry.state.send_replace(state);
            }
            None => {
                tracked.insert(child.to_owned(), Tracked::new(state));
            }
        }
    }

    /// Tracks a linked agent unless events already did.
    pub fn register_if_absent(&self, child: &str, state: ChildState) {
        self.tracked()
            .entry(child.to_owned())
            .or_insert_with(|| Tracked::new(state));
    }

    #[must_use]
    pub fn state(&self, child: &str) -> Option<ChildState> {
        self.tracked()
            .get(child)
            .map(|entry| entry.state.borrow().clone())
    }

    #[must_use]
    pub fn subscribe(&self, child: &str) -> Option<watch::Receiver<ChildState>> {
        self.tracked()
            .get(child)
            .map(|entry| entry.state.subscribe())
    }

    /// Whether a `wait_agent` currently waits on this child.
    #[must_use]
    pub fn has_waiters(&self, child: &str) -> bool {
        self.tracked()
            .get(child)
            .is_some_and(|entry| entry.state.receiver_count() > 0)
    }

    /// The linked agents whose tracked turn is running, with their provider.
    #[must_use]
    pub fn running(&self) -> Vec<(String, ProviderId)> {
        let owners = self
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        self.tracked()
            .iter()
            .filter(|(_, entry)| entry.state.borrow().is_running())
            .filter_map(|(child, _)| {
                owners
                    .get(child)
                    .map(|provider| (child.clone(), provider.clone()))
            })
            .collect()
    }

    /// Whether this process already observed the end of the agent's turn.
    #[must_use]
    pub fn has_ended(&self, child: &str, turn_id: &str) -> bool {
        self.tracked()
            .get(child)
            .is_some_and(|entry| entry.ended_turns.iter().any(|ended| ended == turn_id))
    }

    /// Settles the agent to the newest turn its provider history shows ended,
    /// when no live end arrived: the transition a live `turn/completed` would
    /// have made. `settled` is that turn's terminal state. Returns whether the
    /// tracked state changed: `false` when this turn's end was already
    /// observed, or the tracker follows another turn the history does not
    /// show ended (`ended_in_history` lists the ended turn ids it shows).
    /// `untracked` decides whether an agent this process never tracked is
    /// registered.
    pub fn settle_from_history(
        &self,
        child: &str,
        settled: ChildState,
        ended_in_history: &[&str],
        untracked: bool,
    ) -> bool {
        let ChildState::Settled {
            turn_id: Some(turn_id),
            ..
        } = &settled
        else {
            return false;
        };
        let mut tracked = self.tracked();
        let Some(entry) = tracked.get_mut(child) else {
            if untracked {
                tracked.insert(child.to_owned(), Tracked::new(settled));
            }
            return untracked;
        };
        if entry.ended_turns.iter().any(|ended| ended == turn_id) {
            return false;
        }
        let follows_ended = match &*entry.state.borrow() {
            ChildState::Running { turn_id: None } | ChildState::Settled { .. } => true,
            ChildState::Running {
                turn_id: Some(running),
            } => running == turn_id || ended_in_history.contains(&running.as_str()),
        };
        if !follows_ended {
            return false;
        }
        entry.remember_ended(turn_id);
        if entry.messages.turn_id == *turn_id {
            entry.messages = TurnMessages::default();
        }
        entry.state.send_replace(settled);
        true
    }

    /// Records the turn a start request reported, unless that turn already
    /// ended (its events can overtake the response).
    pub fn started(&self, child: &str, turn_id: &str) {
        let mut tracked = self.tracked();
        let Some(entry) = tracked.get_mut(child) else {
            return;
        };
        if entry.ended_turns.iter().any(|ended| ended == turn_id) {
            return;
        }
        entry.state.send_if_modified(|state| {
            if let ChildState::Settled {
                turn_id: Some(ended),
                ..
            } = state
                && ended == turn_id
            {
                return false;
            }
            *state = ChildState::Running {
                turn_id: Some(turn_id.to_owned()),
            };
            true
        });
    }

    /// Marks the next queued turn as pending only if the observed terminal
    /// turn is still the latest state. This prevents an older completion's
    /// asynchronous queue release from overwriting a newer terminal event.
    pub fn queued_after(&self, child: &str, ended_turn_id: &str) {
        let tracked = self.tracked();
        let Some(entry) = tracked.get(child) else {
            return;
        };
        entry.state.send_if_modified(|state| {
            if !matches!(
                state,
                ChildState::Settled {
                    turn_id: Some(turn_id),
                    ..
                } if turn_id == ended_turn_id
            ) {
                return false;
            }
            *state = ChildState::Running { turn_id: None };
            true
        });
    }

    /// Queues a message for delivery after the running turn.
    #[cfg(test)]
    pub fn enqueue(&self, child: &str, message: String) {
        if let Some(entry) = self.tracked().get_mut(child) {
            entry.queue.push_back(message);
        }
    }

    /// Drops every queued message; returns how many were dropped.
    pub fn clear_queue(&self, child: &str) -> usize {
        self.tracked().get_mut(child).map_or(0, |entry| {
            let dropped = entry.queue.len();
            entry.queue.clear();
            dropped
        })
    }

    /// Applies one client-wire payload. Returns the queued message to
    /// deliver when it ended an agent's turn.
    pub fn observe(&self, payload: &Value) -> Option<Delivery> {
        let fact = turn_fact(payload)?;
        let thread_id = match &fact {
            TurnFact::Started { thread_id, .. }
            | TurnFact::AgentMessage { thread_id, .. }
            | TurnFact::Ended { thread_id, .. } => *thread_id,
        };
        if !self.is_known(thread_id) {
            return None;
        }
        let mut tracked = self.tracked();
        let entry = tracked
            .entry(thread_id.to_owned())
            .or_insert_with(|| Tracked::new(ChildState::Running { turn_id: None }));
        match fact {
            TurnFact::Started { turn_id, .. } => {
                entry.messages = TurnMessages {
                    turn_id: turn_id.to_owned(),
                    ..TurnMessages::default()
                };
                entry.state.send_replace(ChildState::Running {
                    turn_id: Some(turn_id.to_owned()),
                });
                None
            }
            TurnFact::AgentMessage {
                turn_id,
                text,
                final_answer,
                ..
            } => {
                if entry.messages.turn_id != turn_id {
                    entry.messages = TurnMessages {
                        turn_id: turn_id.to_owned(),
                        ..TurnMessages::default()
                    };
                }
                if final_answer {
                    entry.messages.final_answer = Some(text.to_owned());
                } else {
                    entry.messages.last = Some(text.to_owned());
                }
                None
            }
            TurnFact::Ended {
                turn_id,
                end,
                error,
                ..
            } => {
                entry.remember_ended(turn_id);
                let messages = std::mem::take(&mut entry.messages);
                let final_message = (messages.turn_id == turn_id)
                    .then(|| messages.final_answer.or(messages.last))
                    .flatten()
                    .or_else(|| error.map(str::to_owned));
                entry.state.send_replace(ChildState::Settled {
                    end,
                    turn_id: Some(turn_id.to_owned()),
                    final_message,
                });
                entry.queue.pop_front().map(|message| Delivery {
                    child: thread_id.to_owned(),
                    message,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn started(turn: &str) -> Value {
        json!({"method": "turn/started", "params": {"threadId": "c", "turn": {"id": turn}}})
    }

    fn message(turn: &str, text: &str, phase: &str) -> Value {
        json!({"method": "item/completed", "params": {"threadId": "c", "turnId": turn,
            "item": {"type": "agentMessage", "id": "i", "text": text, "phase": phase}}})
    }

    fn completed(turn: &str, status: &str) -> Value {
        json!({"method": "turn/completed", "params": {"threadId": "c", "turn": {"id": turn, "status": status}}})
    }

    #[tokio::test]
    async fn a_waiter_wakes_on_the_event_that_settles_the_turn() {
        let tracker = ChildTracker::default();
        tracker.register("c", ChildState::Running { turn_id: None });
        let Some(mut receiver) = tracker.subscribe("c") else {
            return;
        };
        let waiter = tokio::spawn(async move {
            receiver
                .wait_for(|state| !state.is_running())
                .await
                .map(|state| state.clone())
                .ok()
        });
        assert_eq!(tracker.observe(&started("u")), None);
        tracker.observe(&message("u", "thinking", "commentary"));
        tracker.observe(&message("u", "the answer", "final_answer"));
        tracker.observe(&message("u", "postscript", "commentary"));
        tracker.observe(&completed("u", "completed"));
        assert_eq!(
            waiter.await.ok().flatten(),
            Some(ChildState::Settled {
                end: TurnEnd::Completed,
                turn_id: Some("u".into()),
                final_message: Some("the answer".into()),
            })
        );
    }

    #[test]
    fn unlinked_threads_are_ignored_and_known_ones_are_tracked_lazily() {
        let tracker =
            ChildTracker::with_known([("c".to_owned(), ProviderId::from_static("provider"))]);
        tracker.observe(&json!({"method": "turn/started", "params": {"threadId": "other", "turn": {"id": "u"}}}));
        assert_eq!(tracker.state("other"), None);
        tracker.observe(&completed("u", "interrupted"));
        assert_eq!(
            tracker.state("c").map(|state| state.status()),
            Some(AgentStatus::Interrupted)
        );
    }

    #[test]
    fn a_turn_end_releases_one_queued_message_and_a_late_start_response_is_ignored() {
        let tracker = ChildTracker::default();
        tracker.register("c", ChildState::Running { turn_id: None });
        tracker.enqueue("c", "first".into());
        tracker.enqueue("c", "second".into());
        tracker.observe(&started("u"));
        let delivery = tracker.observe(&completed("u", "completed"));
        assert_eq!(
            delivery,
            Some(Delivery {
                child: "c".into(),
                message: "first".into()
            })
        );
        tracker.started("c", "u");
        assert_eq!(
            tracker.state("c").map(|state| state.is_running()),
            Some(false)
        );
        assert_eq!(tracker.clear_queue("c"), 1);
    }
}
