use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use super::{
    AuthenticatedContextKey, BoundedMap, CatalogPartition, ErrorCode, HistoryAnchor, HistoryCursor,
    HistoryDetail, HistoryDirection, Id, Item, ItemOutputCursorWitness, QueryResult, ReadThread,
    Recovery, SemanticSource, SourceWitness, ThreadFreshnessWitness, ThreadReadState, Timestamp,
    TurnItemsCursorWitness, TurnLifecycleKey, TurnView, U64, UpstreamSemanticSource, V2Error,
    catalog_anchor_key, ensure_generation, normalize, rollout_witness, stale_cursor,
    v1_source_offset,
};

impl UpstreamSemanticSource {
    pub(super) async fn catalog_page(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        partition: CatalogPartition,
        before: Option<crate::sync_v2::domain::CatalogAnchor>,
        limit: u16,
    ) -> Result<
        (
            Vec<crate::sync_v2::domain::ThreadSummary>,
            Option<crate::sync_v2::domain::CatalogAnchor>,
        ),
        V2Error,
    > {
        let cursor_key = before
            .as_ref()
            .map(catalog_anchor_key)
            .map(|key| retained_cursor_key(context, &key));
        let source_cursor = cursor_key.as_ref().and_then(|key| {
            self.catalog_cursors
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(key)
                .cloned()
        });
        if before.is_some() && source_cursor.is_none() {
            return Err(V2Error {
                code: ErrorCode::StaleCursor,
                recovery: Recovery::Requery,
                message: "catalog anchor source witness is no longer retained".into(),
            });
        }
        let (mut threads, source_next_cursor) = self
            .fetch_catalog_page(partition, source_cursor, limit)
            .await?;
        for thread in &mut threads {
            self.attach_read_state(context, thread)?;
        }
        ensure_generation(self, generation)?;
        for thread in &threads {
            self.record_thread_access(context, &thread.id, generation);
        }
        let next = source_next_cursor.as_ref().and_then(|_| {
            threads
                .last()
                .map(|thread| crate::sync_v2::domain::CatalogAnchor {
                    last_activity_at: thread.last_activity_at.clone(),
                    updated_at: thread.updated_at.clone(),
                    thread_id: thread.id.clone(),
                })
        });
        if let (Some(anchor), Some(source_cursor)) = (&next, source_next_cursor) {
            let _ = self
                .catalog_cursors
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(
                    retained_cursor_key(context, &catalog_anchor_key(anchor)),
                    source_cursor,
                );
        }
        Ok((threads, next))
    }

    async fn fetch_catalog_page(
        &self,
        partition: CatalogPartition,
        mut page_cursor: Option<String>,
        limit: u16,
    ) -> Result<(Vec<crate::sync_v2::domain::ThreadSummary>, Option<String>), V2Error> {
        let mut skipped_page_cursors = HashSet::new();
        if let Some(cursor) = &page_cursor {
            skipped_page_cursors.insert(cursor.clone());
        }
        loop {
            let result = self
                .rpc(
                    "thread/list",
                    json!({
                        "limit": limit,
                        "sortKey": "updated_at",
                        "sortDirection": "desc",
                        "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
                        "archived": partition == CatalogPartition::Archived,
                        "cursor": page_cursor,
                        "useStateDbOnly": true,
                    }),
                )
                .await?;
            let result = self.history.enrich_thread_list(result).await;
            let source_threads = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| V2Error::source_unavailable("thread/list omitted data"))?;
            if source_threads.len() > limit as usize {
                return Err(V2Error::source_unavailable(
                    "catalog source exceeded record limit",
                ));
            }
            let threads = source_threads
                .iter()
                .filter(|thread| normalize::is_user_catalog_thread(thread))
                .map(|thread| {
                    normalize::thread_summary_in_partition(
                        thread,
                        partition == CatalogPartition::Archived,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            let next_cursor = source_catalog_cursor(&result).map(ToOwned::to_owned);
            if !threads.is_empty() || next_cursor.is_none() {
                return Ok((threads, next_cursor));
            }
            if next_cursor
                .as_ref()
                .is_some_and(|cursor| !skipped_page_cursors.insert(cursor.clone()))
            {
                return Err(V2Error::source_unavailable(
                    "catalog source returned a repeated cursor",
                ));
            }
            page_cursor = next_cursor;
        }
    }

    pub(super) async fn read_thread(
        &self,
        thread_id: &Id,
    ) -> Result<crate::sync_v2::domain::ThreadSummary, V2Error> {
        Ok(self.read_thread_record(thread_id).await?.summary)
    }

    pub(super) fn attach_read_state(
        &self,
        context: &AuthenticatedContextKey,
        thread: &mut crate::sync_v2::domain::ThreadSummary,
    ) -> Result<(), V2Error> {
        let state = self
            .read_receipts
            .state(context, &thread.id)
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let unread_count = state
            .unread_count
            .map(i64::try_from)
            .transpose()
            .map_err(|_| V2Error::source_unavailable("thread unread count exceeded limit"))?;
        thread.read_state = match (unread_count, state.latest_activity_marker) {
            (Some(0), latest_activity_marker) => ThreadReadState::Read {
                latest_activity_marker,
                read_through_marker: state.read_through_marker,
                unread_count: 0,
            },
            (Some(unread_count), Some(latest_activity_marker)) if unread_count > 0 => {
                ThreadReadState::Unread {
                    latest_activity_marker,
                    read_through_marker: state.read_through_marker,
                    unread_count,
                }
            }
            (_, latest_activity_marker) => ThreadReadState::Unknown {
                latest_activity_marker,
                read_through_marker: state.read_through_marker,
                unread_count: None,
            },
        };
        Ok(())
    }

    pub(super) async fn read_thread_record(&self, thread_id: &Id) -> Result<ReadThread, V2Error> {
        let mut result = self
            .rpc(
                "thread/read",
                json!({"threadId": thread_id.as_str(), "includeTurns": false}),
            )
            .await?;
        let thread = match result.get_mut("thread") {
            Some(thread) => thread.take(),
            None => result,
        };
        let freshness = thread_freshness_witness(&thread);
        self.remember_thread_freshness(thread_id, freshness);
        let thread = self
            .enrich_thread_when_rollout_is_fresh(thread_id, thread, freshness)
            .await;
        let visible_in_catalog = normalize::is_user_catalog_thread(&thread);
        let supports_detached_review =
            thread.get("historyMode").and_then(Value::as_str) != Some("paginated");
        let thread = normalize::thread_summary(&thread)?;
        let settings = self
            .resumed_thread_settings
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(thread_id)
            .cloned();
        Ok(ReadThread {
            summary: with_cached_thread_settings(thread, settings.as_ref()),
            visible_in_catalog,
            supports_detached_review,
        })
    }

    async fn enrich_thread_when_rollout_is_fresh(
        &self,
        thread_id: &Id,
        thread: Value,
        freshness: ThreadFreshnessWitness,
    ) -> Value {
        let params = initial_history_params(thread_id, None, 1, freshness);
        let local_is_fresh = matches!(
            self.history
                .try_turns_page("thread/turns/list", &params)
                .await,
            Some(Ok(_))
        );
        if local_is_fresh {
            self.history.enrich_thread(thread).await
        } else {
            thread
        }
    }

    pub(super) fn remember_thread_freshness(
        &self,
        thread_id: &Id,
        freshness: ThreadFreshnessWitness,
    ) {
        let _ = self
            .thread_freshness
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(thread_id.clone(), freshness);
    }

    pub(super) fn remember_thread_freshness_from_response(&self, thread_id: &Id, response: &Value) {
        let thread = response.get("thread").unwrap_or(response);
        self.remember_thread_freshness(thread_id, thread_freshness_witness(thread));
    }

    fn thread_freshness(&self, thread_id: &Id) -> ThreadFreshnessWitness {
        self.thread_freshness
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(thread_id)
            .copied()
            .unwrap_or_default()
    }

    pub(super) fn resolve_turn_items_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        turn_id: &Id,
        generation: u64,
        cursor: Option<&str>,
    ) -> Result<Option<String>, V2Error> {
        let Some(cursor) = cursor else {
            return Ok(None);
        };
        let key = retained_cursor_key(context, cursor);
        let cursors = self
            .turn_items_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolve_turn_items_cursor_witness(&cursors, &key, thread_id, turn_id, generation).map(Some)
    }

    pub(super) fn wrap_turn_items_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        turn_id: &Id,
        generation: u64,
        source_cursor: &str,
    ) -> String {
        let cursor =
            opaque_turn_items_cursor(context, thread_id, turn_id, generation, source_cursor);
        let key = retained_cursor_key(context, &cursor);
        let _ = self
            .turn_items_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                key,
                TurnItemsCursorWitness {
                    source_cursor: source_cursor.to_owned(),
                    thread_id: thread_id.clone(),
                    turn_id: turn_id.clone(),
                    generation,
                },
            );
        cursor
    }

    pub(super) fn resolve_item_output_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        turn_id: &Id,
        item_id: &Id,
        generation: u64,
        cursor: Option<&str>,
    ) -> Result<Option<ItemOutputCursorWitness>, V2Error> {
        let Some(cursor) = cursor else {
            return Ok(None);
        };
        let key = retained_cursor_key(context, cursor);
        let cursors = self
            .item_output_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolve_item_output_cursor_witness(&cursors, &key, thread_id, turn_id, item_id, generation)
            .map(Some)
    }

    pub(super) fn wrap_item_output_cursor(
        &self,
        context: &AuthenticatedContextKey,
        witness: ItemOutputCursorWitness,
    ) -> String {
        let cursor = opaque_item_output_cursor(context, &witness);
        let key = retained_cursor_key(context, &cursor);
        let _ = self
            .item_output_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(key, witness);
        cursor
    }

    pub(super) async fn latest_turn(
        &self,
        thread_id: &Id,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<Vec<crate::sync_v2::domain::TurnView>, V2Error> {
        let result = self.rpc("thread/turns/list", json!({"threadId": thread_id.as_str(), "cursor": null, "limit": limit, "sortDirection": "desc", "itemsView": match detail { HistoryDetail::Summary => "summary", HistoryDetail::Full => "full" }})).await?;
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("thread/turns/list omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "turn source exceeded record limit",
            ));
        }
        let local_metadata = if detail == HistoryDetail::Full {
            self.local_turn_display_metadata(thread_id, limit).await
        } else {
            HashMap::new()
        };
        let mut turns = source_turns
            .iter()
            .map(|value| {
                let enriched = merge_turn_display_metadata(value, &local_metadata);
                normalize::turn_view(thread_id, &enriched)
            })
            .collect::<Result<Vec<_>, _>>()?;
        turns.reverse();
        self.seed_turn_lifecycle(&turns);
        Ok(turns)
    }

    fn seed_turn_lifecycle(&self, turns: &[TurnView]) {
        let mut witnesses = self
            .turn_lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for turn in turns {
            let seen_user_message = turn
                .items
                .iter()
                .any(|item| matches!(item, Item::UserMessage { .. }));
            let _ = witnesses.insert(
                TurnLifecycleKey {
                    thread_id: turn.thread_id.clone(),
                    turn_id: turn.id.clone(),
                },
                seen_user_message,
            );
        }
    }

    pub(super) fn lifecycle_pre_turn(
        &self,
        thread_id: &Id,
        turn_id: &Id,
        item: &Item,
    ) -> Option<bool> {
        let key = TurnLifecycleKey {
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
        };
        let mut witnesses = self
            .turn_lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let seen_user_message = *witnesses.get(&key)?;
        let pre_turn = !seen_user_message && !matches!(item, Item::UserMessage { .. });
        if matches!(item, Item::UserMessage { .. }) {
            let _ = witnesses.insert(key, true);
        }
        Some(pre_turn)
    }

    fn reconcile_read_activities(
        &self,
        thread_id: &Id,
        turns: &[TurnView],
        complete: bool,
    ) -> Result<(), V2Error> {
        let markers = turns
            .iter()
            .filter_map(final_agent_activity_marker)
            .collect::<Vec<_>>();
        self.read_receipts
            .reconcile(thread_id, &markers, complete)
            .map_err(|error| V2Error::source_unavailable(error.to_string()))
    }

    async fn local_turn_display_metadata(
        &self,
        thread_id: &Id,
        limit: u16,
    ) -> HashMap<String, Value> {
        let Some(Ok(result)) = self
            .history
            .try_turns_page(
                "thread/turns/list",
                &json!({
                    "threadId": thread_id.as_str(),
                    "cursor": null,
                    "limit": limit,
                    "sortDirection": "desc",
                    "itemsView": "summary"
                }),
            )
            .await
        else {
            return HashMap::new();
        };
        result
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|turn| {
                let id = turn.get("id")?.as_str()?.to_owned();
                Some((id, turn.clone()))
            })
            .collect()
    }

    pub(super) async fn history_page(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: Id,
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<QueryResult, V2Error> {
        if direction == HistoryDirection::Newer {
            return self
                .live_history_page(context, thread_id, cursor, direction, limit, detail)
                .await;
        }
        if detail == HistoryDetail::Full {
            return self
                .live_history_page(context, thread_id, cursor, direction, limit, detail)
                .await;
        }
        let decoded = cursor
            .as_deref()
            .map(|value| HistoryCursor::decode(value, &thread_id, direction))
            .transpose()?;
        if let Some(decoded) = &decoded {
            self.require_cursor_owner(context, cursor.as_deref().unwrap_or_default())?;
            self.validate_rollout_witness(decoded)?;
        }
        let internal_cursor = decoded
            .as_ref()
            .map(HistoryCursor::internal_v1_cursor)
            .transpose()?;
        let freshness = if cursor.is_none() {
            self.thread_freshness(&thread_id)
        } else {
            ThreadFreshnessWitness::default()
        };
        let params =
            initial_history_params(&thread_id, internal_cursor.as_deref(), limit, freshness);
        let local = self
            .history
            .try_turns_page("thread/turns/list", &params)
            .await;
        let result = match local {
            Some(Ok(result)) => result,
            Some(Err(_)) | None if cursor.is_none() => {
                return self
                    .live_history_page(context, thread_id, None, direction, limit, detail)
                    .await;
            }
            Some(Err(_)) | None => return Err(stale_cursor()),
        };
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("history projection omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "history source exceeded record limit",
            ));
        }
        let mut turns = source_turns
            .iter()
            .map(|value| normalize::turn_view(&thread_id, value))
            .collect::<Result<Vec<_>, _>>()?;
        turns.reverse();
        let older_cursor = if let (Some(next), Some(last)) = (
            result.get("nextCursor").and_then(Value::as_str),
            turns.first(),
        ) {
            let offset = v1_source_offset(next)?;
            let (anchor, witness) = self.rollout_anchor(&thread_id, &last.id, offset)?;
            let cursor =
                HistoryCursor::new(thread_id.clone(), HistoryDirection::Older, anchor, witness)
                    .encode()?;
            self.remember_cursor_owner(context, &cursor);
            Some(cursor)
        } else {
            None
        };
        self.seed_turn_lifecycle(&turns);
        if cursor.is_none() {
            self.reconcile_read_activities(&thread_id, &turns, older_cursor.is_none())?;
        }
        Ok(QueryResult::HistoryPage {
            thread_id,
            turns,
            older_cursor,
            newer_cursor: None,
        })
    }

    async fn live_history_page(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: Id,
        cursor: Option<String>,
        direction: HistoryDirection,
        limit: u16,
        detail: HistoryDetail,
    ) -> Result<QueryResult, V2Error> {
        let source_cursor = match cursor.as_deref() {
            None => None,
            Some(value) => {
                let decoded = HistoryCursor::decode(value, &thread_id, direction)?;
                self.require_cursor_owner(context, value)?;
                match decoded.source() {
                    SourceWitness::Live { generation, .. }
                        if generation.get() == self.generation() => {}
                    _ => return Err(stale_cursor()),
                }
                Some(
                    self.live_history_cursors
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .get(&retained_cursor_key(context, value))
                        .cloned()
                        .ok_or_else(stale_cursor)?,
                )
            }
        };
        let result = self.rpc("thread/turns/list", json!({"threadId": thread_id.as_str(), "cursor": source_cursor, "limit": limit, "sortDirection": if direction == HistoryDirection::Older { "desc" } else { "asc" }, "itemsView": if detail == HistoryDetail::Full { "full" } else { "summary" }})).await?;
        let source_turns = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("history source omitted data"))?;
        if source_turns.len() > limit as usize {
            return Err(V2Error::source_unavailable(
                "history source exceeded record limit",
            ));
        }
        let mut turns = source_turns
            .iter()
            .map(|value| normalize::turn_view(&thread_id, value))
            .collect::<Result<Vec<_>, _>>()?;
        if direction == HistoryDirection::Older {
            turns.reverse();
        }
        let head_turn_id = turns.last().map(|turn| turn.id.clone());
        let continuation_anchor = match direction {
            HistoryDirection::Older => turns.first(),
            HistoryDirection::Newer => turns.last(),
        };
        let reverse_anchor = match direction {
            HistoryDirection::Older => turns.last(),
            HistoryDirection::Newer => turns.first(),
        };
        let continuation = match (
            result.get("nextCursor").and_then(Value::as_str),
            continuation_anchor,
        ) {
            (Some(source_cursor), Some(anchor)) => Some(self.wrap_live_history_cursor(
                context,
                &thread_id,
                direction,
                source_cursor,
                &anchor.id,
                head_turn_id.clone(),
            )?),
            _ => None,
        };
        let reverse_direction = opposite_history_direction(direction);
        let reverse = match (
            result.get("backwardsCursor").and_then(Value::as_str),
            reverse_anchor,
        ) {
            (Some(source_cursor), Some(anchor)) => Some(self.wrap_live_history_cursor(
                context,
                &thread_id,
                reverse_direction,
                source_cursor,
                &anchor.id,
                head_turn_id,
            )?),
            _ => None,
        };
        let (older_cursor, newer_cursor) = match direction {
            HistoryDirection::Older => (continuation, reverse),
            HistoryDirection::Newer => (reverse, continuation),
        };
        self.seed_turn_lifecycle(&turns);
        if direction == HistoryDirection::Older && cursor.is_none() {
            self.reconcile_read_activities(&thread_id, &turns, older_cursor.is_none())?;
        }
        Ok(QueryResult::HistoryPage {
            thread_id,
            turns,
            older_cursor,
            newer_cursor,
        })
    }

    fn wrap_live_history_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        direction: HistoryDirection,
        source_cursor: &str,
        anchor_turn_id: &Id,
        head_turn_id: Option<Id>,
    ) -> Result<String, V2Error> {
        let cursor = HistoryCursor::new(
            thread_id.clone(),
            direction,
            HistoryAnchor {
                turn_id: anchor_turn_id.clone(),
                start_offset: None,
                end_offset: None,
            },
            SourceWitness::Live {
                generation: U64::new(self.generation()),
                head_turn_id,
                updated_at: Timestamp::now(),
            },
        )
        .encode()?;
        let _ = self
            .live_history_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                retained_cursor_key(context, &cursor),
                source_cursor.to_owned(),
            );
        self.remember_cursor_owner(context, &cursor);
        Ok(cursor)
    }

    fn rollout_anchor(
        &self,
        thread_id: &Id,
        turn_id: &Id,
        fallback_offset: u64,
    ) -> Result<(HistoryAnchor, SourceWitness), V2Error> {
        let path = self
            .catalog
            .resolve(thread_id.as_str())
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let file_id = crate::rollout::rollout_file_id(&path);
        let turn = self
            .store
            .turn_by_id(&file_id, turn_id.as_str())
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let start = turn
            .as_ref()
            .map_or(fallback_offset, |turn| turn.start_offset);
        let end = turn.as_ref().map(|turn| turn.end_offset);
        let anchor = HistoryAnchor {
            turn_id: turn_id.clone(),
            start_offset: Some(U64::new(start)),
            end_offset: end.map(U64::new),
        };
        let witness = rollout_witness(&path, &anchor)?;
        Ok((anchor, witness))
    }

    fn validate_rollout_witness(&self, cursor: &HistoryCursor) -> Result<(), V2Error> {
        let path = self
            .catalog
            .resolve(match cursor.source() {
                SourceWitness::Rollout { .. } => cursor.thread_id().as_str(),
                SourceWitness::Live { .. } => return Err(stale_cursor()),
            })
            .map_err(|_| stale_cursor())?;
        let current = rollout_witness(&path, cursor.anchor())?;
        match (cursor.source(), current) {
            (
                SourceWitness::Rollout {
                    device,
                    inode,
                    anchor_hash,
                    durable_end,
                },
                SourceWitness::Rollout {
                    device: current_device,
                    inode: current_inode,
                    anchor_hash: current_hash,
                    durable_end: current_end,
                },
            ) if device == &current_device
                && inode == &current_inode
                && anchor_hash == &current_hash
                && current_end.get() >= durable_end.get() =>
            {
                Ok(())
            }
            _ => Err(stale_cursor()),
        }
    }

    fn remember_cursor_owner(&self, context: &AuthenticatedContextKey, cursor: &str) {
        let _ = self
            .history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(retained_cursor_key(context, cursor), ());
    }

    fn require_cursor_owner(
        &self,
        context: &AuthenticatedContextKey,
        cursor: &str,
    ) -> Result<(), V2Error> {
        self.history_cursor_owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&retained_cursor_key(context, cursor))
            .is_some()
            .then_some(())
            .ok_or_else(stale_cursor)
    }
}

pub(super) fn thread_agents_params(thread_id: &Id, cursor: Option<&str>, limit: u16) -> Value {
    json!({
        "cursor": cursor,
        "limit": limit,
        "sortKey": "updated_at",
        "sortDirection": "desc",
        "sourceKinds": [
            "subAgent",
            "subAgentReview",
            "subAgentCompact",
            "subAgentThreadSpawn",
            "subAgentOther"
        ],
        "archived": false,
        "parentThreadId": thread_id.as_str(),
        "useStateDbOnly": true
    })
}

#[cfg(test)]
mod agent_query_tests {
    use super::*;

    #[test]
    fn agent_query_uses_the_canonical_app_server_parent_filter() {
        let thread_id =
            Id::new("parent-thread").unwrap_or_else(|error| panic!("thread id failed: {error}"));

        let params = thread_agents_params(&thread_id, Some("page-2"), 37);

        assert_eq!(
            params.pointer("/parentThreadId"),
            Some(&json!("parent-thread"))
        );
        assert_eq!(params.pointer("/cursor"), Some(&json!("page-2")));
        assert_eq!(params.pointer("/limit"), Some(&json!(37)));
        assert_eq!(params.pointer("/useStateDbOnly"), Some(&json!(true)));
        assert_eq!(
            params.pointer("/sourceKinds"),
            Some(&json!([
                "subAgent",
                "subAgentReview",
                "subAgentCompact",
                "subAgentThreadSpawn",
                "subAgentOther"
            ]))
        );
    }
}

fn thread_freshness_witness(thread: &Value) -> ThreadFreshnessWitness {
    let active = match thread.pointer("/status/type").and_then(Value::as_str) {
        Some("active") => Some(true),
        Some("idle" | "notLoaded" | "systemError") => Some(false),
        _ => None,
    };
    ThreadFreshnessWitness {
        recency_at: thread.get("recencyAt").and_then(Value::as_i64),
        active,
    }
}

fn initial_history_params(
    thread_id: &Id,
    cursor: Option<&str>,
    limit: u16,
    freshness: ThreadFreshnessWitness,
) -> Value {
    let mut params = json!({
        "threadId": thread_id.as_str(),
        "cursor": cursor,
        "limit": limit,
        "sortDirection": "desc",
        "itemsView": "summary"
    });
    if let Some(object) = params.as_object_mut() {
        if let Some(recency_at) = freshness.recency_at {
            object.insert("expectedRecencyAt".into(), Value::from(recency_at));
        }
        if let Some(active) = freshness.active {
            object.insert("expectedThreadActive".into(), Value::Bool(active));
        }
    }
    params
}

fn opaque_turn_items_cursor(
    context: &AuthenticatedContextKey,
    thread_id: &Id,
    turn_id: &Id,
    generation: u64,
    source_cursor: &str,
) -> String {
    let witness = format!(
        "{}\0{}\0{}\0{generation}\0{source_cursor}",
        context.as_str(),
        thread_id.as_str(),
        turn_id.as_str()
    );
    format!(
        "v2-turn-items:{}",
        blake3::hash(witness.as_bytes()).to_hex()
    )
}

fn opaque_item_output_cursor(
    context: &AuthenticatedContextKey,
    witness: &ItemOutputCursorWitness,
) -> String {
    let witness = format!(
        "{}\0{}\0{}\0{}\0{}\0{}\0{}",
        context.as_str(),
        witness.thread_id.as_str(),
        witness.turn_id.as_str(),
        witness.item_id.as_str(),
        witness.generation,
        witness.offset,
        witness.output_hash,
    );
    format!(
        "v2-item-output:{}",
        blake3::hash(witness.as_bytes()).to_hex()
    )
}

fn resolve_turn_items_cursor_witness(
    cursors: &BoundedMap<String, TurnItemsCursorWitness>,
    key: &String,
    thread_id: &Id,
    turn_id: &Id,
    generation: u64,
) -> Result<String, V2Error> {
    let witness = cursors.get(key).ok_or_else(stale_cursor)?;
    if witness.thread_id != *thread_id
        || witness.turn_id != *turn_id
        || witness.generation != generation
    {
        return Err(stale_cursor());
    }
    Ok(witness.source_cursor.clone())
}

fn resolve_item_output_cursor_witness(
    cursors: &BoundedMap<String, ItemOutputCursorWitness>,
    key: &String,
    thread_id: &Id,
    turn_id: &Id,
    item_id: &Id,
    generation: u64,
) -> Result<ItemOutputCursorWitness, V2Error> {
    let witness = cursors.get(key).ok_or_else(stale_cursor)?;
    if witness.thread_id != *thread_id
        || witness.turn_id != *turn_id
        || witness.item_id != *item_id
        || witness.generation != generation
    {
        return Err(stale_cursor());
    }
    Ok(witness.clone())
}

const fn opposite_history_direction(direction: HistoryDirection) -> HistoryDirection {
    match direction {
        HistoryDirection::Older => HistoryDirection::Newer,
        HistoryDirection::Newer => HistoryDirection::Older,
    }
}

fn retained_cursor_key(context: &AuthenticatedContextKey, value: &str) -> String {
    format!("{}#{value}", context.as_str())
}

pub(super) fn source_catalog_cursor(result: &Value) -> Option<&str> {
    result.get("nextCursor").and_then(Value::as_str)
}

pub(super) fn final_agent_activity_marker(turn: &TurnView) -> Option<String> {
    turn.items.iter().rev().find_map(|item| match item {
        Item::AssistantText { id, text, .. } if !text.is_empty() => Some(id.as_str().to_owned()),
        _ => None,
    })
}

pub(super) fn merge_turn_display_metadata(
    source: &Value,
    local_metadata: &HashMap<String, Value>,
) -> Value {
    let Some(turn_id) = source.get("id").and_then(Value::as_str) else {
        return source.clone();
    };
    let Some(local) = local_metadata.get(turn_id) else {
        return source.clone();
    };
    let Some(local_codewide) = local.get("codewide").and_then(Value::as_object) else {
        return source.clone();
    };
    let mut enriched = source.clone();
    let Some(enriched_object) = enriched.as_object_mut() else {
        return enriched;
    };
    let codewide = enriched_object
        .entry("codewide")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(codewide) = codewide.as_object_mut() else {
        return enriched;
    };
    for key in ["activity", "usage"] {
        if let Some(value) = local_codewide.get(key) {
            codewide.insert(key.to_owned(), value.clone());
        }
    }
    enriched
}

pub(super) fn with_cached_thread_settings(
    mut thread: crate::sync_v2::domain::ThreadSummary,
    settings: Option<&crate::sync_v2::domain::ThreadSettings>,
) -> crate::sync_v2::domain::ThreadSummary {
    if thread.settings.is_none() {
        thread.settings = settings.cloned();
    }
    thread
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::auth::AuthorizationContext;

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.to_owned(),
            scopes: vec!["threads.read".into()],
            expires_at: u64::MAX,
        })
        .unwrap()
    }

    #[test]
    fn resume_freshness_preserves_app_server_recency_and_lifecycle() {
        assert_eq!(
            thread_freshness_witness(&json!({
                "id": "thread-1",
                "recencyAt": 42,
                "status": {"type": "active", "activeFlags": []}
            })),
            ThreadFreshnessWitness {
                recency_at: Some(42),
                active: Some(true),
            }
        );
        assert_eq!(
            thread_freshness_witness(&json!({
                "id": "thread-1",
                "recencyAt": 43,
                "status": {"type": "systemError"}
            })),
            ThreadFreshnessWitness {
                recency_at: Some(43),
                active: Some(false),
            }
        );
    }

    #[test]
    fn initial_history_page_carries_authoritative_freshness_guards() {
        let params = initial_history_params(
            &Id::new("thread-1").unwrap(),
            None,
            36,
            ThreadFreshnessWitness {
                recency_at: Some(42),
                active: Some(true),
            },
        );

        assert_eq!(params["limit"], json!(36));
        assert_eq!(params["expectedRecencyAt"], json!(42));
        assert_eq!(params["expectedThreadActive"], json!(true));
    }

    #[test]
    fn turn_items_cursor_is_opaque_and_bound_to_owner_thread_turn_and_generation() {
        let owner = context("device-a");
        let other_owner = context("device-b");
        let thread_id = Id::new("thread-1").unwrap();
        let other_thread_id = Id::new("thread-2").unwrap();
        let turn_id = Id::new("turn-1").unwrap();
        let other_turn_id = Id::new("turn-2").unwrap();
        let source_cursor = "raw-app-server-cursor";
        let cursor = opaque_turn_items_cursor(&owner, &thread_id, &turn_id, 7, source_cursor);
        assert!(!cursor.contains(source_cursor));

        let mut cursors = BoundedMap::new(8);
        let key = retained_cursor_key(&owner, &cursor);
        cursors.insert(
            key.clone(),
            TurnItemsCursorWitness {
                source_cursor: source_cursor.to_owned(),
                thread_id: thread_id.clone(),
                turn_id: turn_id.clone(),
                generation: 7,
            },
        );

        assert_eq!(
            resolve_turn_items_cursor_witness(&cursors, &key, &thread_id, &turn_id, 7).unwrap(),
            source_cursor
        );
        for result in [
            resolve_turn_items_cursor_witness(&cursors, &key, &other_thread_id, &turn_id, 7),
            resolve_turn_items_cursor_witness(&cursors, &key, &thread_id, &other_turn_id, 7),
            resolve_turn_items_cursor_witness(&cursors, &key, &thread_id, &turn_id, 8),
            resolve_turn_items_cursor_witness(
                &cursors,
                &retained_cursor_key(&other_owner, &cursor),
                &thread_id,
                &turn_id,
                7,
            ),
        ] {
            assert_eq!(result.unwrap_err().code, ErrorCode::StaleCursor);
        }
    }

    #[test]
    fn item_output_cursor_is_opaque_and_bound_to_owner_item_and_generation() {
        let owner = context("device-a");
        let other_owner = context("device-b");
        let thread_id = Id::new("thread-1").unwrap();
        let other_thread_id = Id::new("thread-2").unwrap();
        let turn_id = Id::new("turn-1").unwrap();
        let other_turn_id = Id::new("turn-2").unwrap();
        let item_id = Id::new("item-1").unwrap();
        let other_item_id = Id::new("item-2").unwrap();
        let output_hash = "authoritative-output-hash";
        let witness = ItemOutputCursorWitness {
            offset: 65_536,
            output_hash: output_hash.to_owned(),
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
            item_id: item_id.clone(),
            generation: 7,
        };
        let cursor = opaque_item_output_cursor(&owner, &witness);
        assert!(!cursor.contains(output_hash));

        let mut cursors = BoundedMap::new(8);
        let key = retained_cursor_key(&owner, &cursor);
        cursors.insert(key.clone(), witness.clone());

        assert_eq!(
            resolve_item_output_cursor_witness(&cursors, &key, &thread_id, &turn_id, &item_id, 7,)
                .unwrap(),
            witness,
        );
        for result in [
            resolve_item_output_cursor_witness(
                &cursors,
                &key,
                &other_thread_id,
                &turn_id,
                &item_id,
                7,
            ),
            resolve_item_output_cursor_witness(
                &cursors,
                &key,
                &thread_id,
                &other_turn_id,
                &item_id,
                7,
            ),
            resolve_item_output_cursor_witness(
                &cursors,
                &key,
                &thread_id,
                &turn_id,
                &other_item_id,
                7,
            ),
            resolve_item_output_cursor_witness(&cursors, &key, &thread_id, &turn_id, &item_id, 8),
            resolve_item_output_cursor_witness(
                &cursors,
                &retained_cursor_key(&other_owner, &cursor),
                &thread_id,
                &turn_id,
                &item_id,
                7,
            ),
        ] {
            assert_eq!(result.unwrap_err().code, ErrorCode::StaleCursor);
        }
    }
}
