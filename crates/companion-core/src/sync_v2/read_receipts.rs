//! Typed Sync V2 adapter over the Companion index read-receipt tables.

use std::sync::Arc;

use crate::store::{
    IndexStore, StoreError,
    read_receipts::{StoredMarkReadOutcome, StoredThreadReadState},
};

use super::{AuthenticatedContextKey, scalar::Id};

#[derive(Clone)]
pub(crate) struct ThreadReadReceipts {
    store: Arc<IndexStore>,
}

impl ThreadReadReceipts {
    pub(crate) fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    pub(crate) fn state(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
    ) -> Result<StoredThreadReadState, StoreError> {
        self.store
            .thread_read_state(context.as_str(), thread_id.as_str())
    }

    pub(crate) fn mark_read(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        through_marker: &str,
    ) -> Result<StoredMarkReadOutcome, StoreError> {
        self.store
            .mark_thread_read(context.as_str(), thread_id.as_str(), through_marker)
    }

    pub(crate) fn note_agent_response(
        &self,
        thread_id: &Id,
        marker: &str,
    ) -> Result<(), StoreError> {
        self.store
            .note_thread_read_activity(thread_id.as_str(), marker)
    }

    pub(crate) fn reconcile(
        &self,
        thread_id: &Id,
        ordered_markers: &[String],
        complete: bool,
    ) -> Result<(), StoreError> {
        self.store
            .reconcile_thread_read_activities(thread_id.as_str(), ordered_markers, complete)
    }

    pub(crate) fn delete_thread(&self, thread_id: &Id) -> Result<(), StoreError> {
        self.store.delete_thread_read_state(thread_id.as_str())
    }

    pub(crate) fn purge_context(
        &self,
        context: &AuthenticatedContextKey,
    ) -> Result<(), StoreError> {
        self.store.purge_thread_read_context(context.as_str())
    }
}

#[cfg(test)]
mod tests {
    use crate::auth::AuthorizationContext;
    use crate::store::IndexedThreadMetadata;

    use super::*;

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.to_owned(),
            expires_at: u64::MAX,
        })
        .unwrap_or_else(|error| panic!("{error:?}"))
    }

    fn thread(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("{error:?}"))
    }

    #[test]
    fn stale_receipt_is_monotonic_and_device_scoped() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let receipts = ThreadReadReceipts::new(store);
        let thread = thread("thread-a");
        let first = context("device-a");
        let second = context("device-b");
        receipts.reconcile(
            &thread,
            &[
                "response-a".into(),
                "response-b".into(),
                "response-c".into(),
            ],
            true,
        )?;

        assert_eq!(receipts.state(&first, &thread)?.unread_count, Some(3));
        assert_eq!(receipts.state(&second, &thread)?.unread_count, Some(3));
        let StoredMarkReadOutcome::Marked(marked) =
            receipts.mark_read(&first, &thread, "response-b")?
        else {
            panic!("known marker was rejected");
        };
        assert_eq!(marked.unread_count, Some(1));
        let StoredMarkReadOutcome::Marked(stale) =
            receipts.mark_read(&first, &thread, "response-a")?
        else {
            panic!("known stale marker was rejected");
        };
        assert_eq!(stale.read_through_marker.as_deref(), Some("response-b"));
        assert_eq!(stale.unread_count, Some(1));
        assert_eq!(receipts.state(&second, &thread)?.unread_count, Some(3));
        Ok(())
    }

    #[test]
    fn receipts_and_activity_order_survive_restart() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        let thread = thread("thread-a");
        let first = context("device-a");
        {
            let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(&path)?));
            receipts.reconcile(&thread, &["response-a".into(), "response-b".into()], true)?;
            let _ = receipts.mark_read(&first, &thread, "response-a")?;
        }

        let reopened = ThreadReadReceipts::new(Arc::new(IndexStore::open(&path)?));
        assert_eq!(
            reopened.state(&first, &thread)?,
            StoredThreadReadState {
                latest_activity_marker: Some("response-b".into()),
                read_through_marker: Some("response-a".into()),
                unread_count: Some(1),
            }
        );
        reopened.note_agent_response(&thread, "response-c")?;
        assert_eq!(reopened.state(&first, &thread)?.unread_count, Some(2));
        Ok(())
    }

    #[test]
    fn duplicate_completed_event_cannot_regress_latest_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(
            directory.path().join("index.redb"),
        )?));
        let thread = thread("thread-a");
        let first = context("device-a");
        receipts.reconcile(&thread, &["response-a".into(), "response-b".into()], true)?;

        receipts.note_agent_response(&thread, "response-a")?;

        let state = receipts.state(&first, &thread)?;
        assert_eq!(state.latest_activity_marker.as_deref(), Some("response-b"));
        assert_eq!(state.unread_count, Some(2));
        Ok(())
    }

    #[test]
    fn stale_partial_reconcile_cannot_replace_observed_latest_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(
            directory.path().join("index.redb"),
        )?));
        let thread = thread("thread-a");
        let first = context("device-a");
        receipts.note_agent_response(&thread, "response-live")?;

        receipts.reconcile(
            &thread,
            &["response-old-a".into(), "response-old-b".into()],
            false,
        )?;

        let state = receipts.state(&first, &thread)?;
        assert_eq!(
            state.latest_activity_marker.as_deref(),
            Some("response-live")
        );
        assert_eq!(state.unread_count, None);
        Ok(())
    }

    #[test]
    fn incomplete_activity_never_defaults_unknown_to_read() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(
            directory.path().join("index.redb"),
        )?));
        let thread = thread("thread-a");
        let first = context("device-a");

        assert_eq!(receipts.state(&first, &thread)?.unread_count, None);
        receipts.reconcile(&thread, &["response-latest".into()], false)?;
        assert_eq!(receipts.state(&first, &thread)?.unread_count, None);
        assert!(matches!(
            receipts.mark_read(&first, &thread, "response-stale")?,
            StoredMarkReadOutcome::UnknownMarker(_)
        ));
        let StoredMarkReadOutcome::Marked(marked) =
            receipts.mark_read(&first, &thread, "response-latest")?
        else {
            panic!("latest observed marker was rejected");
        };
        assert_eq!(marked.unread_count, Some(0));
        Ok(())
    }

    #[test]
    fn delete_purges_receipts_but_archive_preserves_them() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb"))?);
        let receipts = ThreadReadReceipts::new(Arc::clone(&store));
        let thread = thread("thread-a");
        let first = context("device-a");
        let mut metadata = IndexedThreadMetadata {
            id: thread.as_str().into(),
            parent_thread_id: None,
            cwd: "/workspace".into(),
            created_at: 1,
            updated_at: 2,
            model_provider: "openai".into(),
            cli_version: "1.0.0".into(),
            source: serde_json::json!({"kind": "cli"}),
            agent_nickname: None,
            agent_role: None,
            archived: false,
        };
        store.put_thread_metadata(&metadata)?;
        receipts.reconcile(&thread, &["response-a".into()], true)?;
        let _ = receipts.mark_read(&first, &thread, "response-a")?;

        metadata.archived = true;
        store.put_thread_metadata(&metadata)?;
        assert_eq!(receipts.state(&first, &thread)?.unread_count, Some(0));
        receipts.delete_thread(&thread)?;
        assert_eq!(
            receipts.state(&first, &thread)?,
            StoredThreadReadState {
                latest_activity_marker: None,
                read_through_marker: None,
                unread_count: None,
            }
        );
        Ok(())
    }

    #[test]
    fn authoritative_rewrite_drops_receipts_for_removed_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(
            directory.path().join("index.redb"),
        )?));
        let thread = thread("thread-a");
        let first = context("device-a");
        receipts.reconcile(&thread, &["response-a".into(), "response-b".into()], true)?;
        let _ = receipts.mark_read(&first, &thread, "response-b")?;

        receipts.reconcile(
            &thread,
            &["replacement-a".into(), "replacement-b".into()],
            true,
        )?;

        assert_eq!(
            receipts.state(&first, &thread)?,
            StoredThreadReadState {
                latest_activity_marker: Some("replacement-b".into()),
                read_through_marker: None,
                unread_count: Some(2),
            }
        );
        Ok(())
    }

    #[test]
    fn explicit_context_purge_does_not_touch_another_device()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let receipts = ThreadReadReceipts::new(Arc::new(IndexStore::open(
            directory.path().join("index.redb"),
        )?));
        let thread = thread("thread-a");
        let first = context("device-a");
        let second = context("device-b");
        receipts.reconcile(&thread, &["response-a".into()], true)?;
        let _ = receipts.mark_read(&first, &thread, "response-a")?;
        let _ = receipts.mark_read(&second, &thread, "response-a")?;

        receipts.purge_context(&first)?;

        assert_eq!(receipts.state(&first, &thread)?.unread_count, Some(1));
        assert_eq!(receipts.state(&second, &thread)?.unread_count, Some(0));
        Ok(())
    }
}
