//! Original transcript locations; no session process or model call is started.

use std::path::PathBuf;

use agent_core::{model::AppThreadId, provider::ProviderError};

use super::{
    errors::{internal, not_found},
    service::{Listed, ThreadService},
};
use crate::{native::files, subagents};

impl ThreadService {
    pub(crate) async fn history_files(
        &self,
        thread: &AppThreadId,
    ) -> Result<Vec<PathBuf>, ProviderError> {
        let child = subagents::parse_child_thread_id(thread);
        let parent = child.as_ref().map_or(thread, |(parent, _)| parent);
        let agent_id = child.as_ref().map(|(_, id)| (*id).to_owned());
        let sessions = match self.inner.resolve(parent.as_str()).await?.listed() {
            Some(Listed::Entry(handle)) => handle
                .state()
                .session_ids
                .iter()
                .map(ToOwned::to_owned)
                .collect(),
            Some(Listed::Discovered(session)) => vec![session.session_id],
            None => return Err(not_found(thread.as_str())),
        };
        let root = self.inner.projects_root.clone();
        tokio::task::spawn_blocking(move || {
            let mut paths = Vec::new();
            for id in sessions {
                let Some(session) = files::find_session(&root, &id) else {
                    continue;
                };
                if let Some(id) = &agent_id {
                    paths.extend(
                        files::subagents(&session)
                            .into_iter()
                            .filter(|child| &child.agent_id == id)
                            .map(|child| child.path),
                    );
                } else {
                    paths.push(session.path);
                }
            }
            paths
        })
        .await
        .map_err(|err| internal("history files", &err))
    }
}
