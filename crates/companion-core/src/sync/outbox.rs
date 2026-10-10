//! The durable outbox delivery pump.
//!
//! Each ready command is routed to its thread's provider. A provider that is
//! not live leaves the command queued. Admission (`AgentProvider::admit_turn`)
//! runs before every command, exactly where the account pool ran before.
//! Native (`codex.native`) providers keep today's `turn/start` dispatch;
//! other providers get a neutral `turn.start`, whose `busy` outcome keeps the
//! command queued as "deliver after idle" until the thread's turn completes.

use std::sync::Arc;

use serde_json::{Value, json};
use tracing::{debug, info, warn};

use super::outbox_state::{
    OwnedClaimResolution, claim_outbox_dispatch, defer_outbox, emit_queue_changed,
    fail_queued_outbox, resolve_outbox_claim, retry_delay_ms, rpc_error_message, set_outbox_state,
    turns_contain_client_message, wait_outbox,
};
use crate::{
    agent::{
        client_wire::{
            decode,
            gateway::{ClientWireGateway, RpcFailure, Target},
            results,
        },
        model::{
            ClientMessageId, ERROR_INVALID_REQUEST, ERROR_PROVIDER_DISABLED, ItemsView,
            SortDirection, ThreadTurnsParams, ThreadUpdateParams, TurnStartParams, TurnStartResult,
        },
        provider::{AdmissionError, DispatchError, ProviderError, ProviderStatus},
    },
    files::FileService,
    remote_inputs::{RemoteInputError, prepare_remote_file_inputs},
    store::{IndexStore, OutboxCommand, OutboxPresentation, OutboxState},
    thread_view::{ThreadActivity, ThreadViewService},
    workspaces::{WorkspacePhase, WorkspaceService},
};

pub(super) const OUTBOX_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);
pub(super) const OUTBOX_ACCOUNT_SWITCH_WAIT_MS: u64 = 1_000;
const OUTBOX_RECONCILE_PAGE_SIZE: u64 = 100;

/// Everything the pump reads or writes.
#[derive(Clone)]
pub(super) struct PumpContext {
    pub(super) gateway: Arc<ClientWireGateway>,
    pub(super) store: Arc<IndexStore>,
    pub(super) thread_view: ThreadViewService,
    pub(super) local_events: tokio::sync::mpsc::Sender<Value>,
    pub(super) files: Arc<std::sync::RwLock<Option<Arc<FileService>>>>,
    pub(super) workspaces: Arc<std::sync::RwLock<Option<Arc<WorkspaceService>>>>,
    /// Pending cross-provider fork handoffs, prepended to a first turn.
    pub(super) fork: Arc<crate::agent::fork::ForkService>,
}

/// Classification of a failed delivery attempt.
pub(super) enum OutboxDeliveryError {
    /// Proven not accepted; retry without consuming an attempt.
    Deferred(String),
    /// Possibly accepted; reconcile before any retry.
    Uncertain(String),
}

impl From<DispatchError> for OutboxDeliveryError {
    fn from(error: DispatchError) -> Self {
        match error {
            DispatchError::Admission(AdmissionError::Deferred(reason)) => Self::Deferred(reason),
            DispatchError::Admission(error) => Self::Uncertain(error.to_string()),
            DispatchError::Transport(error) if error.not_sent() => {
                Self::Deferred(error.to_string())
            }
            DispatchError::Transport(error) => Self::Uncertain(error.to_string()),
        }
    }
}

fn any_live(gateway: &ClientWireGateway) -> bool {
    gateway
        .registry()
        .enabled()
        .any(|provider| provider.status() == ProviderStatus::Live)
}

/// Runs until the process exits.
pub(super) async fn run_outbox_pump(context: PumpContext, wakeup: Arc<tokio::sync::Notify>) {
    let store = context.store.clone();
    let prune_store = store.clone();
    match tokio::task::spawn_blocking(move || prune_store.outbox_prune_delivered_receipts()).await {
        Ok(Ok(removed)) if removed > 0 => {
            info!(removed, "pruned delivered outbox receipts");
        }
        Ok(Ok(_)) => {}
        Ok(Err(error)) => warn!(%error, "delivered outbox receipt pruning failed"),
        Err(error) => warn!(%error, "delivered outbox receipt pruning worker failed"),
    }
    let recovery_store = store.clone();
    match tokio::task::spawn_blocking(move || {
        recovery_store.outbox_recover_legacy_account_pool_failures()
    })
    .await
    {
        Ok(Ok(thread_ids)) => {
            if !thread_ids.is_empty() {
                info!(
                    recovered_threads = thread_ids.len(),
                    "requeued commands failed by legacy account switching"
                );
            }
            for thread_id in thread_ids {
                emit_queue_changed(&store, &context.local_events, &thread_id).await;
            }
        }
        Ok(Err(error)) => warn!(%error, "legacy account-pool queue recovery failed"),
        Err(error) => warn!(%error, "legacy account-pool recovery worker failed"),
    }
    let status_changed = Arc::new(tokio::sync::Notify::new());
    for provider in context.gateway.registry().enabled() {
        let mut status = provider.subscribe_status();
        let status_changed = status_changed.clone();
        tokio::spawn(async move {
            while status.changed().await.is_ok() {
                status_changed.notify_one();
            }
        });
    }
    loop {
        if any_live(&context.gateway) {
            let store_for_read = store.clone();
            let heads =
                tokio::task::spawn_blocking(move || store_for_read.outbox_ready_heads()).await;
            match heads {
                Ok(Ok(heads)) => {
                    for command in heads {
                        reconcile_outbox_command(&context, command).await;
                    }
                }
                Ok(Err(error)) => warn!(%error, "durable outbox read failed"),
                Err(error) => warn!(%error, "durable outbox worker failed"),
            }
        }
        tokio::select! {
            () = wakeup.notified() => {}
            () = status_changed.notified() => {}
            () = tokio::time::sleep(OUTBOX_POLL_INTERVAL), if any_live(&context.gateway) => {}
        }
    }
}

/// Waits for a workspace preparation the command depends on. Returns
/// `false` when the command must not be delivered now.
async fn workspace_ready(context: &PumpContext, command: &OutboxCommand) -> bool {
    let Some(request_id) = command.workspace_request_id.as_deref() else {
        return true;
    };
    let store = &context.store;
    let local_events = &context.local_events;
    let poll_ms = u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500);
    let workspace_service = match context.workspaces.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    let Some(workspace_service) = workspace_service else {
        wait_outbox(
            store,
            local_events,
            &command.remote_thread_id,
            &command.command_id,
            OutboxState::Queued,
            None,
            poll_ms,
        )
        .await;
        return false;
    };
    match workspace_service.operation_status(request_id).await {
        Ok(Some(operation)) if operation.phase == WorkspacePhase::Ready => true,
        Ok(Some(operation)) if operation.phase == WorkspacePhase::Failed => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                operation
                    .error
                    .as_deref()
                    .or(Some("workspace preparation failed")),
            )
            .await;
            false
        }
        Ok(Some(_)) => {
            wait_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                None,
                poll_ms,
            )
            .await;
            false
        }
        Ok(None) => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                Some("workspace operation was not found"),
            )
            .await;
            false
        }
        Err(error) => {
            defer_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                &error.to_string(),
                retry_delay_ms(command.attempts),
            )
            .await;
            false
        }
    }
}

/// Resolves the command's provider; a terminal routing failure fails the
/// command once (`-32070` disabled provider, unknown thread).
async fn command_target(context: &PumpContext, command: &OutboxCommand) -> Option<Target> {
    match context
        .gateway
        .resolve_thread(&command.remote_thread_id, None)
        .await
    {
        Ok(target) => Some(target),
        Err(RpcFailure { code, message, .. })
            if code == ERROR_PROVIDER_DISABLED || code == ERROR_INVALID_REQUEST =>
        {
            set_outbox_state(
                &context.store,
                &context.local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                Some(&message),
            )
            .await;
            None
        }
        Err(failure) => {
            debug!(command_id = %command.command_id, error = %failure.message, "outbox routing will retry");
            None
        }
    }
}

async fn admit(context: &PumpContext, target: &Target, command: &OutboxCommand) -> bool {
    let store = &context.store;
    let local_events = &context.local_events;
    match target.provider.admit_turn().await {
        Ok(()) => true,
        Err(AdmissionError::Deferred(reason)) => {
            wait_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                None,
                OUTBOX_ACCOUNT_SWITCH_WAIT_MS,
            )
            .await;
            debug!(command_id = %command.command_id, %reason, "outbox is waiting for turn admission");
            false
        }
        Err(AdmissionError::Retryable(error)) => {
            warn!(command_id = %command.command_id, %error, "outbox turn admission will retry");
            defer_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Queued,
                &error,
                retry_delay_ms(command.attempts),
            )
            .await;
            false
        }
        Err(AdmissionError::Fatal(error)) => {
            set_outbox_state(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                OutboxState::Failed,
                Some(&error),
            )
            .await;
            false
        }
    }
}

async fn reconcile_outbox_command(context: &PumpContext, command: OutboxCommand) {
    if !workspace_ready(context, &command).await {
        return;
    }
    let Some(target) = command_target(context, &command).await else {
        return;
    };
    if target.provider.status() != ProviderStatus::Live {
        return;
    }
    if !admit(context, &target, &command).await {
        return;
    }
    let store = &context.store;
    let local_events = &context.local_events;
    let poll_ms = u64::try_from(OUTBOX_POLL_INTERVAL.as_millis()).unwrap_or(500);
    if command.state == OutboxState::Uncertain {
        match history_contains_client_message(&target, &command).await {
            Ok(true) => {
                set_outbox_state(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Delivered,
                    None,
                )
                .await;
            }
            Ok(false) | Err(_) => {
                // A lost response is genuinely ambiguous because
                // clientUserMessageId is projection metadata, not an
                // idempotency key. Never resend blindly. Ordinary starts use
                // the canonical summary; steers use full history because
                // intermediate user messages are absent from the summary.
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Uncertain,
                    command.last_error.as_deref(),
                    poll_ms,
                )
                .await;
            }
        }
        return;
    }
    if command.presentation == OutboxPresentation::Queue {
        match context
            .thread_view
            .activity(&command.remote_thread_id)
            .await
        {
            Ok(ThreadActivity::Active | ThreadActivity::Unavailable) => {
                // Explicit queue means "the next turn", never an implicit
                // steer into the current one. A system-error lifecycle without
                // explicit direct-input authority must also wait.
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    poll_ms,
                )
                .await;
                return;
            }
            Ok(ThreadActivity::Idle) => {}
            Err(error) => {
                debug!(command_id = %command.command_id, %error, "queued turn is waiting for authoritative lifecycle");
                wait_outbox(
                    store,
                    local_events,
                    &command.remote_thread_id,
                    &command.command_id,
                    OutboxState::Queued,
                    None,
                    poll_ms,
                )
                .await;
                return;
            }
        }
    }
    deliver_outbox_start(context, &target, command).await;
}

/// Full-history pages for a resolved steer claim, summary otherwise.
async fn history_contains_client_message(
    target: &Target,
    command: &OutboxCommand,
) -> Result<bool, String> {
    let Some(native) = target.native() else {
        let page = target
            .provider
            .thread_turns(ThreadTurnsParams {
                app_thread_id: target.thread_id.clone(),
                cursor: None,
                limit: u32::try_from(OUTBOX_RECONCILE_PAGE_SIZE).unwrap_or(100),
                sort_direction: SortDirection::Desc,
                items_view: ItemsView::Full,
            })
            .await
            .map_err(|error| error.to_string())?;
        let turns = results::turns_page(&page.turns, ItemsView::Full, None);
        let turns = turns["data"].as_array().cloned().unwrap_or_default();
        return Ok(turns_contain_client_message(&turns, &command.command_id));
    };
    if command.has_resolved_steer_claim() {
        let response = native
            .request(json!({
                "id": "outbox-steer-reconcile",
                "method": "thread/turns/list",
                "params": {
                    "threadId": command.remote_thread_id,
                    "cursor": null,
                    "limit": OUTBOX_RECONCILE_PAGE_SIZE,
                    "sortDirection": "desc",
                    "itemsView": "full"
                }
            }))
            .await
            .map_err(|error| error.to_string())?;
        if response.get("error").is_some() {
            return Err(rpc_error_message(&response));
        }
        let turns = response
            .get("result")
            .and_then(|result| result.get("data"))
            .and_then(Value::as_array)
            .ok_or_else(|| "upstream full history returned no turns page".to_string())?;
        return Ok(turns_contain_client_message(turns, &command.command_id));
    }
    let params = json!({
        "threadId": command.remote_thread_id,
        "cursor": null,
        "limit": OUTBOX_RECONCILE_PAGE_SIZE,
        "sortDirection": "desc",
        "itemsView": "summary"
    });
    let page = native
        .thread_store()
        .ok_or_else(|| "local summary history is unavailable".to_string())?
        .turns_page("thread/turns/list", &params)
        .await
        .ok_or_else(|| "local summary history is unavailable".to_string())??;
    let turns = page
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "local summary history returned no turns page".to_string())?;
    Ok(turns_contain_client_message(turns, &command.command_id))
}

#[allow(clippy::too_many_lines)]
async fn deliver_outbox_start(context: &PumpContext, target: &Target, command: OutboxCommand) {
    let store = &context.store;
    let local_events = &context.local_events;
    let file_service = match context.files.read() {
        Ok(slot) => slot.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    let mut prepared_params = match prepare_remote_file_inputs(
        &command.method,
        context.fork.inject(&command.method, command.params.clone()),
        file_service,
    )
    .await
    {
        Ok(params) => params,
        Err(RemoteInputError::FileServiceUnavailable) => {
            // The active pump is spawned before main installs optional
            // services. Keep a restored command queued across that startup
            // window instead of turning a valid attachment into a failure.
            return;
        }
        Err(error) => {
            fail_queued_outbox(
                store,
                local_events,
                &command.remote_thread_id,
                &command.command_id,
                &error.to_string(),
            )
            .await;
            return;
        }
    };
    let Some((claimed, claim_token)) =
        claim_outbox_dispatch(store, local_events, &command.command_id).await
    else {
        return;
    };
    if claimed.params != command.params {
        let refreshed_file_service = match context.files.read() {
            Ok(slot) => slot.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        prepared_params = match prepare_remote_file_inputs(
            &claimed.method,
            context.fork.inject(&claimed.method, claimed.params.clone()),
            refreshed_file_service,
        )
        .await
        {
            Ok(params) => params,
            Err(error) => {
                resolve_outbox_claim(
                    store,
                    local_events,
                    &claimed.remote_thread_id,
                    &claimed.command_id,
                    claim_token,
                    OwnedClaimResolution::Rejected(error.to_string()),
                )
                .await;
                return;
            }
        };
    }
    let resolution = match target.native() {
        Some(native) => {
            let start = json!({
                "id": "outbox-start",
                "method": claimed.method.as_str(),
                "params": prepared_params
            });
            native_resolution(native.dispatch_turn_start(start).await, &claimed)
        }
        None => neutral_resolution(target, &claimed, &prepared_params).await,
    };
    if matches!(resolution, OwnedClaimResolution::Delivered) {
        context.gateway.confirm(target, true).await;
    }
    resolve_outbox_claim(
        store,
        local_events,
        &claimed.remote_thread_id,
        &claimed.command_id,
        claim_token,
        resolution,
    )
    .await;
}

fn native_resolution(
    delivered: Result<Value, DispatchError>,
    claimed: &OutboxCommand,
) -> OwnedClaimResolution {
    match delivered.map_err(OutboxDeliveryError::from) {
        Ok(response) if response.get("error").is_some() => {
            OwnedClaimResolution::Rejected(rpc_error_message(&response))
        }
        Ok(_) => OwnedClaimResolution::Delivered,
        Err(OutboxDeliveryError::Deferred(reason)) => {
            debug!(command_id = %claimed.command_id, %reason, "turn/start waited for upstream delivery");
            OwnedClaimResolution::NotSent(OUTBOX_ACCOUNT_SWITCH_WAIT_MS)
        }
        Err(OutboxDeliveryError::Uncertain(error)) => {
            warn!(command_id = %claimed.command_id, %error, "turn/start delivery is uncertain");
            OwnedClaimResolution::Indeterminate {
                error,
                retry_after_ms: retry_delay_ms(claimed.attempts),
            }
        }
    }
}

async fn neutral_resolution(
    target: &Target,
    claimed: &OutboxCommand,
    params: &Value,
) -> OwnedClaimResolution {
    let input = match decode::user_contents(params.get("input").unwrap_or(&Value::Null)) {
        Ok(input) => input,
        Err(message) => return OwnedClaimResolution::Rejected(message),
    };
    let client_message_id =
        decode::client_message_id(params).or_else(|| ClientMessageId::parse(&claimed.command_id));
    // The composer's model, effort and access choices travel with the turn
    // (a new chat sends them only here). A neutral provider has no per-turn
    // overrides, so they become the thread's settings first; repeating the
    // update on a redelivery is a no-op.
    if let Some(change) = decode::turn_settings_overrides(params) {
        let updated = target
            .provider
            .thread_update(ThreadUpdateParams {
                app_thread_id: target.thread_id.clone(),
                change,
            })
            .await;
        match updated {
            Ok(_) => {}
            Err(ProviderError::Rejected(error)) => {
                return OwnedClaimResolution::Rejected(error.message);
            }
            Err(error) => {
                warn!(command_id = %claimed.command_id, err = %error, "turn settings update failed; the turn waits");
                return OwnedClaimResolution::NotSent(retry_delay_ms(claimed.attempts));
            }
        }
    }
    let started = target
        .provider
        .turn_start(TurnStartParams {
            app_thread_id: target.thread_id.clone(),
            client_message_id,
            input,
            client_tools: None,
        })
        .await;
    match started {
        Ok(TurnStartResult::Started { .. }) => OwnedClaimResolution::Delivered,
        Ok(TurnStartResult::Busy { active_turn_id }) => {
            debug!(command_id = %claimed.command_id, active_turn_id = %active_turn_id, "provider is busy; command waits for the turn to complete");
            OwnedClaimResolution::Busy
        }
        Err(ProviderError::Rejected(error)) => OwnedClaimResolution::Rejected(error.message),
        Err(error) if error.not_sent() => {
            OwnedClaimResolution::NotSent(OUTBOX_ACCOUNT_SWITCH_WAIT_MS)
        }
        Err(error) => {
            warn!(command_id = %claimed.command_id, err = %error, "turn.start delivery is uncertain");
            OwnedClaimResolution::Indeterminate {
                error: error.to_string(),
                retry_after_ms: retry_delay_ms(claimed.attempts),
            }
        }
    }
}

/// `clientUserMessageId` is projection metadata, not an idempotency key:
/// repeating `turn/start` would append the same prompt again. Reconcile
/// before every direct start so a retry after a lost RPC response is
/// acknowledged with the already-created turn instead of being forwarded.
pub(super) async fn reconcile_direct_turn_start(
    target: &Target,
    params: &Value,
) -> Result<Option<Value>, String> {
    let Some(client_id) = params.get("clientUserMessageId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let turns = if let Some(native) = target.native() {
        {
            let response = native
                .request(json!({
                    "id": "turn-start-reconcile",
                    "method": "thread/turns/list",
                    "params": {
                        "threadId": target.thread_id.as_str(),
                        "cursor": null,
                        "limit": 16,
                        "sortDirection": "desc",
                        "itemsView": "summary"
                    }
                }))
                .await
                .map_err(|error| format!("Could not verify prior message delivery: {error}"))?;
            if response.get("error").is_some() {
                return Err(format!(
                    "Could not verify prior message delivery: {}",
                    rpc_error_message(&response)
                ));
            }
            response
                .get("result")
                .and_then(|result| result.get("data"))
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| {
                    "Could not verify prior message delivery: invalid turns page".to_string()
                })?
        }
    } else {
        {
            let page = target
                .provider
                .thread_turns(ThreadTurnsParams {
                    app_thread_id: target.thread_id.clone(),
                    cursor: None,
                    limit: 16,
                    sort_direction: SortDirection::Desc,
                    items_view: ItemsView::Summary,
                })
                .await
                .map_err(|error| format!("Could not verify prior message delivery: {error}"))?;
            results::turns_page(&page.turns, ItemsView::Summary, None)["data"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        }
    };
    Ok(super::outbox_state::turn_with_client_message(&turns, client_id).cloned())
}
