use std::{
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
    time::Instant,
};

#[cfg(not(unix))]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{FileExt, MetadataExt};

use serde::{Deserialize, Serialize};

use crate::store::{FileState, IndexStore, StoreError, TurnRef};

const WRITE_BATCH_RECORDS: usize = 4_096;
const TAIL_CHECK_BYTES: u64 = 4_096;
const REVERSE_SCAN_BLOCK_BYTES: usize = 1024 * 1024;
const TASK_STARTED_NEEDLE: &[u8] = b"\"payload\":{\"type\":\"task_started\"";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub file_bytes: u64,
    pub indexed_records: u64,
    pub total_records: u64,
    pub elapsed_ms: u128,
    pub records_per_second: u64,
    pub total_turns: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailScanReport {
    pub file_bytes: u64,
    pub durable_bytes: u64,
    pub bytes_scanned: u64,
    pub elapsed_ms: u128,
    pub turns: Vec<TurnRefReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRefReport {
    pub id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub completed: bool,
}

impl From<TurnRef> for TurnRefReport {
    fn from(turn: TurnRef) -> Self {
        Self {
            id: turn.id,
            start_offset: turn.start_offset,
            end_offset: turn.end_offset,
            completed: turn.completed,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("rollout contains a record larger than 4 GiB at byte {0}")]
    RecordTooLarge(u64),
    #[error("invalid task boundary at byte {offset}: {source}")]
    InvalidTaskBoundary {
        offset: u64,
        source: serde_json::Error,
    },
}

/// Adds every complete JSONL record in `path` to the compact offset index.
///
/// # Errors
///
/// Returns an error when the rollout cannot be read, an individual record is
/// larger than the index format supports, or the crash-safe store cannot
/// commit a batch.
pub fn index_rollout(store: &IndexStore, path: &Path) -> Result<IndexReport, IndexError> {
    let started = Instant::now();
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_bytes = metadata.len();
    let file_id = rollout_file_id(path);
    let (device, inode) = file_identity(&metadata);
    let persisted = store.file_state(&file_id)?;
    let mut state = match persisted {
        Some(candidate)
            if candidate.device == device
                && candidate.inode == inode
                && candidate.indexed_bytes <= file_bytes
                && tail_hash(&file, candidate.indexed_bytes)? == candidate.tail_hash =>
        {
            candidate
        }
        Some(_) => {
            store.reset_file(&file_id)?;
            FileState::empty(device, inode)
        }
        None => FileState::empty(device, inode),
    };
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    reader.seek(SeekFrom::Start(state.indexed_bytes))?;
    let mut offset = state.indexed_bytes;
    let mut sequence = state.records;
    let initial_records = state.records;
    let mut line = Vec::new();
    let mut batch = Vec::with_capacity(WRITE_BATCH_RECORDS);
    let mut turn_batch = Vec::new();
    let mut active_turn = store
        .turns_desc(&file_id, None, 1)?
        .into_iter()
        .next()
        .filter(|turn| turn.end_offset == 0);

    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if bytes == 0 {
            break;
        }
        // A writer may currently own the final unterminated JSON record. It is
        // indexed only after the terminating newline makes the record durable.
        if line.last() != Some(&b'\n') {
            break;
        }
        let length = u32::try_from(bytes).map_err(|_| IndexError::RecordTooLarge(offset))?;
        let key = record_key(&file_id, offset);
        let value = record_value(offset, length, classify_record(&line));
        batch.push((key, value));
        update_turn_index(
            task_boundary(&line, offset)?,
            offset,
            length,
            &mut active_turn,
            &mut turn_batch,
        );
        sequence += 1;
        offset += u64::from(length);
        if batch.len() == WRITE_BATCH_RECORDS {
            state.indexed_bytes = offset;
            state.records = sequence;
            state.tail_hash = tail_hash(reader.get_ref(), offset)?;
            store.commit_batch(&file_id, &batch, &turn_batch, state)?;
            batch.clear();
            turn_batch.clear();
        }
    }
    if !batch.is_empty() {
        state.indexed_bytes = offset;
        state.records = sequence;
        state.tail_hash = tail_hash(reader.get_ref(), offset)?;
        store.commit_batch(&file_id, &batch, &turn_batch, state)?;
    }

    let elapsed = started.elapsed();
    let elapsed_ms = elapsed.as_millis();
    let indexed_records = sequence - initial_records;
    let records_per_second = (u128::from(indexed_records) * 1_000)
        .checked_div(elapsed_ms)
        .and_then(|rate| u64::try_from(rate).ok())
        .unwrap_or(indexed_records);
    Ok(IndexReport {
        file_bytes,
        indexed_records,
        total_records: sequence,
        elapsed_ms,
        records_per_second,
        total_turns: store.turn_count()?,
    })
}

fn update_turn_index(
    boundary: Option<TaskBoundary>,
    offset: u64,
    length: u32,
    active_turn: &mut Option<TurnRef>,
    turn_batch: &mut Vec<TurnRef>,
) {
    match boundary {
        Some(TaskBoundary::Started(turn_id)) => {
            if let Some(mut interrupted) = active_turn.take() {
                interrupted.end_offset = offset;
                turn_batch.push(interrupted);
            }
            let turn = TurnRef {
                id: turn_id,
                start_offset: offset,
                end_offset: 0,
                completed: false,
            };
            turn_batch.push(turn.clone());
            *active_turn = Some(turn);
        }
        Some(TaskBoundary::Completed(turn_id)) => {
            if let Some(mut completed) = active_turn.take() {
                if completed.id == turn_id {
                    completed.end_offset = offset + u64::from(length);
                    completed.completed = true;
                    turn_batch.push(completed);
                } else {
                    *active_turn = Some(completed);
                }
            }
        }
        None => {}
    }
}

#[must_use]
pub fn rollout_file_id(path: &Path) -> [u8; 32] {
    *blake3::hash(path.as_os_str().as_encoded_bytes()).as_bytes()
}

/// Discovers the newest turn spans directly from the durable JSONL tail.
///
/// This is the cold-start path: it can render the latest page before a full
/// forward index exists. Older pages are served by repeating the scan with the
/// oldest returned `start_offset` as `before_offset`.
///
/// # Errors
///
/// Returns an error if the rollout cannot be read or a task boundary is
/// malformed.
pub fn scan_tail_turns(
    path: &Path,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    let file = File::open(path)?;
    let file_bytes = file.metadata()?.len();
    scan_tail_turns_from_file(&file, file_bytes, before_offset, limit)
}

/// Scans a stable open rollout handle. Keeping discovery and projection on the
/// same handle prevents a concurrent atomic rollout replacement from mixing
/// offsets from one inode with bytes from another.
pub(crate) fn scan_tail_turns_from_file(
    file: &File,
    file_bytes: u64,
    before_offset: Option<u64>,
    limit: usize,
) -> Result<TailScanReport, IndexError> {
    let started = Instant::now();
    let durable_bytes = durable_end(file, file_bytes)?;
    let search_end = before_offset.unwrap_or(durable_bytes).min(durable_bytes);
    if limit == 0 || search_end == 0 {
        return Ok(TailScanReport {
            file_bytes,
            durable_bytes,
            bytes_scanned: 0,
            elapsed_ms: started.elapsed().as_millis(),
            turns: Vec::new(),
        });
    }

    let (matches, bytes_scanned) = find_previous_needles(file, search_end, limit)?;
    let mut starts = Vec::with_capacity(matches.len());
    for boundary_offset in matches {
        let (line_start, line) = read_line_at(file, boundary_offset, durable_bytes)?;
        let Some(TaskBoundary::Started(id)) = task_boundary(&line, line_start)? else {
            continue;
        };
        starts.push((line_start, id));
    }

    let mut turns = Vec::with_capacity(starts.len());
    let mut newer_start = search_end;
    for (start_offset, id) in starts {
        turns.push(
            TurnRef {
                id,
                start_offset,
                end_offset: newer_start,
                completed: false,
            }
            .into(),
        );
        newer_start = start_offset;
    }
    Ok(TailScanReport {
        file_bytes,
        durable_bytes,
        bytes_scanned,
        elapsed_ms: started.elapsed().as_millis(),
        turns,
    })
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> (u64, u64) {
    (0, 0)
}

#[cfg(unix)]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let size = usize::try_from(bytes).map_err(std::io::Error::other)?;
    let mut buffer = vec![0_u8; size];
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], start + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(*blake3::hash(&buffer).as_bytes())
}

#[cfg(not(unix))]
fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
    use std::io::Read;

    if indexed_bytes == 0 {
        return Ok([0; 32]);
    }
    let bytes = TAIL_CHECK_BYTES.min(indexed_bytes);
    let start = indexed_bytes - bytes;
    let size = usize::try_from(bytes).map_err(std::io::Error::other)?;
    let mut cloned = file.try_clone()?;
    cloned.seek(SeekFrom::Start(start))?;
    let mut buffer = vec![0_u8; size];
    cloned.read_exact(&mut buffer)?;
    Ok(*blake3::hash(&buffer).as_bytes())
}

fn record_key(file_id: &[u8; 32], sequence: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(40);
    key.extend_from_slice(file_id);
    key.extend_from_slice(&sequence.to_be_bytes());
    key
}

fn record_value(offset: u64, length: u32, record_type: u8) -> Vec<u8> {
    let mut value = Vec::with_capacity(13);
    value.extend_from_slice(&offset.to_be_bytes());
    value.extend_from_slice(&length.to_be_bytes());
    value.push(record_type);
    value
}

fn classify_record(line: &[u8]) -> u8 {
    const TYPES: [(&[u8], u8); 5] = [
        (b"\"type\":\"session_meta\"", 1),
        (b"\"type\":\"turn_context\"", 2),
        (b"\"type\":\"event_msg\"", 3),
        (b"\"type\":\"response_item\"", 4),
        (b"\"type\":\"compacted\"", 5),
    ];
    let prefix = &line[..line.len().min(8 * 1024)];
    TYPES
        .iter()
        .find_map(|(needle, tag)| memchr::memmem::find(prefix, needle).map(|_| *tag))
        .unwrap_or(0)
}

#[derive(Debug)]
enum TaskBoundary {
    Started(String),
    Completed(String),
}

#[derive(Deserialize)]
struct BoundaryEnvelope {
    payload: BoundaryPayload,
}

#[derive(Deserialize)]
struct BoundaryPayload {
    #[serde(rename = "type")]
    kind: String,
    turn_id: String,
}

fn task_boundary(line: &[u8], offset: u64) -> Result<Option<TaskBoundary>, IndexError> {
    let kind = if memchr::memmem::find(line, b"\"type\":\"task_started\"").is_some() {
        1
    } else if memchr::memmem::find(line, b"\"type\":\"task_complete\"").is_some() {
        2
    } else {
        return Ok(None);
    };
    let parsed: BoundaryEnvelope = serde_json::from_slice(line)
        .map_err(|source| IndexError::InvalidTaskBoundary { offset, source })?;
    match (kind, parsed.payload.kind.as_str()) {
        (1, "task_started") => Ok(Some(TaskBoundary::Started(parsed.payload.turn_id))),
        (2, "task_complete") => Ok(Some(TaskBoundary::Completed(parsed.payload.turn_id))),
        _ => Ok(None),
    }
}

fn durable_end(file: &File, file_bytes: u64) -> Result<u64, std::io::Error> {
    if file_bytes == 0 {
        return Ok(0);
    }
    let mut position = file_bytes;
    let mut buffer = vec![0_u8; bounded_usize(file_bytes, REVERSE_SCAN_BLOCK_BYTES)];
    while position > 0 {
        let read_size = bounded_usize(position, buffer.len());
        let start = position - read_size as u64;
        read_exact_at(file, &mut buffer[..read_size], start)?;
        if let Some(index) = memchr::memrchr(b'\n', &buffer[..read_size]) {
            return Ok(start + index as u64 + 1);
        }
        position = start;
    }
    Ok(0)
}

fn find_previous_needles(
    file: &File,
    search_end: u64,
    limit: usize,
) -> Result<(Vec<u64>, u64), std::io::Error> {
    let overlap = TASK_STARTED_NEEDLE.len().saturating_sub(1) as u64;
    let mut position = search_end;
    let mut matches = Vec::with_capacity(limit);
    let mut bytes_scanned = 0_u64;
    while position > 0 && matches.len() < limit {
        let core_start = position.saturating_sub(REVERSE_SCAN_BLOCK_BYTES as u64);
        let read_end = search_end.min(position.saturating_add(overlap));
        let read_size = usize::try_from(read_end - core_start).map_err(std::io::Error::other)?;
        let mut buffer = vec![0_u8; read_size];
        read_exact_at(file, &mut buffer, core_start)?;
        bytes_scanned = bytes_scanned.saturating_add(position - core_start);
        let mut block_matches: Vec<u64> = memchr::memmem::find_iter(&buffer, TASK_STARTED_NEEDLE)
            .map(|index| core_start + index as u64)
            .filter(|offset| *offset >= core_start && *offset < position)
            .collect();
        block_matches.reverse();
        for offset in block_matches {
            matches.push(offset);
            if matches.len() == limit {
                break;
            }
        }
        position = core_start;
    }
    Ok((matches, bytes_scanned))
}

fn read_line_at(
    file: &File,
    inside_offset: u64,
    durable_bytes: u64,
) -> Result<(u64, Vec<u8>), std::io::Error> {
    let line_start = find_line_start(file, inside_offset)?;
    let line_end = find_line_end(file, inside_offset, durable_bytes)?;
    let length = usize::try_from(line_end - line_start).map_err(std::io::Error::other)?;
    let mut line = vec![0_u8; length];
    read_exact_at(file, &mut line, line_start)?;
    Ok((line_start, line))
}

fn find_line_start(file: &File, inside_offset: u64) -> Result<u64, std::io::Error> {
    let mut position = inside_offset;
    let mut buffer = vec![0_u8; 64 * 1024];
    while position > 0 {
        let read_size = bounded_usize(position, buffer.len());
        let start = position - read_size as u64;
        read_exact_at(file, &mut buffer[..read_size], start)?;
        if let Some(index) = memchr::memrchr(b'\n', &buffer[..read_size]) {
            return Ok(start + index as u64 + 1);
        }
        position = start;
    }
    Ok(0)
}

fn find_line_end(
    file: &File,
    inside_offset: u64,
    durable_bytes: u64,
) -> Result<u64, std::io::Error> {
    let mut position = inside_offset;
    let mut buffer = vec![0_u8; 64 * 1024];
    while position < durable_bytes {
        let read_size = bounded_usize(durable_bytes - position, buffer.len());
        read_exact_at(file, &mut buffer[..read_size], position)?;
        if let Some(index) = memchr::memchr(b'\n', &buffer[..read_size]) {
            return Ok(position + index as u64 + 1);
        }
        position += read_size as u64;
    }
    Ok(durable_bytes)
}

fn bounded_usize(value: u64, upper_bound: usize) -> usize {
    usize::try_from(value).map_or(upper_bound, |converted| converted.min(upper_bound))
}

#[cfg(unix)]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
    let mut read = 0;
    while read < buffer.len() {
        let count = file.read_at(&mut buffer[read..], offset + read as u64)?;
        if count == 0 {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        read += count;
    }
    Ok(())
}

#[cfg(not(unix))]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
    let mut cloned = file.try_clone()?;
    cloned.seek(SeekFrom::Start(offset))?;
    cloned.read_exact(buffer)
}

#[cfg(test)]
mod tests {
    use super::{TaskBoundary, classify_record, task_boundary};

    #[test]
    fn classifies_known_rollout_records() {
        assert_eq!(classify_record(br#"{"type":"turn_context"}\n"#), 2);
        assert_eq!(classify_record(br#"{"type":"response_item"}\n"#), 4);
        assert_eq!(classify_record(br#"{"type":"future_record"}\n"#), 0);
    }

    #[test]
    fn reads_task_boundaries_without_parsing_other_records()
    -> Result<(), Box<dyn std::error::Error>> {
        let started = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}"#;
        let completed = br#"{"timestamp":"now","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}"#;
        assert!(matches!(
            task_boundary(started, 0)?,
            Some(TaskBoundary::Started(id)) if id == "turn-1"
        ));
        assert!(matches!(
            task_boundary(completed, 0)?,
            Some(TaskBoundary::Completed(id)) if id == "turn-1"
        ));
        Ok(())
    }
}
