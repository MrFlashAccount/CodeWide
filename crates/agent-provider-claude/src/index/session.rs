//! Indexing one session: its file and its sub-agent transcripts advanced on
//! the segmented index from their checkpoints, the turns whose range moved
//! read back (and only those) into their digests and search documents, and
//! the session row recomputed from the digests and facts.
//!
//! Hint contract: the companion's turn index (`state.json`) names records
//! Claude has not necessarily written yet. Prompt uuids are minted and
//! recorded before the prompt reaches `claude`, so a prompt's hints are in
//! place when its record is scanned. The first frame of a provider turn is
//! recorded only after Claude reports it, so a scan may read that record
//! before its hint. Every pass compares the hints with those the file was
//! scanned with; a hint that appeared, changed or left rescans the file from
//! the turn before the earliest record it names (bounded by that turn; the
//! bytes before it are not read). A hint naming a record not scanned yet
//! needs nothing: the record is read with it.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::Path,
};

use agent_core::model::{AgentItem, AgentTurn, SubagentStatus, TurnOrigin};
use agent_index::{SegmentReport, TurnRef, index_segments, reindex_segments_from};
use agent_resources::data::ResourceData;
use companion_host::index::StoreError;

use super::{
    read::{IndexedFile, ReadError, SessionContext, Settlement},
    source::{ClaudeSource, Conversation, ScanState, SessionHints},
};
use crate::{
    native::{
        files::{self, SessionFile},
        host_state::HostThread,
    },
    runtime::open_elsewhere::SessionActivity,
    store::{ClaudeStore, SpawnDigest, StoredSession, StoredSidecar, TurnDigest, session_group},
    subagents::IndexedSubagent,
    transcript::{agents::agent_id_of, reconstruct::HistoryContext, segments::SegmentHints},
};

/// Why a session could not be indexed.
#[derive(Debug, thiserror::Error)]
pub enum SessionIndexError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Index(#[from] agent_index::IndexError),
    #[error(transparent)]
    Read(#[from] ReadError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// One main-conversation turn whose range changed, as read now.
pub struct ChangedTurn {
    /// Position of the session in its thread is the caller's; this is the
    /// turn's start in its file.
    pub start_offset: u64,
    pub turn: AgentTurn,
}

/// What indexing a session changed.
pub struct SessionChanges {
    pub stored: StoredSession,
    pub previous: Option<StoredSession>,
    /// Main-conversation turns read again (shown ones only).
    pub changed: Vec<ChangedTurn>,
    /// Ids of main-conversation turns that are gone or no longer shown.
    pub removed: Vec<String>,
    /// The session row changed.
    pub row_changed: bool,
}

impl SessionChanges {
    /// Whether anything a reader sees changed.
    #[must_use]
    pub fn written(&self) -> bool {
        self.row_changed || !self.changed.is_empty() || !self.removed.is_empty()
    }
}

/// The session as listed now, and who owns it.
pub struct ListedSession<'a> {
    pub file: &'a SessionFile,
    pub session: agent_core::model::NativeSession,
    pub owner: Option<&'a HostThread>,
}

fn main_context(listed: &ListedSession<'_>) -> SessionContext {
    let records = listed
        .owner
        .map(|owner| owner.turns.clone())
        .unwrap_or_default();
    SessionContext {
        hints: SessionHints::new(&records),
        records,
        context: HistoryContext {
            app_thread_id: listed.session.app_thread_id.clone(),
            cwd: listed.owner.map_or_else(
                || listed.session.cwd.clone().unwrap_or_default(),
                |owner| owner.cwd.clone(),
            ),
        },
    }
}

/// The uuids whose hints differ between two scans.
fn changed_hints(
    previous: &BTreeMap<String, String>,
    next: &BTreeMap<String, String>,
) -> BTreeSet<String> {
    previous
        .iter()
        .filter(|(uuid, hint)| next.get(*uuid) != Some(*hint))
        .map(|(uuid, _)| uuid.clone())
        .chain(
            next.iter()
                .filter(|(uuid, hint)| previous.get(*uuid) != Some(*hint))
                .map(|(uuid, _)| uuid.clone()),
        )
        .collect()
}

fn resources_of(turn: &AgentTurn, cwd: &str) -> Option<ResourceData> {
    let mut data = ResourceData::default();
    let cwd = (!cwd.is_empty()).then(|| Path::new(cwd));
    for item in &turn.items {
        data.apply_agent_item(turn.turn_id.as_str(), item, cwd);
    }
    (!data.changes.is_empty() || !data.attachments.is_empty() || !data.patches.is_empty())
        .then_some(data)
}

/// The digest of a turn read at `end_offset`; `None` read means its rows
/// hold no entry.
fn digest(turn: &TurnRef, end_offset: u64, read: Option<&AgentTurn>, cwd: &str) -> TurnDigest {
    let open = turn.end_offset == 0;
    let Some(read) = read else {
        return TurnDigest {
            turn_id: turn.id.clone(),
            end_offset,
            open,
            empty: true,
            user_turn: false,
            preview: None,
            started_at: 0,
            completed_at: None,
            spawns: Vec::new(),
            resources: None,
        };
    };
    TurnDigest {
        turn_id: turn.id.clone(),
        end_offset,
        open,
        empty: false,
        user_turn: read.origin == TurnOrigin::User
            || read
                .items
                .iter()
                .any(|item| matches!(item, AgentItem::UserMessage { .. })),
        preview: crate::preview::newest_message(std::slice::from_ref(read)),
        started_at: read.started_at,
        completed_at: read.completed_at,
        spawns: read
            .items
            .iter()
            .filter_map(|item| match item {
                AgentItem::Subagent {
                    item_id,
                    agent_thread_id,
                    description,
                    agent_type,
                    status,
                    ..
                } => Some(SpawnDigest {
                    item_id: item_id.as_str().to_owned(),
                    agent_id: agent_thread_id
                        .as_ref()
                        .and_then(agent_id_of)
                        .map(ToOwned::to_owned),
                    description: description.clone(),
                    agent_type: agent_type.clone(),
                    status: *status,
                }),
                _ => None,
            })
            .collect(),
        resources: resources_of(read, cwd),
    }
}

/// Brings every digest of an indexed file up to date; returns the turns
/// read again (`None` for one that shows nothing) and the ids of turns
/// that stopped showing.
fn refresh_digests(
    store: &ClaudeStore,
    file: &IndexedFile<'_>,
    cwd: &str,
) -> Result<Refreshed, SessionIndexError> {
    let mut read = Vec::new();
    let mut hidden = Vec::new();
    for turn in store.file_turns(file.file_id())? {
        let end_offset = file.end_of(&turn);
        let current = store.digest(file.file_id(), turn.start_offset)?;
        if current.as_ref().is_some_and(|digest| {
            digest.turn_id == turn.id
                && digest.end_offset == end_offset
                && digest.open == (turn.end_offset == 0)
        }) {
            continue;
        }
        let turn_read = file.read(&turn)?;
        let digest = digest(&turn, end_offset, turn_read.as_ref(), cwd);
        if digest.empty && current.is_some_and(|current| !current.empty) {
            hidden.push(turn.id.clone());
        }
        store.put_digest(file.file_id(), turn.start_offset, &digest)?;
        read.push((turn, turn_read));
    }
    Ok(Refreshed { read, hidden })
}

/// The turns a digest refresh read again, and the ids that stopped showing.
struct Refreshed {
    /// Each turn read, `None` for one whose rows hold no entry.
    read: Vec<(TurnRef, Option<AgentTurn>)>,
    hidden: Vec<String>,
}

/// Every digest of a file, oldest turn first.
fn digests(store: &ClaudeStore, file_id: &[u8; 32]) -> Result<Vec<TurnDigest>, StoreError> {
    let mut digests = Vec::new();
    for turn in store.file_turns(file_id)? {
        if let Some(digest) = store.digest(file_id, turn.start_offset)?
            && digest.turn_id == turn.id
            && !digest.empty
        {
            digests.push(digest);
        }
    }
    Ok(digests)
}

/// Indexes a session's file and sub-agent transcripts from their
/// checkpoints and recomputes its row.
///
/// # Errors
///
/// Returns an error when a file or the index cannot be read or written.
#[allow(clippy::too_many_lines)] // One session pass, read top to bottom.
pub fn index_session(
    store: &ClaudeStore,
    listed: &ListedSession<'_>,
    activity: SessionActivity,
) -> Result<SessionChanges, SessionIndexError> {
    let session_id = listed.file.session_id.as_str();
    let group = session_group(session_id);
    let previous = store.session(session_id)?;
    let context = main_context(listed);
    let hints = context.hints.by_uuid();
    let main_path = listed.file.path.as_path();
    let mut removed = Vec::new();
    if let Some(previous) = &previous
        && previous.path != main_path
    {
        // The session moved (a relocated project): its old file is gone.
        removed.extend(
            store
                .file_turns(&agent_index::file_id(&previous.path))?
                .into_iter()
                .map(|turn| turn.id),
        );
        store
            .segments()
            .reset_file(&agent_index::file_id(&previous.path))?;
    }
    let source = ClaudeSource::new(Conversation::Main, &context.hints);
    let mut report = index_segments(store.segments(), &source, main_path, group)?;
    if let Some(previous) = previous.as_ref().filter(|_| !report.reset) {
        let changed = changed_hints(&previous.hints, &hints);
        let file_id = agent_index::file_id(main_path);
        let mut earliest = None::<u64>;
        for uuid in &changed {
            if let Some(span) = store.segments().record_span(&file_id, uuid.as_bytes())? {
                earliest = Some(earliest.map_or(span.offset, |earliest| earliest.min(span.offset)));
            }
        }
        if let Some(offset) = earliest {
            report.then(reindex_segments_from(
                store.segments(),
                &source,
                main_path,
                group,
                offset,
            )?);
        }
    }
    removed.extend(removed_ids(&report));

    // Sub-agent transcripts: files of their own, with their own turns.
    let empty_hints = SegmentHints::default();
    let sidecar_source = ClaudeSource::new(Conversation::Sidecar, &SIDECAR_HINTS);
    let mut sidecars = Vec::new();
    let mut sidecar_digests = HashMap::new();
    let current = files::subagents(listed.file);
    if let Some(previous) = &previous {
        for gone in previous
            .sidecars
            .iter()
            .filter(|sidecar| !current.iter().any(|file| file.path == sidecar.path))
        {
            store
                .segments()
                .reset_file(&agent_index::file_id(&gone.path))?;
        }
    }
    // Paths of resources resolve against the session's own directory.
    let cwd = listed
        .session
        .cwd
        .clone()
        .filter(|cwd| Path::new(cwd).is_absolute())
        .unwrap_or_else(|| context.context.cwd.clone());
    for subagent in &current {
        index_segments(store.segments(), &sidecar_source, &subagent.path, group)?;
        let meta = files::subagent_sidecar(subagent);
        let file_id = agent_index::file_id(&subagent.path);
        let state = agent_index::checkpoint_state::<ScanState>(store.segments(), &file_id)?
            .unwrap_or_default();
        if let Some(file) = IndexedFile::open(
            store,
            &subagent.path,
            Conversation::Sidecar,
            &empty_hints,
            &[],
            context.context.clone(),
            group,
            false,
        )? {
            refresh_digests(store, &file, &cwd)?;
        }
        sidecar_digests.insert(
            subagent.agent_id.clone(),
            (digests(store, &file_id)?, state),
        );
        sidecars.push(StoredSidecar {
            agent_id: subagent.agent_id.clone(),
            path: subagent.path.clone(),
            parent_agent_id: meta.parent_agent_id,
            parent_tool_use_id: meta.tool_use_id,
            updated_at_ms: sidecar_digests
                .get(&subagent.agent_id)
                .and_then(|(_, state)| state.updated_at_ms),
        });
    }

    // The main conversation's turns whose range moved.
    let mut changed = Vec::new();
    if let Some(file) = IndexedFile::open(
        store,
        main_path,
        Conversation::Main,
        &context.hints.segments,
        &context.records,
        context.context.clone(),
        group,
        false,
    )? {
        let Refreshed { read, hidden } = refresh_digests(store, &file, &cwd)?;
        removed.extend(hidden);
        changed.extend(read.into_iter().filter_map(|(turn, read)| {
            read.map(|read| ChangedTurn {
                start_offset: turn.start_offset,
                turn: read,
            })
        }));
    }
    let main = digests(store, &agent_index::file_id(main_path))?;

    let mut stored = StoredSession {
        session: listed.session.clone(),
        subagents: Vec::new(),
        has_user_turn: main.iter().any(|digest| digest.user_turn),
        newest_message: main.iter().rev().find_map(|digest| digest.preview.clone()),
        path: main_path.to_path_buf(),
        sidecars,
        activity,
        hints,
    };
    let settlement = Settlement::of(store, &stored);
    stored.subagents = stored
        .sidecars
        .iter()
        .map(|sidecar| {
            let (own, state) = sidecar_digests
                .remove(&sidecar.agent_id)
                .unwrap_or_default();
            let spawn = sidecar
                .parent_tool_use_id
                .as_deref()
                .and_then(|tool_use_id| {
                    main.iter()
                        .chain(sidecar_digests.values().flat_map(|(digests, _)| digests))
                        .chain(&own)
                        .flat_map(|digest| &digest.spawns)
                        .find(|spawn| spawn.item_id == tool_use_id)
                        .cloned()
                });
            let running = spawn.as_ref().is_some_and(|spawn| {
                settlement.spawn_status(&spawn.item_id, Some(&sidecar.agent_id), spawn.status)
                    == SubagentStatus::Running
            });
            let last = own.last();
            let subagent = IndexedSubagent {
                agent_id: sidecar.agent_id.clone(),
                parent_agent_id: sidecar.parent_agent_id.clone(),
                parent_tool_use_id: sidecar.parent_tool_use_id.clone(),
                description: spawn
                    .as_ref()
                    .map(|spawn| spawn.description.clone())
                    .filter(|description| !description.is_empty()),
                agent_type: spawn.as_ref().and_then(|spawn| spawn.agent_type.clone()),
                started_at: own.first().map(|digest| digest.started_at),
                updated_at: last.map(|digest| {
                    if running {
                        digest.started_at
                    } else {
                        digest.completed_at.unwrap_or(digest.started_at)
                    }
                }),
                running,
                model: state.answer.as_ref().map(|(model, _)| model.clone()),
                effort: state.answer.and_then(|(_, effort)| effort),
            };
            sidecar_digests.insert(sidecar.agent_id.clone(), (own, ScanState::default()));
            subagent
        })
        .collect();
    let row_changed = store.put_session(&stored)?;
    Ok(SessionChanges {
        stored,
        previous,
        changed,
        removed,
        row_changed,
    })
}

static SIDECAR_HINTS: std::sync::LazyLock<SessionHints> =
    std::sync::LazyLock::new(SessionHints::default);

/// Ids of turns a scan removed that no turn of the file carries now.
fn removed_ids(report: &SegmentReport) -> Vec<String> {
    report
        .removed
        .iter()
        .filter(|turn| !report.changed.iter().any(|changed| changed.id == turn.id))
        .map(|turn| turn.id.clone())
        .collect()
}
