//! Settings of a session and when they take effect.
//!
//! A permission profile change between profiles that load the same
//! settings, MCP servers and tools applies to the live query at once
//! (`set_permission_mode`), even during a turn; `:read-only` and model or
//! effort changes wait for the next turn boundary, where the idle query is
//! closed so the next turn reopens it with `resume`. A changed client tool
//! set applies when the query (re)opens: an idle query without background
//! tasks is closed before a user turn.

use agent_core::model::ThreadSettings;
use tracing::info;

use super::actor::{Internal, Session};
use crate::live::permissions::{profile_of, switches_live};

impl Session {
    /// Stores new settings; returns whether anything changed.
    pub(super) async fn update_settings(&mut self, next: ThreadSettings) -> bool {
        if !Self::settings_differ(self.state.effective_settings(), &next) {
            return false;
        }
        self.state.pending_settings = Some(next);
        self.persist();
        self.switch_permissions_live();
        if !self.apply_pending_settings_if_possible().await {
            // The client shows the chosen settings (`pending ?? settings`) at once.
            self.emit_thread_updated().await;
        }
        true
    }

    /// Makes a pending permission profile effective now when the live query
    /// can switch to it (or no query is open); other pending fields stay
    /// pending.
    fn switch_permissions_live(&mut self) {
        let Some(pending) = &self.state.pending_settings else {
            return;
        };
        if pending.permission_profile == self.state.settings.permission_profile {
            return;
        }
        let from = profile_of(&self.state.settings.permission_profile);
        let to = profile_of(&pending.permission_profile);
        if self.query.is_some() && !switches_live(from, to) {
            return;
        }
        let settings = ThreadSettings {
            permission_profile: pending.permission_profile.clone(),
            ..self.state.settings.clone()
        };
        if !Self::settings_differ(&settings, pending) {
            self.state.pending_settings = None;
        }
        self.state.settings = settings;
        self.persist();
        self.set_query_permission_mode(to.options().permission_mode);
    }

    /// Moves the open query to `mode`. A query opened without
    /// `allowDangerouslySkipPermissions` cannot enter `bypassPermissions`; it
    /// keeps its mode and every tool is allowed without a request instead.
    fn set_query_permission_mode(&self, mode: &'static str) {
        let Some(query) = &self.query else {
            return;
        };
        if mode == "bypassPermissions" && !self.query_allows_bypass {
            return;
        }
        let change = query.handle.set_permission_mode(mode);
        let generation = self.generation;
        let internal = self.internal.clone();
        tokio::spawn(async move {
            if let Err(err) = change.await {
                let _ = internal.send(Internal::ModeChangeFailed {
                    generation,
                    error: err.to_string(),
                });
            }
        });
    }

    /// Applies pending settings when no turn or background task runs;
    /// returns whether it emitted `thread.updated`.
    pub(super) async fn apply_pending_settings_if_possible(&mut self) -> bool {
        if (self.state.pending_settings.is_none() && !self.query_mode_outdated)
            || self.active.is_some()
            || self.background_tasks > 0
        {
            return false;
        }
        // The idle query keeps the old options; close it so the next turn
        // reopens with `resume`.
        self.close_query().await;
        let Some(pending) = self.state.pending_settings.take() else {
            return false;
        };
        self.state.settings = pending;
        self.persist();
        self.emit_thread_updated().await;
        true
    }

    /// Before a user turn: an idle query opened with another client tool
    /// set is closed, so the turn reopens it with the current set. With
    /// background tasks running it is kept (closing would end them).
    pub(super) async fn reopen_for_client_tools(&mut self) {
        if self.query.is_none() || self.query_tools == self.deps.client_tools.specs() {
            return;
        }
        if self.background_tasks > 0 {
            info!(
                app_thread_id = %self.app_thread_id,
                background_tasks = self.background_tasks,
                "client tools change waits for background tasks"
            );
            return;
        }
        self.close_query().await;
    }
}
