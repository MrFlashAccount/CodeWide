use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use redb::{Database, ReadableDatabase, ReadableTable, ReadableTableMetadata, TableDefinition};
use serde::{Deserialize, Serialize};

const META: TableDefinition<&str, u64> = TableDefinition::new("meta");
const EVENTS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("events");
const EVENT_IDS: TableDefinition<&str, &[u8]> = TableDefinition::new("event_ids");
const SCHEMA_VERSION: u64 = 1;
const MAX_BATCH_EVENTS: usize = 128;
const MAX_EVENTS: u64 = 200_000;
const RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_QUERY_LIMIT: usize = 5_000;
const JSONL_SEGMENT_BYTES: u64 = 64 * 1024 * 1024;
const JSONL_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const JSONL_ACTIVE_FILE: &str = "events.jsonl";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryBatch {
    pub version: u32,
    pub batch_id: String,
    pub sent_at_unix_ms: u64,
    pub client_session_id: String,
    pub app_version: Option<String>,
    pub events: Vec<TelemetryEvent>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryEvent {
    pub event_id: String,
    pub occurred_at_unix_ms: u64,
    pub name: String,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub connection_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    #[serde(default)]
    pub values: BTreeMap<String, f64>,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTelemetryEvent {
    pub received_at_unix_ms: u64,
    pub device_id: String,
    pub batch_id: String,
    pub client_session_id: String,
    pub app_version: Option<String>,
    #[serde(flatten)]
    pub event: TelemetryEvent,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryQuery {
    pub from_unix_ms: Option<u64>,
    pub to_unix_ms: Option<u64>,
    pub device_id: Option<String>,
    pub batch_id: Option<String>,
    pub client_session_id: Option<String>,
    pub event_id: Option<String>,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub connection_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub name: Option<String>,
    pub tag_name: Option<String>,
    pub tag_value: Option<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryIngestReport {
    pub accepted: usize,
    pub duplicates: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryPage {
    pub events: Vec<StoredTelemetryEvent>,
}

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("invalid telemetry: {0}")]
    Invalid(String),
    #[error(transparent)]
    Database(#[from] redb::Error),
    #[error(transparent)]
    DatabaseOpen(#[from] redb::DatabaseError),
    #[error(transparent)]
    Transaction(#[from] redb::TransactionError),
    #[error(transparent)]
    Table(#[from] redb::TableError),
    #[error(transparent)]
    Storage(#[from] redb::StorageError),
    #[error(transparent)]
    Commit(#[from] redb::CommitError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub struct TelemetryStore {
    database: Database,
    enabled: AtomicBool,
    settings_path: Option<PathBuf>,
    jsonl: Option<Mutex<TelemetryJsonlSink>>,
}

struct TelemetryJsonlSink {
    directory: PathBuf,
    segment_bytes: u64,
    max_files: usize,
}

impl TelemetryStore {
    /// Opens or creates the isolated telemetry database.
    ///
    /// # Errors
    ///
    /// Returns an error when the database cannot be opened or has an unsupported schema.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, TelemetryError> {
        let database = Database::create(path)?;
        let write = database.begin_write()?;
        {
            let mut meta = write.open_table(META)?;
            let schema_version = meta.get("schema_version")?.map(|value| value.value());
            match schema_version {
                Some(SCHEMA_VERSION) => {}
                Some(version) => {
                    return Err(TelemetryError::Invalid(format!(
                        "unsupported telemetry schema version {version}"
                    )));
                }
                None => {
                    meta.insert("schema_version", SCHEMA_VERSION)?;
                    meta.insert("next_sequence", 1)?;
                }
            }
            write.open_table(EVENTS)?;
            write.open_table(EVENT_IDS)?;
        }
        write.commit()?;
        Ok(Self {
            database,
            enabled: AtomicBool::new(true),
            settings_path: None,
            jsonl: None,
        })
    }

    /// Opens telemetry and mirrors accepted events to bounded rotated JSONL files.
    ///
    /// # Errors
    ///
    /// Returns an error when the database or JSONL directory cannot be opened.
    pub fn open_with_jsonl(
        database_path: impl AsRef<Path>,
        jsonl_directory: impl AsRef<Path>,
    ) -> Result<Self, TelemetryError> {
        let mut store = Self::open(database_path)?;
        store.jsonl = Some(Mutex::new(TelemetryJsonlSink::open(
            jsonl_directory,
            JSONL_SEGMENT_BYTES,
            JSONL_TOTAL_BYTES,
        )?));
        Ok(store)
    }

    /// Opens telemetry with a persistent, disabled-by-default collection setting.
    ///
    /// # Errors
    ///
    /// Returns an error when the database or settings file cannot be read.
    pub fn open_configured(
        database_path: impl AsRef<Path>,
        settings_path: impl AsRef<Path>,
    ) -> Result<Self, TelemetryError> {
        let mut store = Self::open(database_path)?;
        let settings_path = settings_path.as_ref().to_path_buf();
        let enabled = match std::fs::read(&settings_path) {
            Ok(bytes) => serde_json::from_slice::<TelemetrySettings>(&bytes)?.enabled,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        store.enabled = AtomicBool::new(enabled);
        store.settings_path = Some(settings_path);
        Ok(store)
    }

    #[must_use]
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Persists and applies the collection setting.
    ///
    /// # Errors
    ///
    /// Returns an error when the settings file cannot be written atomically.
    pub fn set_enabled(&self, enabled: bool) -> Result<(), TelemetryError> {
        if let Some(path) = &self.settings_path {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temporary = path.with_extension("json.tmp");
            std::fs::write(
                &temporary,
                serde_json::to_vec(&TelemetrySettings { enabled })?,
            )?;
            std::fs::rename(temporary, path)?;
        }
        self.enabled.store(enabled, Ordering::Relaxed);
        Ok(())
    }

    /// Validates and atomically stores one device telemetry batch.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid batch or a storage failure.
    pub fn ingest(
        &self,
        device_id: &str,
        batch: TelemetryBatch,
    ) -> Result<TelemetryIngestReport, TelemetryError> {
        validate_identifier(device_id, "deviceId")?;
        validate_batch(&batch)?;
        let received_at = now_unix_ms();
        let write = self.database.begin_write()?;
        let mut accepted = 0;
        let mut duplicates = 0;
        let mut accepted_events = Vec::new();
        {
            let mut meta = write.open_table(META)?;
            let mut events = write.open_table(EVENTS)?;
            let mut event_ids = write.open_table(EVENT_IDS)?;
            let mut sequence = meta.get("next_sequence")?.map_or(1, |value| value.value());
            for event in batch.events {
                let dedupe_id = format!("{device_id}\0{}", event.event_id);
                if event_ids.get(dedupe_id.as_str())?.is_some() {
                    duplicates += 1;
                    continue;
                }
                let key = event_key(received_at, sequence);
                sequence = sequence.saturating_add(1);
                let stored = StoredTelemetryEvent {
                    received_at_unix_ms: received_at,
                    device_id: device_id.to_owned(),
                    batch_id: batch.batch_id.clone(),
                    client_session_id: batch.client_session_id.clone(),
                    app_version: batch.app_version.clone(),
                    event,
                };
                let encoded = serde_json::to_vec(&stored)?;
                events.insert(key.as_slice(), encoded.as_slice())?;
                event_ids.insert(dedupe_id.as_str(), key.as_slice())?;
                accepted_events.push(stored);
                accepted += 1;
            }
            meta.insert("next_sequence", sequence)?;

            // Write the diagnostic journal before committing the dedupe index.
            // A retry after a failed DB commit may duplicate a JSONL line, but
            // eventId makes that explicit and prevents silently losing the
            // file record after a successful database commit.
            if !accepted_events.is_empty()
                && let Some(sink) = &self.jsonl
            {
                sink.lock()
                    .map_err(|_| {
                        TelemetryError::Invalid("telemetry JSONL lock is poisoned".into())
                    })?
                    .append(&accepted_events)?;
            }

            let cutoff = received_at.saturating_sub(RETENTION_MS);
            let excess = events.len()?.saturating_sub(MAX_EVENTS);
            let mut expired = Vec::new();
            for entry in events.iter()? {
                let (key, value) = entry?;
                let key_bytes = key.value();
                let timestamp = decode_event_time(key_bytes)?;
                if timestamp >= cutoff && u64::try_from(expired.len()).unwrap_or(u64::MAX) >= excess
                {
                    break;
                }
                let stored: StoredTelemetryEvent = serde_json::from_slice(value.value())?;
                expired.push((
                    key_bytes.to_vec(),
                    format!("{}\0{}", stored.device_id, stored.event.event_id),
                ));
            }
            for (key, dedupe_id) in expired {
                events.remove(key.as_slice())?;
                event_ids.remove(dedupe_id.as_str())?;
            }
        }
        write.commit()?;
        Ok(TelemetryIngestReport {
            accepted,
            duplicates,
        })
    }

    /// Reads a bounded, time-ordered page matching explicit dimensions.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid filters or a storage failure.
    pub fn query(&self, query: &TelemetryQuery) -> Result<TelemetryPage, TelemetryError> {
        validate_query(query)?;
        let from = query.from_unix_ms.unwrap_or(0);
        let to = query.to_unix_ms.unwrap_or(u64::MAX);
        let limit = query.limit.unwrap_or(500).min(MAX_QUERY_LIMIT);
        if limit == 0 || from > to {
            return Ok(TelemetryPage { events: Vec::new() });
        }
        let read = self.database.begin_read()?;
        let table = read.open_table(EVENTS)?;
        let start = event_key(from, 0);
        let end = event_key(to, u64::MAX);
        let range = table.range(start.as_slice()..=end.as_slice())?;
        let mut output = Vec::with_capacity(limit);
        if query.descending {
            for entry in range.rev() {
                collect_match(entry?, query, limit, &mut output)?;
                if output.len() == limit {
                    break;
                }
            }
        } else {
            for entry in range {
                collect_match(entry?, query, limit, &mut output)?;
                if output.len() == limit {
                    break;
                }
            }
        }
        Ok(TelemetryPage { events: output })
    }
}

impl TelemetryJsonlSink {
    fn open(
        directory: impl AsRef<Path>,
        segment_bytes: u64,
        total_bytes: u64,
    ) -> Result<Self, TelemetryError> {
        if segment_bytes == 0 || total_bytes < segment_bytes {
            return Err(TelemetryError::Invalid(
                "telemetry JSONL limits must retain at least one segment".into(),
            ));
        }
        let directory = directory.as_ref().to_path_buf();
        fs::create_dir_all(&directory)?;
        set_private_directory_permissions(&directory)?;
        let max_files = usize::try_from(total_bytes / segment_bytes)
            .unwrap_or(usize::MAX)
            .max(1);
        let sink = Self {
            directory,
            segment_bytes,
            max_files,
        };
        sink.remove_excess_archives()?;
        Ok(sink)
    }

    fn append(&mut self, events: &[StoredTelemetryEvent]) -> Result<(), TelemetryError> {
        let mut encoded = Vec::new();
        for event in events {
            serde_json::to_writer(&mut encoded, event)?;
            encoded.push(b'\n');
        }
        if encoded.is_empty() {
            return Ok(());
        }
        if u64::try_from(encoded.len()).unwrap_or(u64::MAX) > self.segment_bytes {
            return Err(TelemetryError::Invalid(
                "telemetry JSONL batch exceeds the segment limit".into(),
            ));
        }
        let active = self.directory.join(JSONL_ACTIVE_FILE);
        let active_bytes = fs::metadata(&active).map_or(0, |metadata| metadata.len());
        if active_bytes > 0
            && active_bytes.saturating_add(u64::try_from(encoded.len()).unwrap_or(u64::MAX))
                > self.segment_bytes
        {
            self.rotate()?;
        }
        let mut file = private_append_file(&active)?;
        file.write_all(&encoded)?;
        file.flush()?;
        Ok(())
    }

    fn rotate(&self) -> Result<(), TelemetryError> {
        if self.max_files <= 1 {
            remove_if_exists(&self.directory.join(JSONL_ACTIVE_FILE))?;
            return Ok(());
        }
        remove_if_exists(&self.archive_path(self.max_files - 1))?;
        for index in (1..self.max_files - 1).rev() {
            let source = self.archive_path(index);
            if source.exists() {
                fs::rename(source, self.archive_path(index + 1))?;
            }
        }
        let active = self.directory.join(JSONL_ACTIVE_FILE);
        if active.exists() {
            fs::rename(active, self.archive_path(1))?;
        }
        Ok(())
    }

    fn remove_excess_archives(&self) -> Result<(), TelemetryError> {
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let Some(index) = archive_index(name) else {
                continue;
            };
            if index >= self.max_files {
                remove_if_exists(&entry.path())?;
            }
        }
        Ok(())
    }

    fn archive_path(&self, index: usize) -> PathBuf {
        self.directory.join(format!("events.{index}.jsonl"))
    }
}

fn archive_index(name: &str) -> Option<usize> {
    name.strip_prefix("events.")?
        .strip_suffix(".jsonl")?
        .parse()
        .ok()
}

fn remove_if_exists(path: &Path) -> Result<(), std::io::Error> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn private_append_file(path: &Path) -> Result<std::fs::File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    set_private_file_permissions(path)?;
    Ok(file)
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetrySettings {
    pub enabled: bool,
}

fn collect_match(
    (_key, value): (redb::AccessGuard<&[u8]>, redb::AccessGuard<&[u8]>),
    query: &TelemetryQuery,
    limit: usize,
    output: &mut Vec<StoredTelemetryEvent>,
) -> Result<(), TelemetryError> {
    if output.len() >= limit {
        return Ok(());
    }
    let event: StoredTelemetryEvent = serde_json::from_slice(value.value())?;
    let matches = optional_eq(query.device_id.as_ref(), Some(&event.device_id))
        && optional_eq(query.batch_id.as_ref(), Some(&event.batch_id))
        && optional_eq(
            query.client_session_id.as_ref(),
            Some(&event.client_session_id),
        )
        && optional_eq(query.event_id.as_ref(), Some(&event.event.event_id))
        && optional_eq(query.session_id.as_ref(), event.event.session_id.as_ref())
        && optional_eq(query.request_id.as_ref(), event.event.request_id.as_ref())
        && optional_eq(
            query.connection_id.as_ref(),
            event.event.connection_id.as_ref(),
        )
        && optional_eq(query.thread_id.as_ref(), event.event.thread_id.as_ref())
        && optional_eq(query.turn_id.as_ref(), event.event.turn_id.as_ref())
        && optional_eq(query.item_id.as_ref(), event.event.item_id.as_ref())
        && optional_eq(query.name.as_ref(), Some(&event.event.name))
        && query
            .tag_name
            .as_ref()
            .is_none_or(|name| event.event.tags.get(name) == query.tag_value.as_ref());
    if matches {
        output.push(event);
    }
    Ok(())
}

fn optional_eq(filter: Option<&String>, value: Option<&String>) -> bool {
    filter.is_none_or(|filter| value == Some(filter))
}

fn validate_batch(batch: &TelemetryBatch) -> Result<(), TelemetryError> {
    if batch.version != 1 {
        return Err(TelemetryError::Invalid("version must be 1".into()));
    }
    validate_identifier(&batch.batch_id, "batchId")?;
    validate_identifier(&batch.client_session_id, "clientSessionId")?;
    if batch.events.is_empty() || batch.events.len() > MAX_BATCH_EVENTS {
        return Err(TelemetryError::Invalid(format!(
            "events must contain 1..={MAX_BATCH_EVENTS} entries"
        )));
    }
    if batch
        .app_version
        .as_ref()
        .is_some_and(|value| value.len() > 128)
    {
        return Err(TelemetryError::Invalid("appVersion is too long".into()));
    }
    for event in &batch.events {
        validate_event(event)?;
    }
    Ok(())
}

fn validate_event(event: &TelemetryEvent) -> Result<(), TelemetryError> {
    validate_identifier(&event.event_id, "eventId")?;
    validate_name(&event.name, "name")?;
    for (label, value) in [
        ("sessionId", &event.session_id),
        ("requestId", &event.request_id),
        ("connectionId", &event.connection_id),
        ("threadId", &event.thread_id),
        ("turnId", &event.turn_id),
        ("itemId", &event.item_id),
    ] {
        if let Some(value) = value {
            validate_identifier(value, label)?;
        }
    }
    if event.values.len() > 32 || event.tags.len() > 32 {
        return Err(TelemetryError::Invalid(
            "values and tags are limited to 32 entries each".into(),
        ));
    }
    for (name, value) in &event.values {
        validate_name(name, "value name")?;
        validate_attribute_name(name)?;
        if !value.is_finite() {
            return Err(TelemetryError::Invalid("values must be finite".into()));
        }
    }
    for (name, value) in &event.tags {
        validate_name(name, "tag name")?;
        validate_attribute_name(name)?;
        if value.len() > 256 {
            return Err(TelemetryError::Invalid("tag value is too long".into()));
        }
    }
    Ok(())
}

fn validate_query(query: &TelemetryQuery) -> Result<(), TelemetryError> {
    if query.limit.is_some_and(|limit| limit > MAX_QUERY_LIMIT) {
        return Err(TelemetryError::Invalid(format!(
            "limit must not exceed {MAX_QUERY_LIMIT}"
        )));
    }
    for (label, value) in [
        ("deviceId", &query.device_id),
        ("batchId", &query.batch_id),
        ("clientSessionId", &query.client_session_id),
        ("eventId", &query.event_id),
        ("sessionId", &query.session_id),
        ("requestId", &query.request_id),
        ("connectionId", &query.connection_id),
        ("threadId", &query.thread_id),
        ("turnId", &query.turn_id),
        ("itemId", &query.item_id),
    ] {
        if let Some(value) = value {
            validate_identifier(value, label)?;
        }
    }
    if let Some(name) = &query.name {
        validate_name(name, "name")?;
    }
    match (&query.tag_name, &query.tag_value) {
        (Some(name), Some(value)) => {
            validate_name(name, "tagName")?;
            validate_attribute_name(name)?;
            validate_identifier(value, "tagValue")?;
        }
        (None, None) => {}
        _ => {
            return Err(TelemetryError::Invalid(
                "tagName and tagValue must be provided together".into(),
            ));
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), TelemetryError> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(TelemetryError::Invalid(format!("invalid {label}")));
    }
    Ok(())
}

fn validate_name(value: &str, label: &str) -> Result<(), TelemetryError> {
    if value.is_empty()
        || value.len() > 96
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(TelemetryError::Invalid(format!("invalid {label}")));
    }
    Ok(())
}

fn validate_attribute_name(value: &str) -> Result<(), TelemetryError> {
    if matches!(
        value.to_ascii_lowercase().as_str(),
        "content" | "message" | "payload" | "prompt" | "raw" | "response" | "text"
    ) {
        return Err(TelemetryError::Invalid(
            "content-bearing telemetry attributes are forbidden".into(),
        ));
    }
    Ok(())
}

fn event_key(timestamp: u64, sequence: u64) -> [u8; 16] {
    let mut key = [0_u8; 16];
    key[..8].copy_from_slice(&timestamp.to_be_bytes());
    key[8..].copy_from_slice(&sequence.to_be_bytes());
    key
}

fn decode_event_time(key: &[u8]) -> Result<u64, TelemetryError> {
    let bytes: [u8; 8] = key
        .get(..8)
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| TelemetryError::Invalid("corrupt telemetry event key".into()))?;
    Ok(u64::from_be_bytes(bytes))
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn event(id: &str, request_id: &str) -> TelemetryEvent {
        TelemetryEvent {
            event_id: id.into(),
            occurred_at_unix_ms: 10,
            name: "stream.react_commit".into(),
            session_id: Some("session-1".into()),
            request_id: Some(request_id.into()),
            connection_id: Some("connection-1".into()),
            thread_id: Some("thread-1".into()),
            turn_id: None,
            item_id: None,
            values: BTreeMap::from([("latencyMs".into(), 12.0)]),
            tags: BTreeMap::from([("source".into(), "react".into())]),
        }
    }

    fn batch(events: Vec<TelemetryEvent>) -> TelemetryBatch {
        TelemetryBatch {
            version: 1,
            batch_id: "batch-1".into(),
            sent_at_unix_ms: 20,
            client_session_id: "client-1".into(),
            app_version: Some("1.2.3".into()),
            events,
        }
    }

    #[test]
    fn ingests_deduplicates_and_queries_identifiers() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempdir()?;
        let store = TelemetryStore::open(directory.path().join("telemetry.redb"))?;
        let report = store.ingest(
            "device-1",
            batch(vec![
                event("event-1", "request-1"),
                event("event-2", "request-2"),
            ]),
        )?;
        assert_eq!(report.accepted, 2);
        assert_eq!(report.duplicates, 0);

        let duplicate = store.ingest("device-1", batch(vec![event("event-1", "request-1")]))?;
        assert_eq!(duplicate.accepted, 0);
        assert_eq!(duplicate.duplicates, 1);

        let page = store.query(&TelemetryQuery {
            request_id: Some("request-2".into()),
            ..TelemetryQuery::default()
        })?;
        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].device_id, "device-1");
        assert_eq!(page.events[0].event.event_id, "event-2");
        Ok(())
    }

    #[test]
    fn rejects_content_shaped_or_unbounded_payloads() {
        let parsed = serde_json::from_value::<TelemetryEvent>(serde_json::json!({
            "eventId": "event-1",
            "occurredAtUnixMs": 10,
            "name": "stream.delta",
            "content": "private text"
        }));
        assert!(parsed.is_err());

        let mut invalid = event("event-1", "request-1");
        invalid.values.insert("invalid metric name".into(), 1.0);
        assert!(validate_event(&invalid).is_err());
    }

    #[test]
    fn mirrors_events_to_bounded_rotated_jsonl() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempdir()?;
        let jsonl_directory = directory.path().join("jsonl");
        let mut store = TelemetryStore::open(directory.path().join("telemetry.redb"))?;
        store.jsonl = Some(Mutex::new(TelemetryJsonlSink::open(
            &jsonl_directory,
            600,
            1_200,
        )?));

        for index in 0..8 {
            store.ingest(
                "device-1",
                batch(vec![event(
                    format!("event-{index}").as_str(),
                    format!("request-{index}").as_str(),
                )]),
            )?;
        }

        let files = fs::read_dir(&jsonl_directory)?.collect::<Result<Vec<_>, _>>()?;
        assert!(files.len() <= 2);
        let total_bytes = files.iter().try_fold(0_u64, |total, entry| {
            Ok::<_, std::io::Error>(total + entry.metadata()?.len())
        })?;
        assert!(total_bytes <= 1_200);
        let duplicate = store.ingest("device-1", batch(vec![event("event-7", "request-7")]))?;
        assert_eq!(duplicate.accepted, 0);
        let bytes_after_duplicate = fs::read_dir(&jsonl_directory)?
            .try_fold(0_u64, |total, entry| {
                Ok::<_, std::io::Error>(total + entry?.metadata()?.len())
            })?;
        assert_eq!(bytes_after_duplicate, total_bytes);
        let journal = files.iter().try_fold(String::new(), |mut output, entry| {
            output.push_str(&fs::read_to_string(entry.path())?);
            Ok::<_, std::io::Error>(output)
        })?;
        assert!(
            journal
                .lines()
                .all(|line| { serde_json::from_str::<StoredTelemetryEvent>(line).is_ok() })
        );
        assert!(journal.contains("event-7"));
        assert!(!journal.contains("event-0"));
        Ok(())
    }
}
