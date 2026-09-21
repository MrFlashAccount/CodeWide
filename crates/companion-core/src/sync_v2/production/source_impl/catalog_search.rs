//! Authoritative, bounded catalog search through the App Server index.

use super::*;

const MAX_CATALOG_SEARCH_CURSOR_BYTES: usize = 8 * 1_024;

impl UpstreamSemanticSource {
    pub(super) async fn catalog_search(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        partition: CatalogPartition,
        text: String,
        cursor: Option<String>,
        limit: u16,
    ) -> Result<QueryResult, V2Error> {
        let text = normalize_catalog_search_text(&text)?;
        let source_cursor = self.resolve_catalog_search_cursor(
            context,
            generation,
            partition,
            &text,
            cursor.as_deref(),
        )?;
        let result = self
            .rpc(
                "thread/search",
                catalog_search_params(partition, &text, source_cursor.as_deref(), limit),
            )
            .await?;
        let source_results = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("thread/search omitted data"))?;
        if source_results.len() > usize::from(limit) {
            return Err(V2Error::source_unavailable(
                "catalog search source exceeded record limit",
            ));
        }

        let mut threads = Vec::with_capacity(source_results.len());
        for source_result in source_results {
            let source_thread = source_result.get("thread").ok_or_else(|| {
                V2Error::source_unavailable("thread/search result omitted thread")
            })?;
            if !normalize::is_user_catalog_thread(source_thread) {
                continue;
            }
            let mut thread = normalize::thread_summary_in_partition(
                source_thread,
                partition == CatalogPartition::Archived,
            )?;
            self.attach_read_state(context, &mut thread)?;
            threads.push(thread);
        }

        let source_next_cursor = catalog_search_cursor(&result)?;
        if source_next_cursor.as_ref() == source_cursor.as_ref() && source_next_cursor.is_some() {
            return Err(V2Error::source_unavailable(
                "catalog search source returned a repeated cursor",
            ));
        }
        ensure_generation(self, generation)?;
        for thread in &threads {
            self.record_thread_access(context, &thread.id, generation);
        }
        let next_cursor = source_next_cursor
            .map(|source_cursor| {
                self.wrap_catalog_search_cursor(
                    context,
                    generation,
                    partition,
                    &text,
                    source_cursor,
                )
            })
            .transpose()?;
        Ok(QueryResult::CatalogSearch {
            threads,
            next_cursor,
        })
    }

    fn resolve_catalog_search_cursor(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        partition: CatalogPartition,
        text: &str,
        cursor: Option<&str>,
    ) -> Result<Option<String>, V2Error> {
        let Some(cursor) = cursor else {
            return Ok(None);
        };
        if cursor.len() > MAX_CATALOG_SEARCH_CURSOR_BYTES {
            return Err(invalid_catalog_search_cursor());
        }
        let key = catalog_search_cursor_key(context, cursor);
        let cursors = self
            .catalog_search_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let witness = cursors
            .get(&key)
            .ok_or_else(invalid_catalog_search_cursor)?;
        if witness.generation != generation
            || witness.partition != partition
            || witness.query_hash != catalog_search_query_hash(text)
        {
            return Err(invalid_catalog_search_cursor());
        }
        Ok(Some(witness.source_cursor.clone()))
    }

    fn wrap_catalog_search_cursor(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        partition: CatalogPartition,
        text: &str,
        source_cursor: String,
    ) -> Result<String, V2Error> {
        if source_cursor.len() > MAX_CATALOG_SEARCH_CURSOR_BYTES {
            return Err(V2Error::source_unavailable(
                "thread/search cursor exceeded byte limit",
            ));
        }
        let query_hash = catalog_search_query_hash(text);
        let opaque = opaque_catalog_search_cursor(
            context,
            generation,
            partition,
            &query_hash,
            &source_cursor,
        );
        let key = catalog_search_cursor_key(context, &opaque);
        let _ = self
            .catalog_search_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                key,
                CatalogSearchCursorWitness {
                    source_cursor,
                    partition,
                    query_hash,
                    generation,
                },
            );
        Ok(opaque)
    }
}

fn normalize_catalog_search_text(text: &str) -> Result<String, V2Error> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 256 || text.len() > 1_024 {
        return Err(V2Error::invalid_request(
            "catalog search text must contain between 1 and 256 code points and at most 1024 bytes",
        ));
    }
    Ok(text.to_owned())
}

fn catalog_search_params(
    partition: CatalogPartition,
    text: &str,
    cursor: Option<&str>,
    limit: u16,
) -> Value {
    json!({
        "archived": partition == CatalogPartition::Archived,
        "cursor": cursor,
        "limit": limit,
        "searchTerm": text,
        "sortDirection": "desc",
        "sortKey": "updated_at",
        "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
    })
}

fn catalog_search_cursor(result: &Value) -> Result<Option<String>, V2Error> {
    match result.get("nextCursor") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(cursor)) if cursor.len() <= MAX_CATALOG_SEARCH_CURSOR_BYTES => {
            Ok(Some(cursor.clone()))
        }
        Some(Value::String(_)) => Err(V2Error::source_unavailable(
            "thread/search cursor exceeded byte limit",
        )),
        Some(_) => Err(V2Error::source_unavailable(
            "thread/search has invalid nextCursor",
        )),
        None => Err(V2Error::source_unavailable(
            "thread/search omitted nextCursor",
        )),
    }
}

fn opaque_catalog_search_cursor(
    context: &AuthenticatedContextKey,
    generation: u64,
    partition: CatalogPartition,
    query_hash: &str,
    source_cursor: &str,
) -> String {
    let witness = format!(
        "{}\0{generation}\0{}\0{query_hash}\0{source_cursor}",
        context.as_str(),
        catalog_partition_name(partition),
    );
    format!(
        "v2-catalog-search:{}",
        blake3::hash(witness.as_bytes()).to_hex()
    )
}

fn catalog_search_cursor_key(context: &AuthenticatedContextKey, cursor: &str) -> String {
    format!("{}#{cursor}", context.as_str())
}

fn catalog_search_query_hash(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}

const fn catalog_partition_name(partition: CatalogPartition) -> &'static str {
    match partition {
        CatalogPartition::Active => "active",
        CatalogPartition::Archived => "archived",
    }
}

fn invalid_catalog_search_cursor() -> V2Error {
    V2Error {
        code: ErrorCode::InvalidCursor,
        recovery: Recovery::None,
        message: "catalog search cursor is invalid for this owner, query, or partition".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_text_is_trimmed_and_bounded_by_code_points_and_utf8_bytes() {
        assert_eq!(
            normalize_catalog_search_text("  indexed needle  ")
                .unwrap_or_else(|error| panic!("search text should normalize: {error:?}")),
            "indexed needle"
        );
        assert!(normalize_catalog_search_text(" \n\t ").is_err());
        assert!(normalize_catalog_search_text(&"x".repeat(257)).is_err());
        assert!(normalize_catalog_search_text(&"🦀".repeat(256)).is_ok());
        assert!(normalize_catalog_search_text(&format!("{}a", "🦀".repeat(256))).is_err());
    }

    #[test]
    fn search_parameters_use_the_authoritative_index_and_preserve_cursor() {
        assert_eq!(
            catalog_search_params(
                CatalogPartition::Archived,
                "needle",
                Some("opaque/source cursor"),
                37,
            ),
            json!({
                "archived": true,
                "cursor": "opaque/source cursor",
                "limit": 37,
                "searchTerm": "needle",
                "sortDirection": "desc",
                "sortKey": "updated_at",
                "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
            })
        );
    }

    #[test]
    fn source_cursor_is_required_nullable_and_bounded() {
        assert_eq!(
            catalog_search_cursor(&json!({"nextCursor": "opaque"}))
                .unwrap_or_else(|error| panic!("cursor should parse: {error:?}")),
            Some("opaque".to_owned())
        );
        assert_eq!(
            catalog_search_cursor(&json!({"nextCursor": null}))
                .unwrap_or_else(|error| panic!("null cursor should parse: {error:?}")),
            None
        );
        assert!(catalog_search_cursor(&json!({})).is_err());
        assert!(catalog_search_cursor(&json!({"nextCursor": 1})).is_err());
        assert!(
            catalog_search_cursor(
                &json!({"nextCursor": "x".repeat(MAX_CATALOG_SEARCH_CURSOR_BYTES + 1)})
            )
            .is_err()
        );
    }
}
