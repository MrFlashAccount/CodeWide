//! The single translation between the client wire (Codex App Server
//! v0.155.1 shapes plus `CodeWide` extension fields) and the neutral
//! `codewide-agent` model.
//!
//! - `decode` classifies client requests and decodes neutral params;
//! - `items`, `events`, `results`, `settings` project neutral values;
//! - `request_ids` is the runtime request-id wire encoding owned by
//!   `agent-core` (the Codex adapter checks the same namespace);
//! - `list` and `catalog` merge `thread/list`, `model/list` and
//!   `permissionProfile/list` across providers.
//!
//! Extension fields are attached only in multi-provider mode, so a host with
//! one provider keeps today's wire byte-for-byte.

pub mod catalog;
pub mod decode;
pub mod events;
pub mod gateway;
pub mod history;
pub mod items;
pub mod list;
pub mod results;
pub mod settings;

#[cfg(test)]
mod golden_tests;

pub use agent_core::request_ids;

use serde_json::{Value, json};

use super::model::{CapabilitySet, ProviderDescriptor, ProviderId};

/// Client-wire field that carries a thread's provider and capabilities.
pub const THREAD_EXTENSION_FIELD: &str = "codewideAgent";
/// Client-wire field that names the provider of a model row or a new thread.
pub const PROVIDER_FIELD: &str = "codewideAgentProvider";
/// Client-wire field that names the providers offering a permission profile.
pub const PROFILE_PROVIDERS_FIELD: &str = "codewideAgentProviders";
/// Approval title extension read by the client approval card.
pub const APPROVAL_TITLE_FIELD: &str = "codewideApprovalTitle";

/// Everything the projector needs to know about one provider.
#[derive(Clone, Debug)]
pub struct WireProvider {
    pub descriptor: ProviderDescriptor,
    pub capabilities: CapabilitySet,
    pub primary_id: ProviderId,
    pub multi_provider: bool,
}

impl WireProvider {
    #[must_use]
    pub fn is_primary(&self) -> bool {
        self.descriptor.id == self.primary_id
    }

    /// The `Thread.codewideAgent` value.
    #[must_use]
    pub fn extension(&self) -> Value {
        json!({
            "provider": self.descriptor.id.as_str(),
            "providerName": self.descriptor.display_name,
            "primary": self.is_primary(),
            "capabilities": self.capabilities,
        })
    }

    /// Attaches `codewideAgent` to a projected `Thread` in multi-provider mode.
    pub fn attach_extension(&self, thread: &mut Value) {
        if !self.multi_provider {
            return;
        }
        if let Some(object) = thread.as_object_mut() {
            object.insert(THREAD_EXTENSION_FIELD.into(), self.extension());
        }
    }

    /// Attaches `codewideAgent` to every `Thread` inside a native
    /// notification (`thread/started`).
    pub fn attach_to_native_notification(&self, payload: &mut Value) {
        if !self.multi_provider {
            return;
        }
        if payload.get("method").and_then(Value::as_str) == Some("thread/started")
            && let Some(thread) = payload.pointer_mut("/params/thread")
        {
            self.attach_extension(thread);
        }
    }

    /// Attaches `codewideAgent` to every `Thread` inside a native RPC
    /// result: `result.thread` and `result.data[]` of `thread/list`.
    pub fn attach_to_native_result(&self, method: &str, result: &mut Value) {
        if !self.multi_provider {
            return;
        }
        if let Some(thread) = result.get_mut("thread") {
            self.attach_extension(thread);
        }
        if matches!(method, "thread/list" | "companion/supervisor/threadList")
            && let Some(rows) = result.get_mut("data").and_then(Value::as_array_mut)
        {
            for row in rows {
                self.attach_extension(row);
            }
        }
    }
}
