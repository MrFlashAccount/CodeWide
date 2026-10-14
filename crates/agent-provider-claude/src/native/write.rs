//! Writes to Claude's session store, as the Agent SDK's `renameSession`,
//! `deleteSession` and `forkSession` make them on local files.
//!
//! A session is found the way the SDK's mutations find it: with a working
//! directory, in that directory's project (`<projects root>/<sanitized real
//! path>`); otherwise, and when that project does not hold it, in any
//! project, the newest copy winning as [`super::LocalSessions`] reads it.
//! An empty session file is no session.
//!
//! - A rename appends one `custom-title` row.
//! - A removal deletes the session file and the session's directory beside
//!   it (sub-agent transcripts and other sidecars).
//! - A fork writes a new session file with a fresh uuid into the source's
//!   project ([`super::fork_copy`]); it is written to a temporary file and
//!   renamed into place, so no partial session is ever visible.

use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, BufWriter, ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde_json::{Map, Value};

use super::{
    files,
    fork_copy::{self, ForkSource, ForkStamp},
};

const RECORD_EXTENSION: &str = "jsonl";
/// Project directory names longer than this end in a hash of the path.
const PROJECT_NAME_MAX: usize = 200;
const SIDECAR_TITLE_FILE: &str = "custom-title.json";
const RANDOM_SOURCE: &str = "/dev/urandom";
const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

/// Which session a write is for, and the working directory whose project
/// holds it when known.
#[derive(Clone, Copy, Debug)]
pub struct SessionLocation<'a> {
    pub session_id: &'a str,
    pub cwd: Option<&'a Path>,
}

/// Why a rename did not happen.
#[derive(Debug, thiserror::Error)]
pub enum RenameError {
    #[error("Claude session title must not be empty")]
    EmptyTitle,
    #[error("Claude session not found")]
    NotFound,
    #[error("Claude session cannot be renamed: {0}")]
    Io(#[from] std::io::Error),
}

/// What a removal found.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Removal {
    /// The session existed and its file and directory are gone.
    Removed,
    /// No session with that id exists (a repeated removal).
    Missing,
}

/// Why a fork did not happen.
#[derive(Debug, thiserror::Error)]
pub enum ForkError {
    #[error("Claude session not found")]
    NotFound,
    #[error("Claude session has no messages to fork")]
    NoMessages,
    #[error("message not found in the Claude session")]
    MessageNotFound,
    #[error("Claude session cannot be forked: {0}")]
    Io(#[from] std::io::Error),
}

/// Sets the session's title: appends `{"type":"custom-title",
/// "customTitle":<title trimmed>,"sessionId":<id>}`. A file whose last line
/// is unterminated gets a line break first, so the row stays whole.
///
/// # Errors
///
/// [`RenameError::EmptyTitle`] for a blank title, [`RenameError::NotFound`]
/// when no non-empty session file exists, and file errors.
pub fn rename(
    projects_root: &Path,
    location: &SessionLocation<'_>,
    title: &str,
) -> Result<(), RenameError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(RenameError::EmptyTitle);
    }
    let path = locate(projects_root, location)?.ok_or(RenameError::NotFound)?;
    let mut row = Map::new();
    row.insert("type".to_owned(), Value::from("custom-title"));
    row.insert("customTitle".to_owned(), Value::from(title));
    row.insert("sessionId".to_owned(), Value::from(location.session_id));
    let mut line = Value::Object(row).to_string();
    line.push('\n');
    append(&path, &line)
}

/// Appends `line` to an existing, non-empty file.
fn append(path: &Path, line: &str) -> Result<(), RenameError> {
    let mut file = match OpenOptions::new().read(true).append(true).open(path) {
        Ok(file) => file,
        Err(error) if is_absent(&error) => return Err(RenameError::NotFound),
        Err(error) => return Err(error.into()),
    };
    let size = file.metadata()?.len();
    if size == 0 {
        return Err(RenameError::NotFound);
    }
    file.seek(SeekFrom::Start(size - 1))?;
    let mut last = [0_u8; 1];
    file.read_exact(&mut last)?;
    let text = if last[0] == b'\n' {
        line.to_owned()
    } else {
        format!("\n{line}")
    };
    file.write_all(text.as_bytes())?;
    Ok(())
}

/// Deletes the session file and the session's directory beside it.
///
/// # Errors
///
/// Returns file errors other than an already missing file or directory.
pub fn remove(
    projects_root: &Path,
    location: &SessionLocation<'_>,
) -> Result<Removal, std::io::Error> {
    let Some(path) = locate(projects_root, location)? else {
        return Ok(Removal::Missing);
    };
    unless_absent(std::fs::remove_file(&path))?;
    unless_absent(std::fs::remove_dir_all(path.with_extension("")))?;
    Ok(Removal::Removed)
}

/// `result`, with an already missing file or directory read as done.
fn unless_absent(result: Result<(), std::io::Error>) -> Result<(), std::io::Error> {
    match result {
        Err(error) if !is_absent(&error) => Err(error),
        _ => Ok(()),
    }
}

/// Copies the session into a new session in the same project, through
/// `up_to_message_id` (inclusive) when given, and returns the new session's
/// id.
///
/// # Errors
///
/// [`ForkError::NotFound`] when no non-empty session file exists,
/// [`ForkError::NoMessages`] when it (or the cut) has no message,
/// [`ForkError::MessageNotFound`] when no row is `up_to_message_id`, and
/// file errors.
pub fn fork(
    projects_root: &Path,
    location: &SessionLocation<'_>,
    up_to_message_id: Option<&str>,
) -> Result<String, ForkError> {
    let path = locate(projects_root, location)?.ok_or(ForkError::NotFound)?;
    let source_id = location.session_id;
    let mut source = ForkSource::default();
    let mut reader = BufReader::new(File::open(&path)?);
    let mut line = Vec::new();
    while reader.read_until(b'\n', &mut line)? > 0 {
        if let Ok(row) = serde_json::from_slice::<Value>(&line) {
            source.push(row, source_id);
        }
        line.clear();
    }
    let (head, tail) = files::head_and_tail(&path)?;
    let sidecar = std::fs::read_to_string(path.with_extension("").join(SIDECAR_TITLE_FILE))
        .ok()
        .and_then(|text| fork_copy::sidecar_title(&text));
    let title = fork_copy::fork_title(fork_copy::source_title(&head, &tail, sidecar).as_deref());
    let mut uuids = Uuids::open()?;
    let session_id = uuids.next()?;
    let now = iso_now();
    let stamp = ForkStamp {
        session_id: &session_id,
        source_id,
        now: &now,
        title: &title,
    };
    let rows = fork_copy::forked_rows(source, up_to_message_id, &stamp, &mut || uuids.next())?;
    let project = path.parent().unwrap_or(projects_root);
    write_new(
        &project.join(format!("{session_id}.{RECORD_EXTENSION}")),
        &rows,
    )?;
    Ok(session_id)
}

/// Writes `rows` as a new JSONL file at `path`: into a temporary file
/// beside it (owner-only, as Claude keeps sessions), flushed, then renamed
/// into place. The temporary file is removed when anything fails.
fn write_new(path: &Path, rows: &[Map<String, Value>]) -> Result<(), std::io::Error> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let written = write_rows(&temporary, rows).and_then(|()| std::fs::rename(&temporary, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

fn write_rows(path: &Path, rows: &[Map<String, Value>]) -> Result<(), std::io::Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut writer = BufWriter::new(options.open(path)?);
    for row in rows {
        serde_json::to_writer(&mut writer, row)?;
        writer.write_all(b"\n")?;
    }
    let file = writer
        .into_inner()
        .map_err(std::io::IntoInnerError::into_error)?;
    file.sync_all()
}

fn is_absent(error: &std::io::Error) -> bool {
    matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory)
}

/// The session file a write applies to: in the working directory's project
/// first, else the newest non-empty copy in any project.
fn locate(
    projects_root: &Path,
    location: &SessionLocation<'_>,
) -> Result<Option<PathBuf>, std::io::Error> {
    if !files::is_session_id(location.session_id) {
        return Ok(None);
    }
    let name = format!("{}.{RECORD_EXTENSION}", location.session_id);
    if let Some(cwd) = location.cwd {
        let real = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
        let path = projects_root
            .join(project_dir_name(&real.to_string_lossy()))
            .join(&name);
        if modified_if_session(&path)?.is_some() {
            return Ok(Some(path));
        }
    }
    let projects = match std::fs::read_dir(projects_root) {
        Ok(projects) => projects,
        Err(error) if is_absent(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for project in projects {
        let path = project?.path().join(&name);
        let Some(modified) = modified_if_session(&path)? else {
            continue;
        };
        if newest.as_ref().is_none_or(|(time, _)| modified > *time) {
            newest = Some((modified, path));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

/// The modification time of a non-empty regular file at `path`; `None`
/// when there is none.
fn modified_if_session(path: &Path) -> Result<Option<SystemTime>, std::io::Error> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() > 0 => {
            Ok(Some(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
        }
        Ok(_) => Ok(None),
        Err(error) if is_absent(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Claude's project directory name for a working directory: every
/// character but an ASCII letter or digit becomes `-` (one per UTF-16
/// unit); a name over 200 characters is cut and ends in `-<hash>`, the
/// base-36 absolute value of the path's 32-bit string hash.
#[must_use]
pub fn project_dir_name(path: &str) -> String {
    let mut name = String::with_capacity(path.len());
    for character in path.chars() {
        if character.is_ascii_alphanumeric() {
            name.push(character);
        } else {
            name.extend(std::iter::repeat_n('-', character.len_utf16()));
        }
    }
    if name.len() <= PROJECT_NAME_MAX {
        return name;
    }
    let hash = path.encode_utf16().fold(0_i32, |hash, unit| {
        hash.wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(i32::from(unit))
    });
    name.truncate(PROJECT_NAME_MAX);
    name.push('-');
    name.push_str(&base36(u64::from(hash.unsigned_abs())));
    name
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut digits = Vec::new();
    loop {
        digits.push(DIGITS[usize::try_from(value % 36).unwrap_or_default()]);
        value /= 36;
        if value == 0 {
            break;
        }
    }
    digits
        .iter()
        .rev()
        .map(|digit| char::from(*digit))
        .collect()
}

/// Random (version 4) uuids, as `crypto.randomUUID` makes them.
struct Uuids(BufReader<File>);

impl Uuids {
    fn open() -> Result<Self, std::io::Error> {
        Ok(Self(BufReader::new(File::open(RANDOM_SOURCE)?)))
    }

    fn next(&mut self) -> Result<String, std::io::Error> {
        let mut bytes = [0_u8; 16];
        self.0.read_exact(&mut bytes)?;
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let mut hex = String::with_capacity(32);
        for byte in bytes {
            hex.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
            hex.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
        }
        Ok(format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        ))
    }
}

/// The current UTC time as JavaScript's `toISOString` writes it.
fn iso_now() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
    )
}
