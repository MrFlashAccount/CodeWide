//! Where Claude keeps its sessions: `<projects root>/<project>/<session
//! id>.jsonl`, with each session's sub-agent transcripts under
//! `<project>/<session id>/subagents/` (`agent-<agent id>.jsonl` and an
//! `agent-<agent id>.meta.json` beside it). Only files named by a session
//! uuid are sessions.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Deserialize;

use super::meta::HEAD_TAIL_BYTES;

const RECORD_EXTENSION: &str = "jsonl";
const AGENT_PREFIX: &str = "agent-";

/// One session file and what a change detector compares.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionFile {
    pub session_id: String,
    pub path: PathBuf,
    pub size: u64,
    pub modified_ms: i64,
}

/// One sub-agent transcript of a session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubagentFile {
    pub agent_id: String,
    pub path: PathBuf,
}

/// What Claude records about a sub-agent next to its transcript.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSidecar {
    pub tool_use_id: Option<String>,
    pub parent_agent_id: Option<String>,
}

fn is_session_id(name: &str) -> bool {
    let parts = name.split('-').map(str::len).collect::<Vec<_>>();
    parts == [8, 4, 4, 4, 12]
        && name
            .bytes()
            .all(|byte| byte == b'-' || byte.is_ascii_hexdigit())
}

fn modified_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn session_file(path: PathBuf) -> Option<SessionFile> {
    if path.extension().and_then(|extension| extension.to_str()) != Some(RECORD_EXTENSION) {
        return None;
    }
    let session_id = path.file_stem()?.to_str()?;
    if !is_session_id(session_id) {
        return None;
    }
    let metadata = std::fs::metadata(&path)
        .ok()
        .filter(std::fs::Metadata::is_file)?;
    Some(SessionFile {
        session_id: session_id.to_owned(),
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
        path,
    })
}

/// Every session file under `projects_root`.
#[must_use]
pub fn sessions(projects_root: &Path) -> Vec<SessionFile> {
    let Ok(projects) = std::fs::read_dir(projects_root) else {
        return Vec::new();
    };
    projects
        .flatten()
        .filter(|project| project.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|project| std::fs::read_dir(project.path()).ok())
        .flat_map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| session_file(entry.path()))
        })
        .collect()
}

/// The session file of `session_id`, if any project holds it. A session in
/// several projects (a moved worktree) is the newest one.
#[must_use]
pub fn find_session(projects_root: &Path, session_id: &str) -> Option<SessionFile> {
    if !is_session_id(session_id) {
        return None;
    }
    let name = format!("{session_id}.{RECORD_EXTENSION}");
    std::fs::read_dir(projects_root)
        .ok()?
        .flatten()
        .filter_map(|project| session_file(project.path().join(&name)))
        .max_by_key(|file| file.modified_ms)
}

/// The sub-agent transcripts of a session, by agent id.
#[must_use]
pub fn subagents(session: &SessionFile) -> Vec<SubagentFile> {
    let directory = session.path.with_extension("").join("subagents");
    let mut found = Vec::new();
    collect_subagents(&directory, &mut found);
    found.sort_by(|left, right| left.agent_id.cmp(&right.agent_id));
    found
}

fn collect_subagents(directory: &Path, found: &mut Vec<SubagentFile>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            collect_subagents(&path, found);
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) != Some(RECORD_EXTENSION) {
            continue;
        }
        let Some(agent_id) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| stem.strip_prefix(AGENT_PREFIX))
            .filter(|agent_id| !agent_id.is_empty())
        else {
            continue;
        };
        found.push(SubagentFile {
            agent_id: agent_id.to_owned(),
            path,
        });
    }
}

/// The sidecar metadata of a sub-agent transcript; empty when absent.
#[must_use]
pub fn subagent_sidecar(subagent: &SubagentFile) -> SubagentSidecar {
    std::fs::read(subagent.path.with_extension("meta.json"))
        .ok()
        .and_then(|text| serde_json::from_slice(&text).ok())
        .unwrap_or_default()
}

/// The first and last [`HEAD_TAIL_BYTES`] of a file, as text.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub fn head_and_tail(path: &Path) -> Result<(String, String), std::io::Error> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut head = Vec::with_capacity(HEAD_TAIL_BYTES);
    (&mut file)
        .take(HEAD_TAIL_BYTES as u64)
        .read_to_end(&mut head)?;
    let head = String::from_utf8_lossy(&head).into_owned();
    if size <= HEAD_TAIL_BYTES as u64 {
        return Ok((head.clone(), head));
    }
    file.seek(SeekFrom::Start(size - HEAD_TAIL_BYTES as u64))?;
    let mut tail = Vec::with_capacity(HEAD_TAIL_BYTES);
    file.read_to_end(&mut tail)?;
    Ok((head, String::from_utf8_lossy(&tail).into_owned()))
}

/// Every JSON row of a transcript; malformed lines and a partial last line
/// are skipped.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub fn rows(path: &Path) -> Result<Vec<serde_json::Value>, std::io::Error> {
    let text = std::fs::read(path)?;
    Ok(text
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "01a135e5-58b0-7582-902d-e1fcc0f0701a";

    #[test]
    fn finds_sessions_and_their_sub_agents_by_their_names() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = tempfile::tempdir()?;
        let project = root.path().join("-work");
        std::fs::create_dir_all(project.join(ID).join("subagents/nested"))?;
        std::fs::write(project.join(format!("{ID}.jsonl")), "{}\n")?;
        std::fs::write(project.join("notes.jsonl"), "{}\n")?;
        std::fs::write(project.join(ID).join("subagents/agent-a1.jsonl"), "{}\n")?;
        std::fs::write(
            project.join(ID).join("subagents/agent-a1.meta.json"),
            r#"{"toolUseId":"toolu_1","agentType":"Explore"}"#,
        )?;
        std::fs::write(
            project.join(ID).join("subagents/nested/agent-a2.jsonl"),
            "{}\n",
        )?;

        let found = sessions(root.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, ID);
        let session = find_session(root.path(), ID).ok_or("session")?;
        let agents = subagents(&session);
        assert_eq!(
            agents
                .iter()
                .map(|agent| agent.agent_id.as_str())
                .collect::<Vec<_>>(),
            ["a1", "a2"]
        );
        assert_eq!(
            subagent_sidecar(&agents[0]).tool_use_id.as_deref(),
            Some("toolu_1")
        );
        assert_eq!(subagent_sidecar(&agents[1]), SubagentSidecar::default());
        assert!(find_session(root.path(), "not-a-session").is_none());
        Ok(())
    }

    #[test]
    fn reads_rows_skipping_malformed_lines_and_a_partial_tail()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("s.jsonl");
        std::fs::write(&path, "{\"a\":1}\nnot json\n{\"b\":2}\n{\"partial\":")?;
        assert_eq!(rows(&path)?.len(), 2);
        let (head, tail) = head_and_tail(&path)?;
        assert_eq!(head, tail);
        Ok(())
    }
}
