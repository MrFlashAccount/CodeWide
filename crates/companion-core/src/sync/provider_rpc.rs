//! Provider-routed RPC handling for the sync hub.
//!
//! Native (`codex.native`) providers keep the byte-identical pass-through
//! pipeline: request → activity enrichment → list visibility filter → list preview
//! enrichment → pins → observers → content projection. Providers without
//! the native surface are answered from neutral operations projected by
//! `agent::client_wire`. Merged calls (`thread/list`, `model/list`,
//! `permissionProfile/list`) take the primary provider's page and add the
//! other providers' rows only in multi-provider mode.

use std::sync::Arc;

use serde_json::{Value, json};
use tracing::{info, warn};

use super::{
    MergedMethod, SessionSocket, SyncHub, rpc_is_known_read, send_json, send_rpc_error,
    send_rpc_failure,
};
use crate::{
    agent::{
        client_wire::{
            WireProvider, catalog, decode,
            gateway::{ClientWireGateway, RpcFailure, Target, ThreadStartRoute},
            list, results,
        },
        model::{Capability, CapabilityInvokeParams, RequestRespondParams},
        provider::{
            AgentProvider, DispatchError, NativeSurface, NativeThreadResources, NativeThreadStore,
            ProviderError, ProviderStatus,
        },
    },
    content::ContentProjector,
    projects::ProjectService,
    store::IndexStore,
};

/// Services that observe or enrich RPC results, plus the projection
/// context of the provider that answered.
pub(super) struct RpcResultObservers {
    /// Thread-shell visibility of the `codex.native` owner's stored threads.
    pub(super) thread_store: Option<Arc<dyn NativeThreadStore>>,
    /// Companion pin state, attached to threads of every provider.
    pub(super) pins: Arc<IndexStore>,
    pub(super) resources: Option<Arc<dyn NativeThreadResources>>,
    pub(super) projects: Option<Arc<ProjectService>>,
    pub(super) wire: WireProvider,
}

fn transport_code(error: &ProviderError) -> i64 {
    match error {
        ProviderError::Backpressure(_) => -32_004,
        ProviderError::Reconnecting(_) | ProviderError::Disconnected(_) => -32_003,
        ProviderError::Protocol(_) | ProviderError::Rejected(_) => -32_020,
    }
}

/// Forwards one native request through the pass-through pipeline.
pub(super) async fn forward_rpc(
    hub: &SyncHub,
    native: &dyn NativeSurface,
    socket: &SessionSocket,
    request: Value,
    id: Value,
    method: &str,
    wire: &WireProvider,
) -> Result<Option<bool>, ()> {
    let activity_read = activity_read_scope(method, &request);
    match native.request(request).await {
        Ok(mut response) => {
            if let Some(thread_store) = native.thread_store() {
                enrich_activity_response(thread_store.as_ref(), activity_read, &mut response).await;
            }
            let accepted = response.get("error").is_none();
            forward_rpc_response(
                socket,
                response,
                id,
                method,
                hub.projector(),
                hub.observers(wire),
            )
            .await?;
            Ok(Some(accepted))
        }
        Err(error) => {
            send_rpc_error(socket, id, transport_code(&error), &error.to_string()).await?;
            Ok(None)
        }
    }
}

struct ActivityReadScope {
    thread_id: String,
    turn_id: Option<String>,
}

fn activity_read_scope(method: &str, request: &Value) -> Option<ActivityReadScope> {
    if method != "thread/items/list"
        && !(method == "thread/turns/list"
            && request.pointer("/params/itemsView").and_then(Value::as_str) == Some("full"))
    {
        return None;
    }
    Some(ActivityReadScope {
        thread_id: request.pointer("/params/threadId")?.as_str()?.to_owned(),
        turn_id: request
            .pointer("/params/turnId")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

async fn enrich_activity_response(
    thread_store: &dyn NativeThreadStore,
    scope: Option<ActivityReadScope>,
    response: &mut Value,
) {
    let Some(scope) = scope else {
        return;
    };
    let Some(entries) = response
        .pointer_mut("/result/data")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let ids = match &scope.turn_id {
        Some(id) => vec![id.clone()],
        None => entries
            .iter()
            .filter_map(|t| t.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect(),
    };
    let Ok(metadata) = thread_store.activity_metadata(scope.thread_id, ids).await else {
        warn!("Canonical activity pricing unavailable");
        return;
    };
    if let Some(id) = scope.turn_id {
        if let Some(metrics) = metadata.get(&id).and_then(|m| m.get("activityMetrics")) {
            for entry in entries {
                if let Some(item) = entry.get_mut("item") {
                    crate::activity_metrics::attach_item_metrics(item, metrics);
                }
            }
        }
    } else {
        for turn in entries {
            let usage = turn
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| metadata.get(id))
                .and_then(|m| m.get("usage"));
            if let Some(usage) = usage.cloned()
                && let Some(object) = turn.as_object_mut()
                && let Some(metadata) = object
                    .entry("codewide")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
            {
                metadata.insert("usage".into(), usage);
            }
        }
    }
}

/// Sends an RPC response after the shared result pipeline. The provider's
/// `codewideAgent` extension is attached to native `Thread` results in
/// multi-provider mode.
pub(super) async fn forward_rpc_response(
    socket: &SessionSocket,
    mut response: Value,
    id: Value,
    method: &str,
    projector: Option<Arc<ContentProjector>>,
    observers: RpcResultObservers,
) -> Result<(), ()> {
    if !rpc_is_known_read(method)
        && let Some(error) = response.get("error")
    {
        let code = error.get("code").and_then(Value::as_i64);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("upstream rejected the mutation");
        warn!(
            rpc_method = method,
            rpc_code = code,
            rpc_error = message,
            "App Server mutation rejected"
        );
    }
    if let Some(thread) = response.pointer_mut("/result/thread")
        && let Some(thread_store) = &observers.thread_store
    {
        thread_store.annotate_thread(thread);
    }
    if observers
        .wire
        .capabilities
        .supports(Capability::CodexNative)
        && let Some(result) = response.get_mut("result")
    {
        observers.wire.attach_to_native_result(method, result);
    }
    if let Some(result) = response.get_mut("result")
        && let Err(error) = crate::thread_pins::annotate_result(&observers.pins, method, result)
    {
        warn!(err = ?error, "thread pin projection failed");
        return send_rpc_error(socket, id, -32020, "Thread pin projection unavailable").await;
    }
    if let (Some(projects), Some(result)) = (observers.projects, response.get("result")) {
        projects.observe_rpc_result(method, result).await;
    }
    if let (Some(resources), Some(result)) = (observers.resources, response.get("result")) {
        resources.observe_rpc_result(method, result).await;
    }
    if let (Some(projector), Some(result)) = (projector, response.get_mut("result")) {
        *result = projector.project_rpc_result(method, result.take());
    }
    if let Some(object) = response.as_object_mut() {
        object.insert("id".into(), id);
    }
    send_json(socket, &json!({ "type": "rpc", "response": response }))
        .await
        .map_err(|_| ())
}

/// Delivers a client answer to a runtime request to the provider that asked.
pub(super) async fn deliver_server_response(
    gateway: &ClientWireGateway,
    request_method: &str,
    request_thread_id: Option<&str>,
    response: Value,
) -> Result<(), ProviderError> {
    let id = response.get("id").cloned().unwrap_or(Value::Null);
    let decoded = gateway
        .decode_request_id(&id)
        .ok_or_else(|| ProviderError::Protocol("unknown runtime request id".into()))?;
    let provider = gateway
        .registry()
        .get(&decoded.provider)
        .cloned()
        .ok_or_else(|| {
            ProviderError::Reconnecting(format!(
                "{} provider is disabled on this host",
                decoded.provider
            ))
        })?;
    if let Some(native) = provider.native_surface() {
        return native.respond(response).await;
    }
    let thread_id = request_thread_id
        .and_then(crate::agent::model::AppThreadId::parse)
        .ok_or_else(|| ProviderError::Protocol("runtime request has no thread".into()))?;
    provider
        .request_respond(RequestRespondParams {
            app_thread_id: thread_id,
            request_id: decoded.native_id,
            response: decode::runtime_response(request_method, &response),
        })
        .await
}

/// Sends a queued steer to the thread's provider; the result is a JSON-RPC
/// response object (`result` or `error`).
pub(super) async fn send_steer(
    gateway: &ClientWireGateway,
    request: Value,
) -> Result<Value, ProviderError> {
    let thread_id = request
        .pointer("/params/threadId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let request_id = request.get("id").cloned().unwrap_or(Value::Null);
    let target = match gateway
        .resolve_thread(&thread_id, Some(Capability::TurnsSteer))
        .await
    {
        Ok(target) => target,
        Err(failure) => return Ok(json!({"id": request_id, "error": failure.to_json()})),
    };
    if let Some(native) = target.native() {
        return native.request(request).await;
    }
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    Ok(
        match results::execute(&target, "turn/steer", &params).await {
            Ok(result) => json!({"id": request_id, "result": result}),
            Err(failure) if failure.code == -32_003 || failure.code == -32_004 => {
                return Err(ProviderError::Reconnecting(failure.message));
            }
            Err(failure) => json!({"id": request_id, "error": failure.to_json()}),
        },
    )
}

/// `thread/start`: native pass-through or neutral creation, with the
/// `created` binding written before the response is sent.
pub(super) async fn handle_thread_start(
    hub: &SyncHub,
    socket: &SessionSocket,
    mut request: Value,
    id: Value,
) -> Result<(), ()> {
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match hub.gateway.thread_start_route(&params) {
        Err(failure) => send_rpc_failure(socket, id, &failure).await,
        Ok(ThreadStartRoute::Native {
            provider,
            wire,
            request_params,
        }) => {
            let Some(native) = provider.native_surface() else {
                return send_rpc_error(socket, id, -32_020, "native surface is unavailable").await;
            };
            request["params"] = request_params;
            match native.request(request).await {
                Ok(response) => {
                    if let Some(thread_id) = response
                        .pointer("/result/thread/id")
                        .and_then(Value::as_str)
                        && let Err(failure) = hub
                            .gateway
                            .bind_created(&wire.descriptor.id, thread_id)
                            .await
                    {
                        warn!(code = failure.code, error = %failure.message, "created thread binding was not written");
                    }
                    forward_rpc_response(
                        socket,
                        response,
                        id,
                        "thread/start",
                        hub.projector(),
                        hub.observers(&wire),
                    )
                    .await
                }
                Err(error) => {
                    send_rpc_error(socket, id, transport_code(&error), &error.to_string()).await
                }
            }
        }
        Ok(ThreadStartRoute::Neutral { provider, wire }) => {
            match hub
                .gateway
                .start_neutral_thread(&provider, &wire, &params)
                .await
            {
                Ok((response, started)) => {
                    if hub.local_events.send(started).await.is_err() {
                        warn!("local replay ingestor closed after thread start");
                    }
                    forward_rpc_response(
                        socket,
                        json!({"id": "thread-start", "result": response}),
                        id,
                        "thread/start",
                        hub.projector(),
                        hub.observers(&wire),
                    )
                    .await
                }
                Err(failure) => send_rpc_failure(socket, id, &failure).await,
            }
        }
    }
}

/// A host-level call owned by the first provider declaring `owner`.
pub(super) async fn handle_host(
    hub: &SyncHub,
    socket: &SessionSocket,
    request: Value,
    id: Value,
    method: &str,
    owner: Capability,
) -> Result<(), ()> {
    let Some((provider, wire)) = hub.gateway.owner(owner) else {
        return send_rpc_error(socket, id, -32_601, "Method is not supported on this host").await;
    };
    if let Some(native) = provider.native_surface() {
        return forward_rpc(hub, native, socket, request, id, method, &wire)
            .await
            .map(|_| ());
    }
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    match provider
        .capability_invoke(CapabilityInvokeParams {
            capability: owner.name().to_owned(),
            method: method.to_owned(),
            params,
        })
        .await
    {
        Ok(result) => {
            forward_rpc_response(
                socket,
                json!({"id": "host", "result": result}),
                id,
                method,
                hub.projector(),
                hub.observers(&wire),
            )
            .await
        }
        Err(error) => send_rpc_failure(socket, id, &RpcFailure::from_provider(&error)).await,
    }
}

/// A core thread-scoped call on a provider without the native surface.
pub(super) async fn handle_neutral_thread_rpc(
    hub: &SyncHub,
    socket: &SessionSocket,
    target: &Target,
    request: Value,
    id: Value,
    method: &str,
) -> Result<(), ()> {
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match results::execute(target, method, &params).await {
        Ok(result) => {
            hub.gateway.confirm(target, true).await;
            forward_rpc_response(
                socket,
                json!({"id": "neutral", "result": result}),
                id,
                method,
                hub.projector(),
                hub.observers(&target.wire),
            )
            .await
        }
        Err(failure) => send_rpc_failure(socket, id, &failure).await,
    }
}

/// A thread-scoped call on a native provider: today's dispatch paths.
pub(super) async fn handle_native_thread_rpc(
    hub: &SyncHub,
    socket: &SessionSocket,
    target: &Target,
    request: Value,
    id: Value,
    method: &str,
) -> Result<(), ()> {
    let Some(native) = target.native() else {
        return send_rpc_error(socket, id, -32_020, "native surface is unavailable").await;
    };
    if !matches!(
        method,
        "turn/start" | "thread/settings/update" | "thread/realtime/start"
    ) {
        let accepted = forward_rpc(hub, native, socket, request, id, method, &target.wire).await?;
        hub.gateway.confirm(target, accepted == Some(true)).await;
        return Ok(());
    }
    let dispatched = match method {
        "turn/start" => native.dispatch_turn_start(request).await,
        "thread/settings/update" => native.dispatch_settings_update(request).await,
        _ => {
            let started_at = std::time::Instant::now();
            let response = native.dispatch_realtime_start(request).await;
            if let Ok(response) = &response {
                info!(
                    thread_id = %target.thread_id,
                    upstream_response_ms = u64::try_from(started_at.elapsed().as_millis())
                        .unwrap_or(u64::MAX),
                    outcome = if response.get("error").is_some() {
                        "rejected"
                    } else {
                        "accepted"
                    },
                    "global voice realtime start response received from app server"
                );
            }
            response
        }
    };
    match dispatched {
        Ok(response) => {
            hub.gateway
                .confirm(target, response.get("error").is_none())
                .await;
            forward_rpc_response(
                socket,
                response,
                id,
                method,
                hub.projector(),
                hub.observers(&target.wire),
            )
            .await
        }
        Err(error) => {
            let code = match (&error, method) {
                (_, "thread/realtime/start") => -32_020,
                (_, "turn/start") | (DispatchError::Admission(_), _) => -32_040,
                (DispatchError::Transport(error), _) => transport_code(error),
            };
            send_rpc_error(socket, id, code, &error.to_string()).await
        }
    }
}

/// `thread/list`, `companion/supervisor/threadList`, `model/list` and
/// `permissionProfile/list`.
pub(super) async fn handle_merged(
    hub: &SyncHub,
    socket: &SessionSocket,
    request: Value,
    id: Value,
    method: &str,
    merged: MergedMethod,
) -> Result<(), ()> {
    let (primary, wire) = hub.gateway.primary();
    let Some(native) = primary.native_surface() else {
        return send_rpc_error(socket, id, -32_601, "Method is not supported on this host").await;
    };
    match merged {
        MergedMethod::ThreadList | MergedMethod::SupervisorThreadList => {
            handle_thread_list(hub, socket, native, request, id, method, merged, &wire).await
        }
        MergedMethod::ModelList | MergedMethod::PermissionProfileList => {
            let first_page = request.pointer("/params/cursor").is_none_or(Value::is_null);
            let response = match native.request(request).await {
                Ok(response) => response,
                Err(error) => {
                    return send_rpc_error(socket, id, transport_code(&error), &error.to_string())
                        .await;
                }
            };
            let response = merge_catalog(hub, response, merged, &wire, first_page).await;
            forward_rpc_response(
                socket,
                response,
                id,
                method,
                hub.projector(),
                hub.observers(&wire),
            )
            .await
        }
    }
}

async fn merge_catalog(
    hub: &SyncHub,
    mut response: Value,
    merged: MergedMethod,
    primary: &WireProvider,
    first_page: bool,
) -> Value {
    if !primary.multi_provider {
        return response;
    }
    let Some(result) = response.get_mut("result") else {
        return response;
    };
    let others = live_others(&hub.gateway);
    let merged_result = if merged == MergedMethod::ModelList {
        let mut catalogs = Vec::new();
        if first_page {
            for (provider, wire) in &others {
                match provider.catalog_models().await {
                    Ok(catalog) => catalogs.push((wire.clone(), catalog.models)),
                    Err(err) => {
                        warn!(provider = %wire.descriptor.id, err = %err, "provider model catalog unavailable");
                    }
                }
            }
        }
        catalog::merge_models(result.take(), primary, &catalogs, first_page)
    } else {
        let mut catalogs = Vec::new();
        for (provider, wire) in &others {
            match provider.catalog_permission_profiles().await {
                Ok(catalog) => catalogs.push((wire.clone(), catalog.profiles)),
                Err(err) => {
                    warn!(provider = %wire.descriptor.id, err = %err, "provider permission profiles unavailable");
                }
            }
        }
        catalog::merge_permission_profiles(result.take(), primary, &catalogs)
    };
    *result = merged_result;
    response
}

fn live_others(gateway: &ClientWireGateway) -> Vec<(Arc<dyn AgentProvider>, WireProvider)> {
    gateway
        .non_primary()
        .into_iter()
        .filter(|(provider, _)| provider.status() == ProviderStatus::Live)
        .collect()
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn handle_thread_list(
    hub: &SyncHub,
    socket: &SessionSocket,
    native: &dyn NativeSurface,
    mut request: Value,
    id: Value,
    method: &str,
    merged: MergedMethod,
    wire: &WireProvider,
) -> Result<(), ()> {
    let Some(thread_store) = native.thread_store() else {
        return send_rpc_error(socket, id, -32020, "Catalog visibility unavailable").await;
    };
    let supervisor_source = if merged == MergedMethod::SupervisorThreadList {
        let Some(source) = request
            .pointer("/params/threadSource")
            .and_then(Value::as_str)
            .filter(|source| thread_store.is_supervisor_source(source))
            .map(ToOwned::to_owned)
        else {
            return send_rpc_error(
                socket,
                id,
                -32602,
                "A supervisor-owned creation source is required",
            )
            .await;
        };
        request["method"] = json!("thread/list");
        if let Some(params) = request.get_mut("params").and_then(Value::as_object_mut) {
            params.remove("threadSource");
        }
        Some(source)
    } else {
        None
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    // Only `thread/list` merges; the supervisor list is owned by the
    // providers declaring `globalSupervisor`, which the primary leads.
    let plan = list::prepare(
        &params,
        wire.multi_provider && merged == MergedMethod::ThreadList,
    );
    let mut response = match &plan.lead_params {
        Some(lead_params) => {
            request["params"] = lead_params.clone();
            match native.request(request).await {
                Ok(response) => response,
                Err(error) => {
                    return send_rpc_error(socket, id, transport_code(&error), &error.to_string())
                        .await;
                }
            }
        }
        None => {
            json!({"id": "thread-list", "result": {"data": [], "nextCursor": null, "backwardsCursor": null}})
        }
    };
    let raw_lead = (!plan.is_passthrough())
        .then(|| response.get("result").cloned())
        .flatten();
    if let Some(result) = response.get_mut("result") {
        let ids = list::lead_row_ids(result);
        hub.gateway.observe_threads(&wire.descriptor.id, &ids).await;
        match thread_store
            .filter_thread_page(result.take(), supervisor_source)
            .await
        {
            Ok(filtered) => *result = filtered,
            // The thread store logs the full cause.
            Err(_) => {
                return send_rpc_error(socket, id, -32020, "Catalog visibility unavailable").await;
            }
        }
        if merged == MergedMethod::ThreadList {
            *result = thread_store.enrich_thread_page(result.take()).await;
        }
        wire.attach_to_native_result(method, result);
        if !plan.is_passthrough() {
            let others = live_others(&hub.gateway);
            *result = list::finish(&plan, raw_lead.as_ref(), result.take(), &others).await;
            for (provider, _) in &others {
                let id = provider.descriptor().id;
                let listed = result
                    .get("data")
                    .and_then(Value::as_array)
                    .map(|rows| {
                        rows.iter()
                            .filter(|row| {
                                row.pointer("/codewideAgent/provider")
                                    .and_then(Value::as_str)
                                    == Some(id.as_str())
                            })
                            .filter_map(|row| row.get("id").and_then(Value::as_str))
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                hub.gateway.observe_threads(&id, &listed).await;
            }
        }
    }
    forward_rpc_response(
        socket,
        response,
        id,
        method,
        hub.projector(),
        RpcResultObservers {
            thread_store: hub.thread_store(Capability::CodexNative),
            pins: hub.store.clone(),
            resources: hub.thread_resources(),
            projects: hub.projects(),
            // Rows already carry their provider extension.
            wire: WireProvider {
                multi_provider: false,
                ..wire.clone()
            },
        },
    )
    .await
}

/// The pin snapshot: stored archive state for threads of native providers,
/// provider-reported archive state for the others.
pub(super) async fn thread_pin_snapshot(hub: &SyncHub) -> Result<Value, String> {
    let pinned = {
        let store = hub.store.clone();
        tokio::task::spawn_blocking(move || store.thread_pin_snapshot())
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?
    };
    let mut stored_threads = std::collections::HashSet::new();
    let mut provider_archived = Vec::new();
    for thread_id in &pinned.thread_ids {
        match hub.gateway.resolve_thread(thread_id, None).await {
            Ok(target) if target.native().is_none() => {
                if let Ok(read) = target.provider.thread_read(&target.thread_id).await
                    && read.thread.archived
                {
                    provider_archived.push(thread_id.clone());
                }
            }
            _ => {
                stored_threads.insert(thread_id.clone());
            }
        }
    }
    let mut snapshot = match hub.thread_store(Capability::CodexNative) {
        Some(thread_store) => thread_store.pin_snapshot(stored_threads).await?,
        None => json!({
            "cursor": pinned.cursor,
            "threadIds": pinned.thread_ids,
            "archivedThreadIds": [],
        }),
    };
    if let Some(archived) = snapshot
        .get_mut("archivedThreadIds")
        .and_then(Value::as_array_mut)
    {
        archived.extend(provider_archived.into_iter().map(Value::String));
    }
    Ok(snapshot)
}
