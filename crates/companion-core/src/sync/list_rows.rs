//! Companion decorations of thread-list rows, shared by `thread/list` pages,
//! `thread/started` seeds and the first-row reads of `thread_list`.
//!
//! A pushed row must be the object a `thread/list` page answers with. The
//! page pipeline (`provider_rpc::handle_thread_list`) applies the page-wide
//! steps (catalog filter, stored previews, provider extension, merged
//! providers, hidden continuations); this module owns the per-row steps that
//! complete a row (pins and spawned-agent lineage) and the equivalent steps
//! for a single row read through `thread/read` or announced by
//! `thread/started`. It implements [`RowReader`] for the row hub.
//!
//! [`RowFeed`] connects the hub to the sync layer: committed ingest batches
//! and decorated pages in, subscriptions out, plus the session checks of
//! `hello.listStream` and `listStream` frames. The hub itself stays free of
//! provider, interest and socket code.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};
use tracing::{debug, warn};

use super::{
    SessionSocket, close_with,
    interest::{INTEREST_CLOSE_CODE, SharedInterest, accept_hello_interest},
    send_json,
};
use crate::{
    agent::{
        client_wire::{gateway::ClientWireGateway, results},
        model::{Capability, thread_not_found_message},
        orchestration::lineage,
        provider::{NativeSurface, NativeThreadStore},
    },
    store::IndexStore,
    thread_list::{
        AbsentReason, HELLO_FIELD, JournaledRow, LIST_STREAM_CLOSE_CODE, RowRead, Seed,
        Subscription, ThreadListRows, frame_visibility, hello_visibility,
        materialize::{Materializer, RowReader, now_secs},
    },
    thread_pins::{self, ThreadPinRequest},
};

/// Provider field marking a thread the ordinary catalog hides.
const CATALOG_EXCLUDED_FIELD: &str = "codewideCatalogExcluded";
/// `RpcFailure` code of an unreadable thread binding: a transient failure,
/// never proof that no provider owns the thread.
const THREAD_BINDING_UNAVAILABLE_CODE: i64 = -32_020;

/// The sync layer's connection to the row hub: decorated rows and committed
/// batches in, subscriptions out. Cheap to clone.
#[derive(Clone)]
pub(super) struct RowFeed {
    rows: ThreadListRows,
    decorator: ListRowDecorator,
    materializer: Materializer,
}

impl RowFeed {
    pub(super) fn new(gateway: Arc<ClientWireGateway>, store: Arc<IndexStore>) -> Self {
        let rows = ThreadListRows::default();
        let decorator = ListRowDecorator { gateway, store };
        let materializer = Materializer::new(rows.clone(), Arc::new(decorator.clone()));
        Self {
            rows,
            decorator,
            materializer,
        }
    }

    pub(super) fn subscribe(&self, visible: bool) -> Subscription {
        self.rows.subscribe(visible)
    }

    /// Reads a raw payload's streamed preview before content projection.
    pub(super) fn observe_stream(&self, payload: &Value) -> Option<String> {
        self.rows.observe_stream(payload)
    }

    /// Hands a committed ingest batch to the row hub (after its journal
    /// commit, so every change carries its cursor) and starts the first-row
    /// reads the hub asks for.
    pub(super) fn apply_committed(
        &self,
        payloads: &[Value],
        cursors: &[u64],
        streamed_previews: Vec<Option<String>>,
    ) {
        let reads = self.rows.apply_journaled(
            payloads.iter().zip(cursors).zip(streamed_previews).map(
                |((payload, &cursor), streamed_preview)| JournaledRow {
                    payload,
                    cursor,
                    streamed_preview,
                    seed: self.decorator.seed(payload),
                },
            ),
            now_secs(),
        );
        self.materializer.spawn(reads);
    }

    /// Applies a committed pin decision, journaled outside the ingest batch.
    pub(super) fn apply_pin(&self, thread_id: String, pinned: bool, cursor: u64) {
        let notification = ThreadPinRequest { thread_id, pinned }.notification(cursor);
        self.apply_committed(&[notification], &[cursor], vec![None]);
    }

    /// The journal head a `thread/list` page is read after; a failure is
    /// logged here.
    pub(super) async fn page_head(&self) -> Result<u64, ()> {
        self.decorator.journal_head().await.map_err(|error| {
            warn!(err = %error, "thread list journal head unavailable");
        })
    }

    /// Completes the rows of a `thread/list` result read after `head` with
    /// `params` and passes them through the row hub, which attaches
    /// `codewideList`. A decoration failure is logged here.
    pub(super) fn observe_page(
        &self,
        result: &mut Value,
        head: u64,
        params: &Value,
    ) -> Result<(), ()> {
        let Some(rows) = result.get_mut("data").and_then(Value::as_array_mut) else {
            return Ok(());
        };
        for row in rows.iter_mut() {
            self.decorator.annotate_row(row).map_err(|error| {
                warn!(err = %error, "thread list row decoration failed");
            })?;
        }
        let archived = params.get("archived").and_then(Value::as_bool) == Some(true);
        self.rows.observe_page(rows, head, archived);
        Ok(())
    }
}

/// The mandatory delivery keys of a hello: `interest` and `listStream`. A
/// rejection is logged with its reason only and closes the socket.
pub(super) async fn accept_hello_streams(
    socket: &SessionSocket,
    hello: &Value,
) -> Option<(SharedInterest, bool)> {
    let (code, reason) = match accept_hello_interest(hello) {
        Ok(interest) => match hello_visibility(hello) {
            Ok(visible) => return Some((interest, visible)),
            Err(rejection) => {
                warn!(
                    reason = rejection.reason(),
                    present = hello.get(HELLO_FIELD).is_some(),
                    "sync client hello rejected"
                );
                (LIST_STREAM_CLOSE_CODE, rejection.reason())
            }
        },
        Err(rejection) => (INTEREST_CLOSE_CODE, rejection.reason()),
    };
    close_with(socket, code, reason).await;
    None
}

/// Applies a `listStream` frame inline; an invalid frame closes the socket.
pub(super) async fn apply_control_frame(
    socket: &SessionSocket,
    subscription: &Subscription,
    frame: &Value,
) -> Result<(), ()> {
    match frame_visibility(frame) {
        Ok(visible) => {
            subscription.set_visible(visible);
            Ok(())
        }
        Err(rejection) => {
            warn!(
                reason = rejection.reason(),
                "sync client list stream frame rejected"
            );
            close_with(socket, LIST_STREAM_CLOSE_CODE, rejection.reason()).await;
            Err(())
        }
    }
}

/// Sends one flush's frames in order; logs sizes only.
pub(super) async fn send_frames(socket: &SessionSocket, frames: &[Value]) -> Result<(), ()> {
    for frame in frames {
        debug!(
            rows = frame["rows"].as_array().map_or(0, Vec::len),
            removed = frame["removed"].as_array().map_or(0, Vec::len),
            "thread list rows sent"
        );
        send_json(socket, frame).await.map_err(|_| ())?;
    }
    Ok(())
}

/// A feed over a single fake provider, for ingest tests.
#[cfg(test)]
pub(super) fn test_feed(store: &Arc<IndexStore>) -> RowFeed {
    use crate::agent::{bindings::BindingStore, registry::ProviderRegistry, testing::FakeProvider};
    let provider = FakeProvider::new(
        "codex",
        agent_core::model::CapabilitySet::none(agent_core::model::StartWhileActiveMode::Busy),
    )
    .into_arc();
    let gateway = Arc::new(ClientWireGateway::new(
        Arc::new(ProviderRegistry::single(provider, Vec::new())),
        Arc::new(BindingStore::new(store.clone())),
    ));
    RowFeed::new(gateway, store.clone())
}

/// Decorates single rows; cheap to clone.
#[derive(Clone)]
struct ListRowDecorator {
    gateway: Arc<ClientWireGateway>,
    store: Arc<IndexStore>,
}

impl ListRowDecorator {
    fn thread_store(&self) -> Option<Arc<dyn NativeThreadStore>> {
        self.gateway
            .registry()
            .owner(Capability::CodexNative)
            .and_then(|owner| owner.native_surface())
            .and_then(NativeSurface::thread_store)
    }

    /// The seed of a journaled `thread/started`: its thread with pins, unless
    /// the catalog hides it (lineage and the provider extension were
    /// projected before the journal). `None` for any other payload.
    fn seed(&self, payload: &Value) -> Option<Seed> {
        if payload.get("method").and_then(Value::as_str) != Some("thread/started") {
            return None;
        }
        let mut thread = payload.pointer("/params/thread")?.clone();
        if self.excluded(&mut thread) || self.is_continuation(&thread) {
            return Some(Seed::Excluded);
        }
        match self.annotate_row(&mut thread) {
            Ok(()) => Some(Seed::Row(thread)),
            // The row hub then seeds the undecorated thread; the next page
            // re-read replaces it.
            Err(_) => None,
        }
    }

    /// Whether the catalog hides the thread; removes the provider marker so
    /// the row matches a filtered page row.
    fn excluded(&self, thread: &mut Value) -> bool {
        if let Some(thread_store) = self.thread_store() {
            thread_store.annotate_thread(thread);
        }
        thread
            .as_object_mut()
            .and_then(|thread| thread.remove(CATALOG_EXCLUDED_FIELD))
            .and_then(|excluded| excluded.as_bool())
            == Some(true)
    }

    fn is_continuation(&self, thread: &Value) -> bool {
        let mut page = json!({"data": [thread]});
        self.gateway.hide_continuations(&mut page);
        page["data"].as_array().is_some_and(Vec::is_empty)
    }

    /// The per-row decorations of a page row: Companion pin and
    /// spawned-agent lineage.
    fn annotate_row(&self, row: &mut Value) -> Result<(), String> {
        if let Some(id) = row.get("id").and_then(Value::as_str) {
            let pin = self
                .store
                .thread_pin(id)
                .map_err(|error| error.to_string())?;
            thread_pins::annotate(row, pin);
        }
        lineage::annotate_thread(&self.store, row).map_err(|error| error.to_string())
    }

    async fn read_thread(&self, thread_id: &str) -> Result<RowRead, String> {
        let target = match self.gateway.resolve_thread(thread_id, None).await {
            Ok(target) => target,
            Err(failure) if failure.code == THREAD_BINDING_UNAVAILABLE_CODE => {
                return Err(format!(
                    "thread binding lookup failed with code {}",
                    failure.code
                ));
            }
            // No enabled provider owns the thread: it cannot be listed.
            Err(_) => return Ok(RowRead::Absent(AbsentReason::NotOwned)),
        };
        let params = json!({"threadId": thread_id, "includeTurns": false});
        let Some(native) = target.native() else {
            let result = results::execute(&target, "thread/read", &params)
                .await
                .map_err(|failure| format!("thread/read failed with code {}", failure.code))?;
            return Ok(result
                .get("thread")
                .cloned()
                .map_or(RowRead::Absent(AbsentReason::Missing), RowRead::Row));
        };
        let response = native
            .request(json!({"id": "thread-list-row", "method": "thread/read", "params": params}))
            .await
            .map_err(|error| error.to_string())?;
        if let Some(code) = response.pointer("/error/code") {
            // The exact provider rejection proves the thread is unknown to it.
            if response.pointer("/error/message").and_then(Value::as_str)
                == Some(thread_not_found_message(thread_id).as_str())
            {
                return Ok(RowRead::Absent(AbsentReason::Missing));
            }
            return Err(format!("thread/read failed with code {code}"));
        }
        let Some(mut thread) = response.pointer("/result/thread").cloned() else {
            return Ok(RowRead::Absent(AbsentReason::Missing));
        };
        if let Some(thread_store) = self.thread_store() {
            let page = thread_store
                .enrich_thread_page(json!({"data": [thread.clone()]}))
                .await;
            if let Some(enriched) = page.pointer("/data/0") {
                thread = enriched.clone();
            }
        }
        let mut result = json!({"thread": thread});
        target
            .wire
            .attach_to_native_result("thread/read", &mut result);
        Ok(result
            .get("thread")
            .cloned()
            .map_or(RowRead::Absent(AbsentReason::Missing), RowRead::Row))
    }
}

#[async_trait]
impl RowReader for ListRowDecorator {
    async fn journal_head(&self) -> Result<u64, String> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || store.replay_head())
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }

    async fn read_row(&self, thread_id: &str) -> Result<RowRead, String> {
        let mut row = match self.read_thread(thread_id).await? {
            RowRead::Row(row) => row,
            absent @ RowRead::Absent(_) => return Ok(absent),
        };
        if self.excluded(&mut row) {
            return Ok(RowRead::Absent(AbsentReason::CatalogHidden));
        }
        if self.is_continuation(&row) {
            return Ok(RowRead::Absent(AbsentReason::Continuation));
        }
        self.annotate_row(&mut row)?;
        Ok(RowRead::Row(row))
    }
}
