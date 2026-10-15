//! Reading a transcript file by offset: the durable end (the last complete
//! line), the file's identity, the tail hash and modification time that
//! witness its content, and bounded line reads around an offset.

use std::{
    fs::File,
    io::{Seek, SeekFrom},
    path::Path,
};

#[cfg(not(unix))]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{FileExt, MetadataExt};

use serde::{Deserialize, Serialize};

/// Bytes of the indexed tail whose hash a checkpoint keeps.
pub const TAIL_CHECK_BYTES: u64 = 4_096;
/// Block size of reverse scans.
pub const REVERSE_SCAN_BLOCK_BYTES: usize = 1024 * 1024;

/// Witness of a source file's content for derived reads: appends keep it
/// valid; replacements, truncation, same-length rewrites and appended
/// rollbacks invalidate it. The serialized form is a client-held cursor
/// part, so the field set is a compatibility contract.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Deserialize, Serialize)]
pub struct FileWitness {
    pub(crate) device: u64,
    pub(crate) inode: u64,
    pub durable_bytes: u64,
    pub(crate) tail_hash: [u8; 32],
    pub(crate) modified_nanos: u128,
    pub(crate) observed_bytes: u64,
}

impl FileWitness {
    /// The witness of `file`, whose length `file_bytes` was just observed.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read.
    pub fn from_file(file: &File, file_bytes: u64) -> Result<Self, std::io::Error> {
        let metadata = file.metadata()?;
        let (device, inode) = file_identity(&metadata);
        let durable_bytes = durable_end(file, file_bytes)?;
        Ok(Self {
            device,
            inode,
            durable_bytes,
            tail_hash: tail_hash(file, durable_bytes)?,
            modified_nanos: modified_nanos(&metadata),
            observed_bytes: metadata.len(),
        })
    }

    /// Whether `file` still carries the witnessed bytes unchanged, ignoring
    /// what was appended after them. Appended rollbacks are the source's
    /// business; see [`crate::scan::witness_matches`].
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read.
    pub fn bytes_match(&self, file: &File, file_bytes: u64) -> Result<bool, std::io::Error> {
        let current = Self::from_file(file, file_bytes)?;
        Ok(!(current.device != self.device
            || current.inode != self.inode
            || current.durable_bytes < self.durable_bytes
            || tail_hash(file, self.durable_bytes)? != self.tail_hash
            || (current.observed_bytes == self.observed_bytes
                && current.modified_nanos != self.modified_nanos)))
    }
}

/// The stable identity of a source path inside the index.
#[must_use]
pub fn file_id(path: &Path) -> [u8; 32] {
    *blake3::hash(path.as_os_str().as_encoded_bytes()).as_bytes()
}

/// The end of the last complete line: a writer-owned final record is indexed
/// only after its durable newline.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub fn durable_end(file: &File, file_bytes: u64) -> Result<u64, std::io::Error> {
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

#[cfg(unix)]
#[must_use]
pub fn file_identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
#[must_use]
pub fn file_identity(_metadata: &std::fs::Metadata) -> (u64, u64) {
    (0, 0)
}

/// Hash of the last [`TAIL_CHECK_BYTES`] before `indexed_bytes`.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
#[cfg(unix)]
pub fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
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

/// Hash of the last [`TAIL_CHECK_BYTES`] before `indexed_bytes`.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
#[cfg(not(unix))]
pub fn tail_hash(file: &File, indexed_bytes: u64) -> Result<[u8; 32], std::io::Error> {
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

#[must_use]
pub fn modified_seconds(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|value| i64::try_from(value.as_secs()).ok())
        .unwrap_or(0)
}

#[must_use]
pub fn modified_nanos(metadata: &std::fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_nanos())
}

/// The complete line containing `inside_offset`, with its start offset.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub fn read_line_at(
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

#[must_use]
pub fn bounded_usize(value: u64, upper_bound: usize) -> usize {
    usize::try_from(value).map_or(upper_bound, |converted| converted.min(upper_bound))
}

/// Fills `buffer` from `offset` without moving the file's cursor.
///
/// # Errors
///
/// Returns an error when the file ends before the buffer is full.
#[cfg(unix)]
pub fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
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

/// Fills `buffer` from `offset` through a cloned handle.
///
/// # Errors
///
/// Returns an error when the file ends before the buffer is full.
#[cfg(not(unix))]
pub fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> Result<(), std::io::Error> {
    let mut cloned = file.try_clone()?;
    cloned.seek(SeekFrom::Start(offset))?;
    cloned.read_exact(buffer)
}

/// Positions a seekable handle; shared by readers that stream a range.
///
/// # Errors
///
/// Returns the seek error.
pub fn seek_to(file: &mut File, offset: u64) -> Result<(), std::io::Error> {
    file.seek(SeekFrom::Start(offset)).map(|_position| ())
}
