//! Where Claude writes a background task's output and the bounded read of
//! one page of it.
//!
//! Claude writes a task's output to `<temp root>/claude-<uid>/<project
//! key>/<session id>/tasks/<task id>.output`: the temp root is
//! `CLAUDE_CODE_TMPDIR`, else the process temporary directory; the project
//! key is the name of the session's project directory in Claude's session
//! store and the uid the session owner's. The file is only ever looked for
//! there:
//! - for the sessions of the thread's own chain, with the uid and project
//!   key of their session files;
//! - under the temp root the `claude` children inherit from the companion,
//!   and under the root of the path the launching call's result names (a
//!   session started in a terminal may have another temporary directory);
//!   that path counts only when it ends with exactly those components;
//! - the directory is canonicalized and must still end with exactly those
//!   components (no symbolic link leads elsewhere), and the file is opened
//!   without following a symbolic link and read only when it is a regular
//!   file the session's owner owns.
//!
//! A read takes at most `limit` + [`WINDOW_SLACK`] bytes. Paths are never
//! logged: they name the user's directories.

use std::{
    ffi::{OsStr, OsString},
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
};

use super::{
    BackgroundTaskId,
    page::{WINDOW_SLACK, page_bounds},
};
use crate::native::files::SessionFile;

const TASKS_DIRECTORY: &str = "tasks";

/// One page of a task's output.
#[derive(Debug, Eq, PartialEq)]
pub struct OutputPage {
    pub text: String,
    /// The byte after `text`; `None` when the page reaches the end of the
    /// file as it was when read.
    pub next_offset: Option<u64>,
    pub size_bytes: u64,
}

/// What a page read needs: the task, the sessions of the thread's chain
/// (newest first) and the temp roots to look under.
pub struct OutputRequest<'a> {
    pub task: &'a BackgroundTaskId,
    pub sessions: &'a [SessionFile],
    /// The temp root of the companion's `claude` children, when known.
    pub temp_root: Option<&'a Path>,
    /// The output path the launching call's result names, when it does.
    pub claimed_output: Option<&'a Path>,
    pub offset: u64,
    pub limit: u32,
}

/// The temp root of the `claude` processes the companion starts: they
/// inherit its environment, so `CLAUDE_CODE_TMPDIR`, else the temporary
/// directory a Node.js process picks (`TMPDIR`, `TMP`, `TEMP`, else `/tmp`).
#[must_use]
pub fn process_temp_root() -> PathBuf {
    ["CLAUDE_CODE_TMPDIR", "TMPDIR", "TMP", "TEMP"]
        .into_iter()
        .filter_map(std::env::var_os)
        .find(|value| !value.is_empty())
        .map_or_else(|| PathBuf::from("/tmp"), PathBuf::from)
}

/// Where one session keeps its task output: `<root>/claude-<uid>/<project
/// key>/<session id>/tasks` for every root it could be under.
struct SessionTasks {
    /// The directory names below the root, outermost first.
    components: [OsString; 4],
    owner_uid: u32,
}

impl SessionTasks {
    fn of(session: &SessionFile) -> Option<Self> {
        let project_key = session.path.parent()?.file_name()?.to_owned();
        let owner_uid = std::fs::metadata(&session.path).ok()?.uid();
        Some(Self {
            components: [
                OsString::from(format!("claude-{owner_uid}")),
                project_key,
                OsString::from(&session.session_id),
                OsString::from(TASKS_DIRECTORY),
            ],
            owner_uid,
        })
    }

    fn directory_under(&self, root: &Path) -> PathBuf {
        let mut directory = root.to_path_buf();
        directory.extend(&self.components);
        directory
    }

    /// The root `claimed` lies under, when it is exactly this session's
    /// `<root>/…/tasks/<file name>` and names no `.` or `..`.
    fn root_of<'a>(&self, claimed: &'a Path, file_name: &str) -> Option<&'a Path> {
        if !claimed.is_absolute()
            || claimed
                .components()
                .any(|component| !matches!(component, Component::RootDir | Component::Normal(_)))
            || claimed.file_name() != Some(OsStr::new(file_name))
        {
            return None;
        }
        let mut directory = claimed.parent()?;
        for expected in self.components.iter().rev() {
            if directory.file_name() != Some(expected.as_os_str()) {
                return None;
            }
            directory = directory.parent()?;
        }
        Some(directory)
    }

    /// Whether a canonical directory still ends with this session's names.
    fn ends(&self, canonical: &Path) -> bool {
        let names = canonical
            .components()
            .rev()
            .take(self.components.len())
            .map(Component::as_os_str)
            .collect::<Vec<_>>();
        names.len() == self.components.len()
            && names
                .iter()
                .zip(self.components.iter().rev())
                .all(|(name, expected)| *name == expected.as_os_str())
    }
}

/// The output file in `directory`, opened when it is where it must be.
fn open_in(tasks: &SessionTasks, directory: &Path, file_name: &str) -> Option<File> {
    let canonical = std::fs::canonicalize(directory).ok()?;
    if !tasks.ends(&canonical) {
        return None;
    }
    let file = OpenOptions::new()
        .read(true)
        // The last component must not be a symbolic link; a FIFO must not
        // block the open (it is rejected below as not a regular file).
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(canonical.join(file_name))
        .ok()?;
    let metadata = file.metadata().ok()?;
    (metadata.is_file() && metadata.uid() == tasks.owner_uid).then_some(file)
}

/// The task's output file, from the newest session that has it.
fn open_output(request: &OutputRequest<'_>) -> Option<File> {
    let file_name = request.task.output_file_name();
    request.sessions.iter().find_map(|session| {
        let tasks = SessionTasks::of(session)?;
        let claimed_root = request
            .claimed_output
            .and_then(|claimed| tasks.root_of(claimed, &file_name));
        [claimed_root, request.temp_root]
            .into_iter()
            .flatten()
            .find_map(|root| open_in(&tasks, &tasks.directory_under(root), &file_name))
    })
}

/// Reads one page of the task's output; `None` when no session of the
/// thread has the file or it cannot be read.
#[must_use]
pub fn read_page(request: &OutputRequest<'_>) -> Option<OutputPage> {
    let mut file = open_output(request)?;
    let size_bytes = file.metadata().ok()?.len();
    if request.offset >= size_bytes {
        return Some(OutputPage {
            text: String::new(),
            next_offset: None,
            size_bytes,
        });
    }
    let limit = usize::try_from(request.limit).unwrap_or(usize::MAX);
    let window_len = (size_bytes - request.offset)
        .min(u64::try_from(limit.saturating_add(WINDOW_SLACK)).unwrap_or(u64::MAX));
    file.seek(SeekFrom::Start(request.offset)).ok()?;
    let mut window = Vec::with_capacity(usize::try_from(window_len).ok()?);
    file.take(window_len).read_to_end(&mut window).ok()?;
    let (start, end) = page_bounds(&window, limit);
    let next = request.offset + u64::try_from(end).ok()?;
    Some(OutputPage {
        text: String::from_utf8_lossy(&window[start..end]).into_owned(),
        next_offset: (next < size_bytes).then_some(next),
        size_bytes,
    })
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const SESSION: &str = "01a13ed2-87ad-7b4d-95a1-73a7a90ffbad";

    /// A session file in Claude's store and the temp root of its output.
    struct Fixture {
        _directory: tempfile::TempDir,
        temp_root: PathBuf,
        session: SessionFile,
        tasks: PathBuf,
    }

    fn fixture() -> Result<Fixture, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let project = directory.path().join("projects/-w");
        std::fs::create_dir_all(&project)?;
        let session_path = project.join(format!("{SESSION}.jsonl"));
        std::fs::write(&session_path, "{}\n")?;
        let uid = std::fs::metadata(&session_path)?.uid();
        let temp_root = directory.path().join("tmp");
        let tasks = temp_root
            .join(format!("claude-{uid}"))
            .join("-w")
            .join(SESSION)
            .join(TASKS_DIRECTORY);
        std::fs::create_dir_all(&tasks)?;
        Ok(Fixture {
            temp_root,
            session: SessionFile {
                session_id: SESSION.into(),
                path: session_path,
                size: 3,
                modified_ms: 0,
            },
            tasks,
            _directory: directory,
        })
    }

    fn task(raw: &str) -> Result<BackgroundTaskId, &'static str> {
        BackgroundTaskId::parse(raw).ok_or("task id")
    }

    fn read(
        fixture: &Fixture,
        task: &BackgroundTaskId,
        temp_root: Option<&Path>,
        claimed_output: Option<&Path>,
        offset: u64,
        limit: u32,
    ) -> Option<OutputPage> {
        read_page(&OutputRequest {
            task,
            sessions: std::slice::from_ref(&fixture.session),
            temp_root,
            claimed_output,
            offset,
            limit,
        })
    }

    #[test]
    fn pages_follow_each_other_byte_for_byte_across_multibyte_characters() -> TestResult {
        let fixture = fixture()?;
        let output = "ok €😀\n".repeat(3);
        std::fs::write(fixture.tasks.join("bd3cb8oli.output"), &output)?;
        let task = task("bd3cb8oli")?;
        let root = Some(fixture.temp_root.as_path());

        // "ok €" is 6 bytes: a 5-byte limit stops before the euro sign.
        let first = read(&fixture, &task, root, None, 0, 5).ok_or("first page")?;
        assert_eq!(first.text, "ok ");
        assert_eq!(first.next_offset, Some(3));
        assert_eq!(first.size_bytes, u64::try_from(output.len())?);

        let mut offset = 0;
        let mut joined = String::new();
        loop {
            let page = read(&fixture, &task, root, None, offset, 5).ok_or("page")?;
            joined.push_str(&page.text);
            match page.next_offset {
                Some(next) => {
                    assert_eq!(next, offset + u64::try_from(page.text.len())?);
                    offset = next;
                }
                None => break,
            }
        }
        assert_eq!(joined, output);

        let past_end = read(&fixture, &task, root, None, 1_000, 5).ok_or("past end")?;
        assert_eq!(
            past_end,
            OutputPage {
                text: String::new(),
                next_offset: None,
                size_bytes: u64::try_from(output.len())?,
            }
        );
        Ok(())
    }

    #[test]
    fn a_page_never_reads_more_than_its_limit_and_slack() -> TestResult {
        let fixture = fixture()?;
        std::fs::write(fixture.tasks.join("b1.output"), "x".repeat(200_000))?;
        let page = read(
            &fixture,
            &task("b1")?,
            Some(&fixture.temp_root),
            None,
            10,
            65_536,
        )
        .ok_or("page")?;
        assert_eq!(page.text.len(), 65_536);
        assert_eq!(page.next_offset, Some(65_546));
        assert_eq!(page.size_bytes, 200_000);
        Ok(())
    }

    #[test]
    fn the_claimed_path_counts_only_with_exactly_the_session_s_components() -> TestResult {
        let fixture = fixture()?;
        std::fs::write(fixture.tasks.join("b1.output"), "done")?;
        let task = task("b1")?;
        let claimed = fixture.tasks.join("b1.output");
        // Without the companion's temp root, the claimed root finds it.
        let page = read(&fixture, &task, None, Some(&claimed), 0, 10).ok_or("claimed")?;
        assert_eq!(page.text, "done");

        for wrong in [
            fixture.tasks.join("b2.output"),
            fixture.temp_root.join("b1.output"),
            fixture.tasks.join("../tasks/b1.output"),
            PathBuf::from("tasks/b1.output"),
        ] {
            assert_eq!(read(&fixture, &task, None, Some(&wrong), 0, 10), None);
        }
        Ok(())
    }

    #[test]
    fn a_missing_file_or_another_session_s_output_is_unavailable() -> TestResult {
        let fixture = fixture()?;
        let root = Some(fixture.temp_root.as_path());
        assert_eq!(read(&fixture, &task("b1")?, root, None, 0, 10), None);
        // Another session's tasks directory of the same project.
        let other = fixture
            .tasks
            .parent()
            .and_then(Path::parent)
            .ok_or("project")?
            .join("01a13ed2-0000-7b4d-95a1-73a7a90ffbad/tasks");
        std::fs::create_dir_all(&other)?;
        std::fs::write(other.join("b1.output"), "other")?;
        assert_eq!(read(&fixture, &task("b1")?, root, None, 0, 10), None);
        Ok(())
    }

    #[test]
    fn symbolic_links_never_lead_out_of_the_tasks_directory() -> TestResult {
        let fixture = fixture()?;
        let root = Some(fixture.temp_root.as_path());
        let secret = fixture.temp_root.join("secret.txt");
        std::fs::write(&secret, "secret")?;
        // The output file itself is a link.
        symlink(&secret, fixture.tasks.join("blink.output"))?;
        assert_eq!(read(&fixture, &task("blink")?, root, None, 0, 10), None);

        // The tasks directory is a link to another directory.
        let elsewhere = fixture.temp_root.join("elsewhere");
        std::fs::create_dir_all(&elsewhere)?;
        std::fs::write(elsewhere.join("bdir.output"), "secret")?;
        std::fs::remove_dir_all(&fixture.tasks)?;
        symlink(&elsewhere, &fixture.tasks)?;
        assert_eq!(read(&fixture, &task("bdir")?, root, None, 0, 10), None);
        Ok(())
    }

    #[test]
    fn a_directory_named_like_the_output_is_not_read() -> TestResult {
        let fixture = fixture()?;
        std::fs::create_dir_all(fixture.tasks.join("bdir.output"))?;
        assert_eq!(
            read(
                &fixture,
                &task("bdir")?,
                Some(&fixture.temp_root),
                None,
                0,
                10
            ),
            None
        );
        Ok(())
    }
}
