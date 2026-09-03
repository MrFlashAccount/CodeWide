//! WebSocket transport for the authoritative Sync V2 epoch state machine.

#![allow(clippy::too_many_lines)]

use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        Arc, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::extract::ws::WebSocket;
use rand::RngCore;
use tracing::{info, warn};

use crate::auth::{AuthorizationChange, AuthorizationContext};

use super::{
    auth_context::AuthenticatedContextKey,
    domain::SnapshotLimits,
    epoch::{ConnectionEpoch, EpochPhase, QueueError},
    ledger::{LedgerError, OperationLedger},
    protocol::{ClientFrame, ReinitializeReason, ServerFrame},
    scalar::{Id, U64},
    source::{
        CoordinatorEvent, CoordinatorReceiver, CoordinatorRecvError, ReceivedCoordinatorEvent,
        SemanticSource, SourceInvalidationReason,
    },
    wire::{close, recv_frame},
};

mod command;
mod control;
mod query;

const DEFAULT_SOURCE_DEADLINE: Duration = Duration::from_secs(15);
const DEFAULT_SEND_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct SyncV2Runtime {
    source: Arc<dyn SemanticSource>,
    ledger: OperationLedger,
    limits: SnapshotLimits,
    source_deadline: Duration,
    send_deadline: Duration,
    blocked_contexts: Arc<tokio::sync::RwLock<HashSet<AuthenticatedContextKey>>>,
    context_lifecycles:
        Arc<tokio::sync::Mutex<HashMap<AuthenticatedContextKey, Arc<ContextLifecycle>>>>,
    operation_locks: Arc<tokio::sync::Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>>,
    thread_install_locks: Arc<tokio::sync::Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>>,
    live_epoch_contexts: Arc<tokio::sync::Mutex<HashMap<Id, AuthenticatedContextKey>>>,
    #[cfg(feature = "e2e-command-fault")]
    e2e_command_fault: Arc<super::e2e_fault::E2ECommandFaultControl>,
    #[cfg(feature = "e2e-command-fault")]
    e2e_surface_fault: Arc<super::E2ESurfaceFaultControl>,
}

struct ContextLifecycle {
    dispatch: tokio::sync::RwLock<()>,
    purge: tokio::sync::Mutex<()>,
    revision: AtomicU64,
    revisions: tokio::sync::watch::Sender<u64>,
}

impl ContextLifecycle {
    fn new() -> Self {
        let (revisions, _) = tokio::sync::watch::channel(0);
        Self {
            dispatch: tokio::sync::RwLock::new(()),
            purge: tokio::sync::Mutex::new(()),
            revision: AtomicU64::new(0),
            revisions,
        }
    }
}

impl SyncV2Runtime {
    /// Creates a V2 runtime backed by a durable operation ledger.
    /// # Errors
    /// Returns a ledger error when its durable keyspace cannot be opened.
    pub fn new(
        source: Arc<dyn SemanticSource>,
        ledger_path: impl AsRef<Path>,
        companion_tls_pin_sha256: impl Into<Arc<str>>,
    ) -> Result<Self, LedgerError> {
        let companion_tls_pin_sha256 = companion_tls_pin_sha256.into();
        let ledger =
            OperationLedger::open_for_installation(ledger_path, &companion_tls_pin_sha256)?;
        ledger.start_retention_task();
        Ok(Self {
            source,
            ledger,
            limits: SnapshotLimits::default(),
            source_deadline: DEFAULT_SOURCE_DEADLINE,
            send_deadline: DEFAULT_SEND_DEADLINE,
            blocked_contexts: Arc::new(tokio::sync::RwLock::new(HashSet::new())),
            context_lifecycles: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            operation_locks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            thread_install_locks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            live_epoch_contexts: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            #[cfg(feature = "e2e-command-fault")]
            e2e_command_fault: Arc::new(super::e2e_fault::E2ECommandFaultControl::default()),
            #[cfg(feature = "e2e-command-fault")]
            e2e_surface_fault: Arc::new(super::E2ESurfaceFaultControl::default()),
        })
    }

    #[must_use]
    pub fn with_limits(mut self, limits: SnapshotLimits) -> Self {
        self.limits = limits;
        self
    }

    #[must_use]
    pub fn with_deadlines(mut self, source: Duration, send: Duration) -> Self {
        self.source_deadline = source;
        self.send_deadline = send;
        self
    }

    #[cfg(feature = "e2e-command-fault")]
    /// Arms the deterministic command fault used by the isolated E2E harness.
    ///
    /// # Errors
    ///
    /// Returns an error when another non-terminal E2E command fault is already armed.
    pub async fn arm_e2e_command_fault(
        &self,
        fault_id: String,
    ) -> Result<super::E2ECommandFaultStatus, &'static str> {
        self.e2e_command_fault.arm(fault_id).await
    }

    #[cfg(feature = "e2e-command-fault")]
    pub async fn e2e_command_fault_status(
        &self,
        fault_id: &str,
    ) -> Option<super::E2ECommandFaultStatus> {
        self.e2e_command_fault.status(fault_id).await
    }

    #[cfg(feature = "e2e-command-fault")]
    pub async fn release_e2e_command_fault(
        &self,
        fault_id: &str,
    ) -> Option<super::E2ECommandFaultStatus> {
        self.e2e_command_fault.release(fault_id).await
    }

    #[cfg(feature = "e2e-command-fault")]
    #[must_use]
    pub fn with_e2e_surface_fault_control(
        mut self,
        control: Arc<super::E2ESurfaceFaultControl>,
    ) -> Self {
        self.e2e_surface_fault = control;
        self
    }

    #[cfg(feature = "e2e-command-fault")]
    /// Arms one typed surface fault for an authenticated E2E run.
    ///
    /// # Errors
    ///
    /// Returns a stable validation or active-fault conflict code from the E2E controller.
    pub async fn arm_e2e_surface_fault(
        &self,
        fault_id: String,
        request: super::E2ESurfaceFaultRequest,
    ) -> Result<super::E2ESurfaceFaultStatus, &'static str> {
        self.e2e_surface_fault.arm(fault_id, request).await
    }

    #[cfg(feature = "e2e-command-fault")]
    pub async fn e2e_surface_fault_status(
        &self,
        fault_id: &str,
    ) -> Option<super::E2ESurfaceFaultStatus> {
        self.e2e_surface_fault.status(fault_id).await
    }

    #[cfg(feature = "e2e-command-fault")]
    pub async fn release_e2e_surface_fault(
        &self,
        fault_id: &str,
    ) -> Option<super::E2ESurfaceFaultStatus> {
        self.e2e_surface_fault.release(fault_id).await
    }

    #[cfg(feature = "e2e-command-fault")]
    pub(crate) async fn intercept_e2e_surface_fault(
        &self,
        target: super::E2ESurfaceFaultTarget,
    ) -> Option<super::E2ESurfaceFaultEffect> {
        self.e2e_surface_fault.intercept(target).await
    }

    /// Returns the current upstream generation used by generation-bound resources.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.source.generation()
    }

    /// Subscribes to upstream generation changes for generation-bound data planes.
    #[must_use]
    pub(crate) fn subscribe_generation(&self) -> tokio::sync::watch::Receiver<u64> {
        self.source.subscribe_generation()
    }

    /// Purges retained state for a revoked authenticated device context.
    #[must_use]
    pub async fn purge_device_context(&self, device_id: &str) -> bool {
        let authorization = AuthorizationContext::Session {
            device_id: device_id.to_owned(),
            scopes: Vec::new(),
            expires_at: 0,
        };
        let Ok(context) = AuthenticatedContextKey::derive(&authorization) else {
            return false;
        };
        self.purge_context(&context).await
    }

    async fn purge_context(&self, context: &AuthenticatedContextKey) -> bool {
        let lifecycle = self.context_lifecycle(context).await;
        let _purge_guard = lifecycle.purge.lock().await;
        if self.ledger.begin_context_purge(context).is_err() {
            return false;
        }
        let _dispatch_guard = lifecycle.dispatch.write().await;
        self.blocked_contexts.write().await.insert(context.clone());
        let revision = lifecycle.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = lifecycle.revisions.send(revision);
        if self.source.purge_context(context).await.is_err()
            || self.ledger.purge_context(context).is_err()
        {
            return false;
        }
        let prefix = format!("{}#", context.as_str());
        self.operation_locks
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
        if self.ledger.finish_context_purge(context).is_err() {
            return false;
        }
        self.blocked_contexts.write().await.remove(context);
        true
    }

    async fn context_lifecycle(&self, context: &AuthenticatedContextKey) -> Arc<ContextLifecycle> {
        let mut lifecycles = self.context_lifecycles.lock().await;
        lifecycles
            .entry(context.clone())
            .or_insert_with(|| Arc::new(ContextLifecycle::new()))
            .clone()
    }

    async fn context_is_current(
        &self,
        context: &AuthenticatedContextKey,
        lifecycle: &ContextLifecycle,
        revision: u64,
    ) -> bool {
        lifecycle.revision.load(Ordering::SeqCst) == revision
            && !self.blocked_contexts.read().await.contains(context)
    }

    async fn current_context_dispatch<'a>(
        &self,
        context: &AuthenticatedContextKey,
        lifecycle: &'a ContextLifecycle,
        revision: u64,
    ) -> Option<tokio::sync::RwLockReadGuard<'a, ()>> {
        let guard = lifecycle.dispatch.read().await;
        self.context_is_current(context, lifecycle, revision)
            .await
            .then_some(guard)
    }

    pub async fn serve(
        self,
        mut socket: WebSocket,
        authorization: AuthorizationContext,
        mut authorization_changes: Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    ) {
        let Ok(context) = AuthenticatedContextKey::derive(&authorization) else {
            close(&mut socket, 1008, "authenticated_context_required").await;
            return;
        };
        let lifecycle = self.context_lifecycle(&context).await;
        match self.ledger.context_purge_pending(&context) {
            Ok(true) if !self.purge_context(&context).await => {
                close(&mut socket, 1008, "authenticated_context_unavailable").await;
                return;
            }
            Err(_) => {
                close(&mut socket, 1008, "authenticated_context_unavailable").await;
                return;
            }
            Ok(_) => {}
        }
        let lifecycle_revision = lifecycle.revision.load(Ordering::SeqCst);
        let mut lifecycle_changes = lifecycle.revisions.subscribe();
        if !self
            .context_is_current(&context, &lifecycle, lifecycle_revision)
            .await
        {
            close(&mut socket, 1008, "authenticated_context_unavailable").await;
            return;
        }
        loop {
            let frame = tokio::select! {
                biased;
                () = wait_for_session_expiry(&authorization) => {
                    close(&mut socket, 1008, "session_expired").await;
                    return;
                }
                changed = lifecycle_changes.changed() => {
                    let _ = changed;
                    close(&mut socket, 1008, "authenticated_context_revoked").await;
                    return;
                }
                change = recv_authorization_change(&mut authorization_changes, authorization.device_id()) => {
                    if let Some(reason) = change {
                        let _ = self.purge_context(&context).await;
                        close(&mut socket, 1008, reason).await;
                        return;
                    }
                    continue;
                }
                frame = recv_frame(&mut socket) => frame,
            };
            let Some(frame) = frame else {
                return;
            };
            match frame {
                ClientFrame::Ping { nonce } => {
                    if self
                        .send_frame(&mut socket, &ServerFrame::Pong { nonce })
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                ClientFrame::Open { version: 2, intent } => {
                    let dispatch_guard = lifecycle.dispatch.read().await;
                    if !self
                        .context_is_current(&context, &lifecycle, lifecycle_revision)
                        .await
                    {
                        drop(dispatch_guard);
                        close(&mut socket, 1008, "authenticated_context_revoked").await;
                        return;
                    }
                    let initialization_started = Instant::now();
                    if intent.validate(self.limits).is_err() {
                        close(&mut socket, 1008, "invalid_open_intent").await;
                        return;
                    }
                    let available = tokio::time::timeout(
                        self.source_deadline,
                        self.source.wait_until_available(),
                    )
                    .await;
                    if !matches!(available, Ok(Ok(()))) {
                        let epoch_id = random_id("epoch");
                        let _ = self
                            .send_frame(
                                &mut socket,
                                &ServerFrame::Reinitialize {
                                    epoch_id,
                                    reason: ReinitializeReason::UpstreamUnavailable,
                                },
                            )
                            .await;
                        continue;
                    }
                    let generation = self.source.generation();
                    let epoch_id = random_id("epoch");
                    let mut generation_changes = self.source.subscribe_generation();
                    let thread_install_lock = self
                        .thread_install_lock(
                            generation,
                            intent
                                .current_thread
                                .as_ref()
                                .map(|current| &current.thread_id),
                        )
                        .await;
                    let thread_install_guard = match &thread_install_lock {
                        Some(lock) => Some(lock.lock().await),
                        None => None,
                    };
                    let source_events = self.source.coordinator().register(
                        epoch_id.clone(),
                        generation,
                        context.clone(),
                        intent.clone(),
                        self.limits,
                    );
                    let mut epoch = ConnectionEpoch::new_with_budget(
                        epoch_id.clone(),
                        generation,
                        intent.clone(),
                        source_events.budget(),
                    );
                    epoch.begin_initializing();
                    let installed = tokio::time::timeout(
                        self.source_deadline,
                        self.source.install_intent(
                            &epoch_id,
                            &intent,
                            &authorization,
                            &context,
                            generation,
                        ),
                    )
                    .await;
                    match installed {
                        Ok(Ok(())) => {
                            drop(thread_install_guard);
                        }
                        Ok(Err(error)) => {
                            warn!(
                                code = ?error.code,
                                "Sync V2 intent installation failed"
                            );
                            self.reinitialize(
                                &mut socket,
                                &mut epoch,
                                self.initialization_failure_reason(),
                            )
                            .await;
                            continue;
                        }
                        Err(_) => {
                            warn!("Sync V2 intent installation exceeded source deadline");
                            self.reinitialize(
                                &mut socket,
                                &mut epoch,
                                self.initialization_failure_reason(),
                            )
                            .await;
                            continue;
                        }
                    }
                    let snapshot = match tokio::time::timeout(
                        self.source_deadline,
                        self.source
                            .snapshot(&intent, &authorization, &context, generation),
                    )
                    .await
                    {
                        Ok(Ok(snapshot)) => snapshot,
                        Ok(Err(error)) => {
                            warn!(
                                code = ?error.code,
                                "Sync V2 authoritative snapshot failed"
                            );
                            self.reinitialize(
                                &mut socket,
                                &mut epoch,
                                self.initialization_failure_reason(),
                            )
                            .await;
                            continue;
                        }
                        Err(_) => {
                            warn!("Sync V2 authoritative snapshot exceeded source deadline");
                            self.reinitialize(
                                &mut socket,
                                &mut epoch,
                                self.initialization_failure_reason(),
                            )
                            .await;
                            continue;
                        }
                    };
                    let mut initialization_queue_error = None;
                    loop {
                        match source_events.try_recv() {
                            Ok(event) => {
                                if let Err(reason) = ingest_event(&mut epoch, &epoch_id, event) {
                                    initialization_queue_error = Some(reason);
                                    break;
                                }
                            }
                            Err(CoordinatorRecvError::Empty) => break,
                            Err(CoordinatorRecvError::Overflow) => {
                                initialization_queue_error =
                                    Some(ReinitializeReason::QueueOverflow);
                                break;
                            }
                            Err(CoordinatorRecvError::Closed) => {
                                initialization_queue_error = Some(ReinitializeReason::SourceGap);
                                break;
                            }
                        }
                    }
                    if let Some(reason) = initialization_queue_error {
                        self.reinitialize(&mut socket, &mut epoch, reason).await;
                        continue;
                    }
                    if epoch.phase == EpochPhase::Closed {
                        continue;
                    }
                    if self.source.generation() != generation {
                        self.reinitialize(
                            &mut socket,
                            &mut epoch,
                            ReinitializeReason::UpstreamGenerationChanged,
                        )
                        .await;
                        continue;
                    }
                    let revision = format!(
                        "sync-v2-revision:{}:{}",
                        epoch_id.as_str(),
                        blake3::hash(snapshot.source_witness.as_bytes()).to_hex()
                    );
                    let (commit, included_tail) = epoch.cut_snapshot(revision);
                    let returned_active = snapshot.catalog.active.len();
                    let returned_archived = snapshot.catalog.archived.len();
                    self.source.coordinator().set_snapshot_membership(
                        &epoch_id,
                        &snapshot.catalog.active,
                        &snapshot.catalog.archived,
                    );
                    let snapshot_frame = ServerFrame::Snapshot {
                        version: 2,
                        source_generation: U64::new(generation),
                        epoch_id: epoch_id.clone(),
                        revision: commit.revision.clone(),
                        watermark: commit.watermark,
                        scope: snapshot.scope,
                        catalog: snapshot.catalog,
                        current_thread: snapshot.current_thread,
                        pending_requests: snapshot.pending_requests,
                        included_tail,
                        limits: self.limits,
                    };
                    let Ok(encoded) = serde_json::to_vec(&snapshot_frame) else {
                        warn!("Sync V2 snapshot serialization failed");
                        self.reinitialize(
                            &mut socket,
                            &mut epoch,
                            ReinitializeReason::SnapshotFailed,
                        )
                        .await;
                        continue;
                    };
                    if !self
                        .context_is_current(&context, &lifecycle, lifecycle_revision)
                        .await
                    {
                        drop(dispatch_guard);
                        self.cleanup(&mut epoch).await;
                        close(&mut socket, 1008, "authenticated_context_revoked").await;
                        return;
                    }
                    info!(
                        epoch_id = epoch_id.as_str(),
                        generation,
                        initialization_ms = initialization_started.elapsed().as_millis(),
                        snapshot_bytes = encoded.len(),
                        returned_active,
                        returned_archived,
                        requested_active = epoch.intent.catalog.active_limit,
                        requested_archived = epoch.intent.catalog.archived_limit,
                        "Sync V2 snapshot ready"
                    );
                    if self.send_frame(&mut socket, &snapshot_frame).await.is_err() {
                        self.cleanup(&mut epoch).await;
                        return;
                    }
                    epoch.confirm_snapshot_sent();
                    drop(dispatch_guard);
                    if !self
                        .run_epoch(
                            &mut socket,
                            &authorization,
                            &context,
                            &mut authorization_changes,
                            &mut epoch,
                            &source_events,
                            &mut generation_changes,
                            &lifecycle,
                            lifecycle_revision,
                            &mut lifecycle_changes,
                        )
                        .await
                    {
                        return;
                    }
                }
                ClientFrame::Open { .. } => {
                    close(&mut socket, 1008, "unsupported_protocol_version").await;
                    return;
                }
                _ => {
                    close(&mut socket, 1008, "open_required").await;
                    return;
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_epoch(
        &self,
        socket: &mut WebSocket,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        authorization_changes: &mut Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
        epoch: &mut ConnectionEpoch,
        source_events: &CoordinatorReceiver,
        generation_changes: &mut tokio::sync::watch::Receiver<u64>,
        lifecycle: &Arc<ContextLifecycle>,
        lifecycle_revision: u64,
        lifecycle_changes: &mut tokio::sync::watch::Receiver<u64>,
    ) -> bool {
        loop {
            tokio::select! {
                biased;
                () = wait_for_session_expiry(authorization) => {
                    close(socket, 1008, "session_expired").await;
                    self.cleanup(epoch).await;
                    return false;
                }
                changed = lifecycle_changes.changed() => {
                    let _ = changed;
                    close(socket, 1008, "authenticated_context_revoked").await;
                    self.cleanup(epoch).await;
                    return false;
                }
                change = recv_authorization_change(authorization_changes, authorization.device_id()) => {
                    if let Some(reason) = change {
                        let _ = self.purge_context(context).await;
                        close(socket, 1008, reason).await;
                        self.cleanup(epoch).await;
                        return false;
                    }
                }
                frame = recv_frame(socket) => {
                    let Some(frame) = frame else { self.cleanup(epoch).await; return false; };
                    if !self.handle_frame(
                        socket,
                        authorization,
                        context,
                        authorization_changes,
                        lifecycle,
                        lifecycle_revision,
                        epoch,
                        frame,
                    ).await {
                        self.cleanup(epoch).await;
                        return false;
                    }
                    if epoch.phase == EpochPhase::Closed {
                        return true;
                    }
                    if epoch.phase == EpochPhase::Draining {
                        if self.flush_changes(socket, epoch).await.is_err() {
                            self.cleanup(epoch).await;
                            return false;
                        }
                        epoch.enter_live();
                        self.mark_epoch_live(context, &epoch.id).await;
                        #[cfg(feature = "e2e-command-fault")]
                        self.e2e_command_fault.hold_next_live().await;
                        if self.send_frame(
                            socket,
                            &ServerFrame::Live {
                                epoch_id: epoch.id.clone(),
                                watermark: U64::new(epoch.watermark),
                            },
                        ).await.is_err() {
                            self.cleanup(epoch).await;
                            return false;
                        }
                    }
                }
                event = source_events.recv() => {
                    let dispatch_guard = lifecycle.dispatch.read().await;
                    if !self
                        .context_is_current(context, lifecycle, lifecycle_revision)
                        .await
                    {
                        drop(dispatch_guard);
                        close(socket, 1008, "authenticated_context_revoked").await;
                        self.cleanup(epoch).await;
                        return false;
                    }
                    match event {
                        Ok(event) => match ingest_event(epoch, &epoch.id.clone(), event) {
                            Ok(true) if epoch.phase == EpochPhase::Live => {
                                if self.flush_changes(socket, epoch).await.is_err() {
                                    self.cleanup(epoch).await;
                                    return false;
                                }
                            }
                            Ok(_) => {}
                            Err(ReinitializeReason::QueueOverflow) => {
                                self.reinitialize(socket, epoch, ReinitializeReason::QueueOverflow).await;
                                return true;
                            }
                            Err(reason) => {
                                self.reinitialize(socket, epoch, reason).await;
                                return true;
                            }
                        },
                        Err(CoordinatorRecvError::Overflow) => {
                            self.reinitialize(socket, epoch, ReinitializeReason::QueueOverflow).await;
                            return true;
                        }
                        Err(CoordinatorRecvError::Closed | CoordinatorRecvError::Empty) => {
                            self.reinitialize(socket, epoch, ReinitializeReason::SourceGap).await;
                            return true;
                        }
                    }
                    drop(dispatch_guard);
                }
                changed = generation_changes.changed() => {
                    if changed.is_err() || *generation_changes.borrow() != epoch.generation {
                        self.reinitialize(socket, epoch, ReinitializeReason::UpstreamGenerationChanged).await;
                        return true;
                    }
                }
            }
        }
    }

    async fn mark_epoch_live(&self, context: &AuthenticatedContextKey, epoch_id: &Id) {
        let mut epochs = self.live_epoch_contexts.lock().await;
        let concurrent = epochs
            .values()
            .filter(|candidate| *candidate == context)
            .count();
        if concurrent > 0 {
            warn!(
                epoch_id = epoch_id.as_str(),
                concurrent_epochs = concurrent + 1,
                "multiple Sync V2 epochs are Live for one authenticated device"
            );
        }
        epochs.insert(epoch_id.clone(), context.clone());
    }

    async fn thread_install_lock(
        &self,
        generation: u64,
        thread_id: Option<&Id>,
    ) -> Option<Arc<tokio::sync::Mutex<()>>> {
        let thread_id = thread_id?;
        // Upstream thread/resume is process-global, so different authenticated
        // clients opening the same thread must share this installation barrier.
        let key = format!("{generation}#{}", thread_id.as_str());
        let mut locks = self.thread_install_locks.lock().await;
        locks.retain(|_, candidate| candidate.strong_count() > 0);
        if let Some(existing) = locks.get(&key).and_then(Weak::upgrade) {
            return Some(existing);
        }
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        Some(lock)
    }
}

fn ingest_event(
    epoch: &mut ConnectionEpoch,
    recipient_id: &Id,
    received: ReceivedCoordinatorEvent,
) -> Result<bool, ReinitializeReason> {
    let (event, reservation) = received.into_parts();
    match event {
        CoordinatorEvent::RoutingInvalidated {
            generation,
            recipient_ids,
            reason,
        } if generation == epoch.generation && recipient_ids.contains(recipient_id) => {
            Err(match reason {
                SourceInvalidationReason::SourceGap => ReinitializeReason::SourceGap,
                SourceInvalidationReason::UpstreamUnavailable => {
                    ReinitializeReason::UpstreamUnavailable
                }
            })
        }
        CoordinatorEvent::Change {
            generation,
            recipient_ids,
            change,
        } if generation == epoch.generation && recipient_ids.contains(recipient_id) => {
            epoch
                .enqueue_reserved(change, reservation)
                .map_err(queue_reason)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn queue_reason(error: QueueError) -> ReinitializeReason {
    match error {
        QueueError::Overflow => ReinitializeReason::QueueOverflow,
        QueueError::Serialization => ReinitializeReason::SourceGap,
    }
}

async fn recv_authorization_change(
    changes: &mut Option<tokio::sync::broadcast::Receiver<AuthorizationChange>>,
    device_id: Option<&str>,
) -> Option<&'static str> {
    let Some(changes) = changes else {
        return std::future::pending().await;
    };
    loop {
        match changes.recv().await {
            Ok(change) if Some(change.device_id.as_str()) == device_id => {
                return Some(change.reason.close_reason());
            }
            Ok(_) => {}
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                return Some("authorization_change_lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                return Some("authorization_channel_closed");
            }
        }
    }
}

async fn wait_for_session_expiry(authorization: &AuthorizationContext) {
    let AuthorizationContext::Session { expires_at, .. } = authorization else {
        return;
    };
    if *expires_at == u64::MAX {
        std::future::pending::<()>().await;
        return;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        });
    tokio::time::sleep(Duration::from_millis(expires_at.saturating_sub(now))).await;
}

fn random_id(prefix: &str) -> Id {
    let mut bytes = [0_u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    Id::from_generated(format!("{prefix}:{}", hex::encode(bytes)))
}
