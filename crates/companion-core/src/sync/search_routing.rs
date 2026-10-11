//! `companion/search*` across providers. The `history.messageSearch` owner
//! with the `codex.native` surface answers as it always did. A provider that
//! searches its own stored history in neutral form (`AgentProvider::
//! message_search`) answers the thread-scoped reads of its threads, and a
//! global `companion/search` merges every searching provider's hits in the
//! shared order (newest first, then thread id, then the later position).
//! Without such a provider nothing here runs.

use std::{cmp::Ordering, sync::Arc};

use serde_json::{Value, json};

use crate::agent::{
    client_wire::items,
    model::ItemsView,
    provider::{NativeMessageSearch, StoredMessageSearch},
};

/// Hits per search page, shared by every search index.
const PAGE_SIZE: u64 = 30;
/// The largest offset a search index accepts.
const MAX_OFFSET: u64 = 100_000;

/// One provider's search.
pub(super) enum SearchSource {
    Native(Arc<dyn NativeMessageSearch>),
    Stored(Arc<dyn StoredMessageSearch>),
}

impl SearchSource {
    async fn page(&self, params: &Value) -> Result<Value, String> {
        match self {
            Self::Native(search) => search
                .search("companion/search", params)
                .await
                .unwrap_or_else(|| Err("Search is unavailable".to_owned())),
            Self::Stored(search) => search.search(params).await,
        }
    }
}

/// A thread-scoped read or a page of a provider's own stored search.
pub(super) async fn stored(
    search: &dyn StoredMessageSearch,
    method: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    Some(match method {
        "companion/search" => search.search(params).await,
        "companion/search/context" => search.context(params).await,
        "companion/search/window" => search.window(params).await.map(|window| {
            let mut value = window.page;
            value["turns"] = Value::Array(
                window
                    .turns
                    .iter()
                    .map(|turn| items::turn(turn, ItemsView::Full))
                    .collect(),
            );
            value
        }),
        _ => return None,
    })
}

/// A global `companion/search` page merged from `sources` (in registry
/// order). Each source is paged from its start until it supplies the hits
/// up to the requested offset, so the merged order is exact.
pub(super) async fn merged(sources: &[SearchSource], params: &Value) -> Result<Value, String> {
    let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0);
    let Some(first) = sources.first() else {
        return Err("Search is unavailable".to_owned());
    };
    if offset > MAX_OFFSET || sources.len() == 1 {
        // Out of range offsets keep the index's own validation error.
        return first.page(params).await;
    }
    let wanted = usize::try_from(offset + PAGE_SIZE + 1).unwrap_or(usize::MAX);
    let mut hits = Vec::new();
    let mut indexing = false;
    let mut failed_sources = 0_u64;
    let mut first_error = None;
    let mut answered = false;
    for source in sources {
        let mut taken = Vec::new();
        let mut cursor = 0_u64;
        loop {
            let mut request = params.clone();
            request["offset"] = json!(cursor);
            let page = match source.page(&request).await {
                Ok(page) => page,
                Err(error) => {
                    // An unavailable provider index counts as a failed source;
                    // only when every source fails is the page an error.
                    failed_sources += 1;
                    first_error.get_or_insert(error);
                    break;
                }
            };
            answered = true;
            indexing |= page["indexing"].as_bool().unwrap_or(false);
            if cursor == 0 {
                failed_sources += page["failedSources"].as_u64().unwrap_or(0);
            }
            taken.extend(page["data"].as_array().cloned().unwrap_or_default());
            match page["nextOffset"].as_u64() {
                Some(next) if taken.len() < wanted && next > cursor && next <= MAX_OFFSET => {
                    cursor = next;
                }
                _ => break,
            }
        }
        hits.extend(taken);
    }
    if !answered && let Some(error) = first_error {
        return Err(error);
    }
    hits.sort_by(hit_order);
    let start = usize::try_from(offset).unwrap_or(usize::MAX);
    let end = start.saturating_add(usize::try_from(PAGE_SIZE).unwrap_or(30));
    let next_offset = (hits.len() > end).then_some(offset + PAGE_SIZE);
    let data = hits
        .into_iter()
        .skip(start)
        .take(end - start)
        .collect::<Vec<_>>();
    Ok(json!({
        "data": data,
        "nextOffset": next_offset,
        "indexing": indexing,
        "failedSources": failed_sources,
    }))
}

/// Newest first, then thread id, then the later position (the order of each
/// index's own query).
fn hit_order(left: &Value, right: &Value) -> Ordering {
    let text = |hit: &Value, field: &str| hit[field].as_str().unwrap_or_default().to_owned();
    text(right, "timestamp")
        .cmp(&text(left, "timestamp"))
        .then_with(|| text(left, "threadId").cmp(&text(right, "threadId")))
        .then_with(|| {
            right["sourceOffset"]
                .as_i64()
                .cmp(&left["sourceOffset"].as_i64())
        })
}

#[cfg(test)]
mod tests {
    use agent_core::provider::SearchWindow;
    use async_trait::async_trait;

    use super::*;

    /// A stored search over fixed hits, paged like the shared index.
    struct Fixed(Vec<Value>);

    #[async_trait]
    impl StoredMessageSearch for Fixed {
        async fn search(&self, params: &Value) -> Result<Value, String> {
            let offset = usize::try_from(params["offset"].as_u64().unwrap_or(0)).unwrap_or(0);
            let page = self
                .0
                .iter()
                .skip(offset)
                .take(31)
                .cloned()
                .collect::<Vec<_>>();
            let next = (page.len() > 30).then_some(offset + 30);
            Ok(
                json!({"data": page.into_iter().take(30).collect::<Vec<_>>(),
                "nextOffset": next, "indexing": false, "failedSources": 1}),
            )
        }

        async fn context(&self, _params: &Value) -> Result<Value, String> {
            Err("unused".into())
        }

        async fn window(&self, _params: &Value) -> Result<SearchWindow, String> {
            Err("unused".into())
        }
    }

    fn hits(thread: &str, seconds: &[u32]) -> Vec<Value> {
        seconds
            .iter()
            .map(|second| {
                json!({"threadId": thread, "timestamp": format!("2026-01-01T00:{:02}:{:02}Z", second / 60, second % 60), "sourceOffset": second})
            })
            .collect()
    }

    #[tokio::test]
    async fn global_pages_merge_providers_newest_first() -> Result<(), String> {
        let a: Vec<u32> = (0..40).map(|n| n * 2).rev().collect();
        let b: Vec<u32> = (0..40).map(|n| n * 2 + 1).rev().collect();
        let sources = [
            SearchSource::Stored(Arc::new(Fixed(hits("a", &a)))),
            SearchSource::Stored(Arc::new(Fixed(hits("b", &b)))),
        ];
        let first = merged(&sources, &json!({"query": "x"})).await?;
        let offsets = |page: &Value| {
            page["data"]
                .as_array()
                .map(|data| {
                    data.iter()
                        .filter_map(|hit| hit["sourceOffset"].as_u64())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        assert_eq!(offsets(&first), (50..80).rev().collect::<Vec<_>>());
        assert_eq!(first["nextOffset"], 30);
        assert_eq!(first["failedSources"], 2);
        let last = merged(&sources, &json!({"query": "x", "offset": 60})).await?;
        assert_eq!(offsets(&last), (0..20).rev().collect::<Vec<_>>());
        assert!(last["nextOffset"].is_null());
        Ok(())
    }
}
