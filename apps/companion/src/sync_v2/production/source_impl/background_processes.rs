use super::*;

impl UpstreamSemanticSource {
    pub(super) async fn background_processes(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        thread_id: Id,
        cursor: Option<String>,
        limit: u16,
    ) -> Result<QueryResult, V2Error> {
        let source_cursor = self.resolve_background_process_cursor(
            context,
            &thread_id,
            generation,
            cursor.as_deref(),
        )?;
        let result = self
            .rpc(
                "thread/backgroundTerminals/list",
                json!({
                    "threadId": thread_id.as_str(),
                    "cursor": source_cursor,
                    "limit": limit,
                }),
            )
            .await?;
        let entries = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                V2Error::source_unavailable("thread/backgroundTerminals/list omitted data")
            })?;
        if entries.len() > usize::from(limit) {
            return Err(V2Error::source_unavailable(
                "background process source exceeded record limit",
            ));
        }
        let processes = entries
            .iter()
            .map(parse_background_process)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = optional_string_field(&result, "nextCursor", "background process list")?
            .map(|source_cursor| {
                self.wrap_background_process_cursor(context, &thread_id, generation, &source_cursor)
            });
        Ok(QueryResult::ThreadProcesses {
            thread_id,
            processes,
            next_cursor,
        })
    }

    fn resolve_background_process_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
        cursor: Option<&str>,
    ) -> Result<Option<String>, V2Error> {
        let Some(cursor) = cursor else {
            return Ok(None);
        };
        let key = background_cursor_key(context, cursor);
        let cursors = self
            .background_process_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolve_background_process_cursor_witness(&cursors, &key, thread_id, generation).map(Some)
    }

    fn wrap_background_process_cursor(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        generation: u64,
        source_cursor: &str,
    ) -> String {
        let cursor =
            opaque_background_process_cursor(context, thread_id, generation, source_cursor);
        let key = background_cursor_key(context, &cursor);
        let _ = self
            .background_process_cursors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                key,
                BackgroundProcessCursorWitness {
                    source_cursor: source_cursor.to_owned(),
                    thread_id: thread_id.clone(),
                    generation,
                },
            );
        cursor
    }
}

fn opaque_background_process_cursor(
    context: &AuthenticatedContextKey,
    thread_id: &Id,
    generation: u64,
    source_cursor: &str,
) -> String {
    let witness = format!(
        "{}\0{}\0{generation}\0{source_cursor}",
        context.as_str(),
        thread_id.as_str(),
    );
    format!(
        "v2-background-processes:{}",
        blake3::hash(witness.as_bytes()).to_hex()
    )
}

fn background_cursor_key(context: &AuthenticatedContextKey, cursor: &str) -> String {
    format!("{}#{cursor}", context.as_str())
}

fn resolve_background_process_cursor_witness(
    cursors: &BoundedMap<String, BackgroundProcessCursorWitness>,
    key: &String,
    thread_id: &Id,
    generation: u64,
) -> Result<String, V2Error> {
    let witness = cursors.get(key).ok_or_else(stale_cursor)?;
    if witness.thread_id != *thread_id || witness.generation != generation {
        return Err(stale_cursor());
    }
    Ok(witness.source_cursor.clone())
}

fn parse_background_process(value: &Value) -> Result<BackgroundProcess, V2Error> {
    Ok(BackgroundProcess {
        item_id: required_id_field(value, "itemId")?,
        process_id: required_id_field(value, "processId")?,
        command: required_string_field(value, "command", "background process")?,
        cwd: required_string_field(value, "cwd", "background process")?,
        os_pid: optional_u64_field(value, "osPid")?,
        cpu_percent: optional_cpu_percent(value)?,
        rss_ki_b: optional_u64_field(value, "rssKb")?,
    })
}

fn required_id_field(value: &Value, field: &str) -> Result<Id, V2Error> {
    let raw = value.get(field).and_then(Value::as_str).ok_or_else(|| {
        V2Error::source_unavailable(format!("background process omitted {field}"))
    })?;
    Id::new(raw.to_owned())
        .map_err(|_| V2Error::source_unavailable(format!("background process has invalid {field}")))
}

fn optional_u64_field(value: &Value, field: &str) -> Result<Option<U64>, V2Error> {
    match value.get(field) {
        Some(Value::Null) => Ok(None),
        Some(number) => number
            .as_u64()
            .map(|value| Some(U64::new(value)))
            .ok_or_else(|| {
                V2Error::source_unavailable(format!("background process has invalid {field}"))
            }),
        None => Err(V2Error::source_unavailable(format!(
            "background process omitted {field}"
        ))),
    }
}

fn optional_cpu_percent(value: &Value) -> Result<Option<f64>, V2Error> {
    match value.get("cpuPercent") {
        Some(Value::Null) => Ok(None),
        Some(number) => {
            let percent = number
                .as_f64()
                .filter(|value| value.is_finite() && *value >= 0.0);
            percent.map(Some).ok_or_else(|| {
                V2Error::source_unavailable("background process has invalid cpuPercent")
            })
        }
        None => Err(V2Error::source_unavailable(
            "background process omitted cpuPercent",
        )),
    }
}

fn optional_string_field(
    value: &Value,
    field: &str,
    label: &str,
) -> Result<Option<String>, V2Error> {
    match value.get(field) {
        Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|value| Some(value.to_owned()))
            .ok_or_else(|| V2Error::source_unavailable(format!("{label} has invalid {field}"))),
        None => Err(V2Error::source_unavailable(format!(
            "{label} omitted {field}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(device_id: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&AuthorizationContext::Session {
            device_id: device_id.into(),
            expires_at: u64::MAX,
        })
        .unwrap_or_else(|error| panic!("authenticated context failed: {:?}", error.code))
    }

    #[test]
    fn parses_nullable_process_metrics_without_fabricating_values() -> Result<(), V2Error> {
        let parsed = parse_background_process(&json!({
            "itemId": "item-1",
            "processId": "process-1",
            "command": "pnpm test",
            "cwd": "/workspace",
            "osPid": null,
            "cpuPercent": null,
            "rssKb": null,
        }))?;

        assert_eq!(parsed.os_pid, None);
        assert_eq!(parsed.cpu_percent, None);
        assert_eq!(parsed.rss_ki_b, None);
        Ok(())
    }

    #[test]
    fn rejects_malformed_process_metrics() {
        let result = parse_background_process(&json!({
            "itemId": "item-1",
            "processId": "process-1",
            "command": "pnpm test",
            "cwd": "/workspace",
            "osPid": -1,
            "cpuPercent": 1,
            "rssKb": 12,
        }));

        assert!(result.is_err());
    }

    #[test]
    fn process_cursor_is_opaque_and_bound_to_owner_thread_and_generation() {
        let owner = context("owner-a");
        let other_owner = context("owner-b");
        let thread = Id::new("thread-a").unwrap_or_else(|error| panic!("thread: {error}"));
        let other_thread =
            Id::new("thread-b").unwrap_or_else(|error| panic!("other thread: {error}"));
        let raw = "raw-app-server-cursor";
        let cursor = opaque_background_process_cursor(&owner, &thread, 7, raw);
        assert!(!cursor.contains(raw));
        let key = background_cursor_key(&owner, &cursor);
        let mut cursors = BoundedMap::new(8);
        cursors.insert(
            key.clone(),
            BackgroundProcessCursorWitness {
                source_cursor: raw.to_owned(),
                thread_id: thread.clone(),
                generation: 7,
            },
        );

        assert_eq!(
            resolve_background_process_cursor_witness(&cursors, &key, &thread, 7)
                .unwrap_or_else(|error| panic!("matching cursor failed: {:?}", error.code)),
            raw
        );
        for result in [
            resolve_background_process_cursor_witness(&cursors, &key, &other_thread, 7),
            resolve_background_process_cursor_witness(&cursors, &key, &thread, 8),
            resolve_background_process_cursor_witness(
                &cursors,
                &background_cursor_key(&other_owner, &cursor),
                &thread,
                7,
            ),
            resolve_background_process_cursor_witness(
                &cursors,
                &background_cursor_key(&owner, raw),
                &thread,
                7,
            ),
        ] {
            let Err(error) = result else {
                panic!("cursor must be stale");
            };
            assert_eq!(error.code, ErrorCode::StaleCursor);
        }
    }
}
