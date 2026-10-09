//! Request routing for the client wire: resolves the provider of a call by
//! binding or by capability, applies capability degradation, and decodes or
//! projects the neutral operations of providers without the `codex.native`
//! surface.
//!
//! Error contract: unknown thread → `-32600 "thread not found: <id>"`;
//! disabled provider → `-32070 "<Provider> provider is disabled on this
//! host"`; missing capability → `-32072 "<capability> is not supported by
//! this thread's agent"` with `data {capability, provider}`. Transport
//! failures keep the established codes (`-32003` reconnecting, `-32004`
//! backpressure, `-32020` protocol).

use std::sync::Arc;

use rand::Rng;
use serde_json::{Value, json};
use tracing::warn;

use super::{PROVIDER_FIELD, WireProvider, request_ids, results, settings};
use crate::agent::{
    bindings::{BindOutcome, BindingOrigin, BindingStore, ThreadRoute},
    model::{
        AppThreadId, Capability, ERROR_CAPABILITY_UNSUPPORTED, ERROR_INVALID_PARAMS,
        ERROR_INVALID_REQUEST, ERROR_PROVIDER_DISABLED, ProviderId, RuntimeRequestId,
        ThreadCreateParams, ThreadSettings, capability_unsupported_message,
        thread_not_found_message,
    },
    provider::{AgentProvider, NativeSurface, ProviderError},
    registry::{ProviderRegistry, disabled_provider_name},
};

/// A JSON-RPC error answer for the client.
#[derive(Clone, Debug, PartialEq)]
pub struct RpcFailure {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcFailure {
    #[must_use]
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Maps a provider failure with the established transport codes.
    #[must_use]
    pub fn from_provider(error: &ProviderError) -> Self {
        match error {
            ProviderError::Rejected(rejected) => Self {
                code: rejected.code,
                message: rejected.message.clone(),
                data: rejected
                    .data
                    .as_ref()
                    .and_then(|data| serde_json::to_value(data).ok()),
            },
            ProviderError::Backpressure(message) => Self::new(-32_004, message.clone()),
            ProviderError::Reconnecting(message) | ProviderError::Disconnected(message) => {
                Self::new(-32_003, message.clone())
            }
            ProviderError::Protocol(message) => Self::new(-32_020, message.clone()),
        }
    }

    #[must_use]
    pub fn thread_not_found(thread_id: &str) -> Self {
        Self::new(ERROR_INVALID_REQUEST, thread_not_found_message(thread_id))
    }

    #[must_use]
    pub fn provider_disabled(provider: &ProviderId) -> Self {
        Self::new(
            ERROR_PROVIDER_DISABLED,
            format!(
                "{} provider is disabled on this host",
                disabled_provider_name(provider)
            ),
        )
    }

    #[must_use]
    pub fn capability_unsupported(capability: Capability, provider: &ProviderId) -> Self {
        Self {
            code: ERROR_CAPABILITY_UNSUPPORTED,
            message: capability_unsupported_message(capability.name()),
            data: Some(json!({"capability": capability.name(), "provider": provider.as_str()})),
        }
    }

    /// The JSON-RPC `error` object.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let mut error = json!({"code": self.code, "message": self.message});
        if let Some(data) = &self.data {
            error["data"] = data.clone();
        }
        error
    }
}

/// The resolved provider of a thread-scoped call.
#[derive(Clone)]
pub struct Target {
    pub provider: Arc<dyn AgentProvider>,
    pub wire: WireProvider,
    pub thread_id: AppThreadId,
    /// Discovered without a binding; confirmed after the provider accepts.
    pub provisional: bool,
}

impl Target {
    /// The `codex.native` surface, when the provider declares it.
    #[must_use]
    pub fn native(&self) -> Option<&dyn NativeSurface> {
        self.provider.native_surface()
    }
}

/// How `thread/start` is served.
pub enum ThreadStartRoute {
    /// Unchanged native request (the provider field stripped).
    Native {
        provider: Arc<dyn AgentProvider>,
        wire: WireProvider,
        request_params: Value,
    },
    /// Neutral `thread.create` on a provider without the native surface.
    Neutral {
        provider: Arc<dyn AgentProvider>,
        wire: WireProvider,
    },
}

/// The routing owner shared by the sync hub and its services.
pub struct ClientWireGateway {
    registry: Arc<ProviderRegistry>,
    bindings: Arc<BindingStore>,
}

impl ClientWireGateway {
    #[must_use]
    pub fn new(registry: Arc<ProviderRegistry>, bindings: Arc<BindingStore>) -> Self {
        Self { registry, bindings }
    }

    #[must_use]
    pub fn registry(&self) -> &Arc<ProviderRegistry> {
        &self.registry
    }

    #[must_use]
    pub fn bindings(&self) -> &Arc<BindingStore> {
        &self.bindings
    }

    /// Projection context of one provider.
    #[must_use]
    pub fn wire(&self, provider: &Arc<dyn AgentProvider>) -> WireProvider {
        WireProvider {
            descriptor: provider.descriptor(),
            capabilities: provider.capabilities(),
            primary_id: self.registry.primary_id().clone(),
            multi_provider: self.registry.is_multi_provider(),
        }
    }

    #[must_use]
    pub fn primary(&self) -> (Arc<dyn AgentProvider>, WireProvider) {
        let provider = self.registry.primary().clone();
        let wire = self.wire(&provider);
        (provider, wire)
    }

    /// Every enabled provider except the primary, with its projection context.
    #[must_use]
    pub fn non_primary(&self) -> Vec<(Arc<dyn AgentProvider>, WireProvider)> {
        self.registry
            .enabled()
            .skip(1)
            .map(|provider| (provider.clone(), self.wire(provider)))
            .collect()
    }

    /// The first provider declaring a host capability.
    #[must_use]
    pub fn owner(&self, capability: Capability) -> Option<(Arc<dyn AgentProvider>, WireProvider)> {
        self.registry
            .owner(capability)
            .map(|provider| (provider.clone(), self.wire(provider)))
    }

    /// Resolves a thread-scoped call and checks `requires`.
    ///
    /// # Errors
    /// Returns the client-facing failure for an unknown thread, a disabled
    /// provider or a missing capability.
    pub async fn resolve_thread(
        &self,
        thread_id: &str,
        requires: Option<Capability>,
    ) -> Result<Target, RpcFailure> {
        let Some(app_thread_id) = AppThreadId::parse(thread_id) else {
            return Err(RpcFailure::thread_not_found(thread_id));
        };
        let route = self
            .bindings
            .route(&self.registry, &app_thread_id)
            .await
            .map_err(|error| {
                warn!(err = ?error, "thread binding lookup failed");
                RpcFailure::new(-32_020, "Thread binding is unavailable")
            })?;
        let (provider_id, provisional) = match route {
            ThreadRoute::Bound(provider) => (provider, false),
            ThreadRoute::Provisional(provider) => (provider, true),
            ThreadRoute::Unknown => return Err(RpcFailure::thread_not_found(thread_id)),
        };
        let Some(provider) = self.registry.get(&provider_id).cloned() else {
            return Err(RpcFailure::provider_disabled(&provider_id));
        };
        if let Some(capability) = requires
            && !provider.capabilities().supports(capability)
        {
            return Err(RpcFailure::capability_unsupported(capability, &provider_id));
        }
        let wire = self.wire(&provider);
        Ok(Target {
            provider,
            wire,
            thread_id: app_thread_id,
            provisional,
        })
    }

    /// Confirms a provisional discovery after the provider accepted a call.
    pub async fn confirm(&self, target: &Target, accepted: bool) {
        if !target.provisional || !accepted {
            return;
        }
        if let Err(error) = self
            .bindings
            .bind(
                &target.thread_id,
                &target.wire.descriptor.id,
                BindingOrigin::Discovered,
            )
            .await
        {
            warn!(err = ?error, app_thread_id = %target.thread_id, "discovered thread binding write failed");
        }
    }

    /// Binds rows a provider reported (list rows, events). Conflicts are
    /// logged by the binding store and ignored.
    pub async fn observe_threads(&self, provider: &ProviderId, ids: &[String]) {
        let ids = ids
            .iter()
            .filter_map(|id| AppThreadId::parse(id))
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return;
        }
        if let Err(error) = self
            .bindings
            .bind_many(provider, &ids, BindingOrigin::Discovered)
            .await
        {
            warn!(err = ?error, provider = %provider, "thread binding observation failed");
        }
    }

    /// Removes rows of native threads that continue another app thread (a
    /// non-first binding segment) from a `thread/list` result. Without any
    /// continuation the result is untouched.
    pub fn hide_continuations(&self, result: &mut Value) {
        self.retain_rows(result, "id");
    }

    /// Removes search hits of continuation threads.
    pub fn hide_continuation_hits(&self, result: &mut Value) {
        self.retain_rows(result, "threadId");
    }

    fn retain_rows(&self, result: &mut Value, field: &str) {
        if let Some(rows) = result.get_mut("data").and_then(Value::as_array_mut) {
            rows.retain(|row| {
                row.get(field)
                    .and_then(Value::as_str)
                    .is_none_or(|id| !self.bindings.is_continuation(id))
            });
        }
    }

    /// Decodes a client-wire runtime request id.
    #[must_use]
    pub fn decode_request_id(&self, id: &Value) -> Option<RuntimeRequestId> {
        request_ids::decode(id, self.registry.primary_id())
    }

    /// Chooses the provider of `thread/start`: the requested
    /// `codewideAgentProvider`, else the primary provider (older clients).
    ///
    /// # Errors
    /// Returns `-32070` for a disabled provider and `-32602` for an invalid one.
    pub fn thread_start_route(&self, params: &Value) -> Result<ThreadStartRoute, RpcFailure> {
        let requested = params.get(PROVIDER_FIELD);
        let provider = match requested {
            None | Some(Value::Null) => self.registry.primary().clone(),
            Some(Value::String(id)) => {
                let id = ProviderId::parse(id).ok_or_else(|| {
                    RpcFailure::new(ERROR_INVALID_PARAMS, "codewideAgentProvider is invalid")
                })?;
                self.registry
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| RpcFailure::provider_disabled(&id))?
            }
            Some(_) => {
                return Err(RpcFailure::new(
                    ERROR_INVALID_PARAMS,
                    "codewideAgentProvider must be a string",
                ));
            }
        };
        let wire = self.wire(&provider);
        if provider.native_surface().is_some() {
            let mut request_params = params.clone();
            if let Some(object) = request_params.as_object_mut() {
                object.remove(PROVIDER_FIELD);
            }
            return Ok(ThreadStartRoute::Native {
                provider,
                wire,
                request_params,
            });
        }
        Ok(ThreadStartRoute::Neutral { provider, wire })
    }

    /// Writes the `created` binding of a new thread before the response is
    /// sent.
    ///
    /// # Errors
    /// Returns a failure when the binding cannot be written or conflicts.
    pub async fn bind_created(
        &self,
        provider: &ProviderId,
        thread_id: &str,
    ) -> Result<(), RpcFailure> {
        let Some(id) = AppThreadId::parse(thread_id) else {
            return Err(RpcFailure::new(
                -32_020,
                "thread/start returned an invalid thread id",
            ));
        };
        match self
            .bindings
            .bind(&id, provider, BindingOrigin::Created)
            .await
        {
            Ok(BindOutcome::Bound | BindOutcome::AlreadyBound) => Ok(()),
            Ok(BindOutcome::Conflict { .. } | BindOutcome::Continuation) => Err(RpcFailure::new(
                -32_020,
                "thread id is already bound to another provider",
            )),
            Err(error) => {
                warn!(err = ?error, "thread binding write failed");
                Err(RpcFailure::new(-32_020, "Thread binding is unavailable"))
            }
        }
    }

    /// Creates a thread on a provider without the native surface. Returns
    /// the `ThreadStartResponse` and the `thread/started` notification.
    ///
    /// # Errors
    /// Returns the provider or binding failure.
    pub async fn start_neutral_thread(
        &self,
        provider: &Arc<dyn AgentProvider>,
        wire: &WireProvider,
        params: &Value,
    ) -> Result<(Value, Value), RpcFailure> {
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .filter(|cwd| !cwd.is_empty())
            .ok_or_else(|| RpcFailure::new(ERROR_INVALID_PARAMS, "thread/start requires cwd"))?
            .to_owned();
        let model = match params.get("model").and_then(Value::as_str) {
            Some(model) if !model.is_empty() => model.to_owned(),
            _ => default_model(provider).await?,
        };
        let permission_profile = params
            .get("permissions")
            .and_then(Value::as_str)
            .unwrap_or(":workspace")
            .to_owned();
        let app_thread_id = provider
            .capabilities()
            .supports(Capability::ThreadsHostMintedIds)
            .then(mint_app_thread_id);
        if let Some(id) = &app_thread_id {
            self.bind_created(&wire.descriptor.id, id.as_str()).await?;
        }
        let thread = provider
            .thread_create(ThreadCreateParams {
                app_thread_id,
                cwd,
                settings: ThreadSettings {
                    model,
                    effort: params
                        .pointer("/config/model_reasoning_effort")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    permission_profile,
                    service_tier: None,
                },
            })
            .await
            .map_err(|error| RpcFailure::from_provider(&error))?;
        self.bind_created(&wire.descriptor.id, thread.app_thread_id.as_str())
            .await?;
        let projected = super::items::thread(&thread, wire, &[]);
        let response =
            settings::response_envelope(&thread, &wire.descriptor.model_provider, &projected);
        let started = json!({"method": "thread/started", "params": {"thread": projected}});
        Ok((response, started))
    }

    /// Builds the `turn/start` result for a provider without the native
    /// surface.
    #[must_use]
    pub fn turn_started_result(turn_id: &str) -> Value {
        results::turn_started(turn_id)
    }
}

async fn default_model(provider: &Arc<dyn AgentProvider>) -> Result<String, RpcFailure> {
    let catalog = provider
        .catalog_models()
        .await
        .map_err(|error| RpcFailure::from_provider(&error))?;
    catalog
        .models
        .iter()
        .find(|model| model.is_default)
        .or_else(|| catalog.models.first())
        .map(|model| model.model.clone())
        .ok_or_else(|| RpcFailure::new(ERROR_INVALID_PARAMS, "thread/start requires model"))
}

/// Mints a `UUIDv7` app thread id (48-bit unix milliseconds, version 7,
/// RFC 4122 variant, random remainder).
#[must_use]
pub fn mint_app_thread_id() -> AppThreadId {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        });
    let mut bytes: [u8; 16] = rand::rng().random();
    bytes[..6].copy_from_slice(&millis.to_be_bytes()[2..]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex::encode(bytes);
    let text = format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    );
    AppThreadId::parse(&text)
        .unwrap_or_else(|| AppThreadId::from_static("00000000-0000-7000-8000-000000000000"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn continuation_threads_leave_list_pages_and_search_hits()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::agent::{
            bindings::BindingSegment,
            model::{CapabilitySet, ProviderThreadRef, StartWhileActiveMode},
            testing::FakeProvider,
        };
        let directory = tempfile::tempdir()?;
        let store = Arc::new(crate::store::IndexStore::open(
            directory.path().join("state.redb"),
        )?);
        let bindings = Arc::new(BindingStore::new(store));
        let registry = Arc::new(ProviderRegistry::single(
            FakeProvider::new(
                "codex",
                CapabilitySet::none(StartWhileActiveMode::NativeJoin),
            )
            .into_arc(),
            Vec::new(),
        ));
        let gateway = ClientWireGateway::new(registry, bindings.clone());
        let mut page = json!({"data": [{"id": "app"}, {"id": "native-b"}, {"id": "other"}]});
        gateway.hide_continuations(&mut page);
        assert_eq!(page["data"].as_array().map(Vec::len), Some(3));

        let app = AppThreadId::from_static("app");
        let segment = |provider: &'static str, native: &'static str, first| BindingSegment {
            provider: ProviderId::from_static(provider),
            native_thread_id: ProviderThreadRef::same_as(&AppThreadId::from_static(native)),
            first_turn_ordinal: first,
            last_turn_ordinal: None,
            handoff_refs: Vec::new(),
        };
        bindings
            .replace_segments(
                &app,
                vec![segment("codex", "app", 0), segment("claude", "native-b", 3)],
                BindingOrigin::Created,
            )
            .await?;
        gateway.hide_continuations(&mut page);
        assert_eq!(page["data"], json!([{"id": "app"}, {"id": "other"}]));
        let mut hits = json!({"data": [{"threadId": "native-b"}, {"threadId": "app"}]});
        gateway.hide_continuation_hits(&mut hits);
        assert_eq!(hits["data"], json!([{"threadId": "app"}]));
        Ok(())
    }

    #[test]
    fn minted_ids_are_uuid_v7_and_distinct() {
        let first = mint_app_thread_id();
        let second = mint_app_thread_id();
        assert_ne!(first, second);
        let text = first.as_str();
        assert_eq!(text.len(), 36);
        assert_eq!(&text[14..15], "7");
        assert!(matches!(&text[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn failures_carry_the_contract_codes() {
        let provider = ProviderId::from_static("claude");
        assert_eq!(
            RpcFailure::provider_disabled(&provider).to_json(),
            json!({"code": -32070, "message": "Claude provider is disabled on this host"})
        );
        assert_eq!(
            RpcFailure::capability_unsupported(Capability::Review, &provider).to_json(),
            json!({
                "code": -32072,
                "message": "review is not supported by this thread's agent",
                "data": {"capability": "review", "provider": "claude"}
            })
        );
        assert_eq!(
            RpcFailure::thread_not_found("t").to_json(),
            json!({"code": -32600, "message": "thread not found: t"})
        );
    }
}
