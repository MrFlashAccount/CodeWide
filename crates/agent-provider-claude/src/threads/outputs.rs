//! The service's ordered output: every session's outputs in the order they
//! were sent, turned into [`ServiceOutput`]s as they are taken. A
//! `ThreadUpdated` notice becomes `thread.updated` with the thread projected
//! from its published state; a released session is no longer counted as
//! this companion's; a session Claude created gets its pending title and
//! fresh metadata in the background; a change of the sessions other
//! processes hold publishes the threads whose current session it concerns.

use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Weak},
};

use agent_core::model::{AgentEvent, AppThreadId};
use tokio::sync::mpsc;

use super::service::{ServiceInner, ServiceOutput};
use crate::session::ports::SessionOutput;

/// Notices from the service's own background owners.
pub(super) enum Notice {
    /// Another process took or released these sessions.
    HeldChanged(HashSet<String>),
}

/// The ordered stream of a [`super::ThreadService`]'s outputs.
pub struct ServiceOutputs {
    service: Weak<ServiceInner>,
    sessions: mpsc::Receiver<SessionOutput>,
    notices: mpsc::UnboundedReceiver<Notice>,
    ready: VecDeque<ServiceOutput>,
}

enum Next {
    Session(SessionOutput),
    Notice(Notice),
}

impl ServiceOutputs {
    pub(super) fn new(
        service: &Arc<ServiceInner>,
        sessions: mpsc::Receiver<SessionOutput>,
        notices: mpsc::UnboundedReceiver<Notice>,
    ) -> Self {
        Self {
            service: Arc::downgrade(service),
            sessions,
            notices,
            ready: VecDeque::new(),
        }
    }

    /// The next output; `None` once the service is gone.
    pub async fn recv(&mut self) -> Option<ServiceOutput> {
        loop {
            if let Some(ready) = self.ready.pop_front() {
                return Some(ready);
            }
            let next = tokio::select! {
                biased;
                Some(output) = self.sessions.recv() => Next::Session(output),
                Some(notice) = self.notices.recv() => Next::Notice(notice),
                else => return None,
            };
            let service = self.service.upgrade()?;
            match next {
                Next::Session(output) => {
                    if let Some(output) = on_session_output(&service, output) {
                        return Some(output);
                    }
                }
                Next::Notice(Notice::HeldChanged(sessions)) => {
                    self.ready.extend(held_changed(&service, &sessions));
                }
            }
        }
    }
}

fn updated(thread: agent_core::model::AgentThread) -> ServiceOutput {
    ServiceOutput::Event(Box::new(AgentEvent::ThreadUpdated { thread }))
}

fn on_session_output(service: &Arc<ServiceInner>, output: SessionOutput) -> Option<ServiceOutput> {
    match output {
        SessionOutput::Event(event) => {
            service.live_prompts.observe(&event);
            Some(ServiceOutput::Event(event))
        }
        SessionOutput::ThreadUpdated(app_thread_id) => thread_updated(service, &app_thread_id),
        SessionOutput::Released { session_id, .. } => {
            service.open_elsewhere.released(&session_id);
            None
        }
        SessionOutput::SessionReady(app_thread_id) => {
            if let Some(handle) = service.registry.get(app_thread_id.as_str()) {
                service.session_ready(handle);
            }
            None
        }
        SessionOutput::Fence(fence) => Some(ServiceOutput::Fence(fence)),
    }
}

fn thread_updated(service: &ServiceInner, app_thread_id: &AppThreadId) -> Option<ServiceOutput> {
    let handle = service.registry.get(app_thread_id.as_str())?;
    Some(updated(service.project_published(&handle)))
}

/// The threads whose current session another process took or released.
fn held_changed(service: &ServiceInner, sessions: &HashSet<String>) -> Vec<ServiceOutput> {
    sessions
        .iter()
        .filter_map(|session_id| {
            if let Some(handle) = service.registry.owner_of(session_id) {
                let state = handle.state();
                return (!state.is_deleted() && state.current_session_id() == session_id)
                    .then(|| updated(service.project_published(&handle)));
            }
            // Only a session Claude's listing showed is a thread clients may know.
            let session = service.catalog.cached(session_id)?;
            service.project_discovered(&session).map(updated)
        })
        .collect()
}
