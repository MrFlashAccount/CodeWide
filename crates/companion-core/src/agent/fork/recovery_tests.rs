//! Recovery contracts through the published files and the actual startup text.

use std::io::Write;

use serde_json::json;

use super::{handoff, snapshot};
use crate::agent::{model::*, testing::thread};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn history() -> Result<Vec<AgentTurn>, serde_json::Error> {
    serde_json::from_value(json!([{
        "turnId": "work", "status": "failed", "origin": "user", "startedAt": 1,
        "completedAt": 2, "error": {"kind": "authentication", "message": "source account unavailable"},
        "items": [
            {"type": "userMessage", "itemId": "request", "clientMessageId": null,
                "content": [{"type": "text", "text": format!("ORIGINAL CONSTRAINT {} REQUEST END", "контекст 🦀 ".repeat(20_000))}]},
            {"type": "reasoning", "itemId": "reason", "summary": ["recorded hypothesis"], "content": ["recorded detail"]},
            {"type": "command", "itemId": "test", "command": "cargo test", "cwd": "/work",
                "status": "failed", "exitCode": 1, "output": "specific failing assertion\nsecond diagnostic line", "durationMs": 42},
            {"type": "toolCall", "itemId": "lookup", "namespace": "internal", "tool": "read",
                "arguments": {"key": "evidence"}, "output": format!("RESULT START {} RESULT END", "evidence ".repeat(20_000)),
                "status": "completed", "durationMs": 3},
            {"type": "mcpToolCall", "itemId": "mcp", "server": "notes", "tool": "read", "arguments": {"id": "a"},
                "status": "completed", "result": {"content": [{"type": "text", "text": "owner decision"}], "structuredContent": null},
                "error": null, "durationMs": 5},
            {"type": "fileChange", "itemId": "edit", "status": "completed", "changes": [
                {"path": "/work/source.rs", "kind": "update", "diff": "-old\n+new", "movePath": null}]},
            {"type": "agentMessage", "itemId": "last", "text": "Implementation edited; validation still fails.", "phase": "final"}
        ]
    }]))
}

/// Reopen the canonical neutral turns from the Markdown code sections. No
/// assertion depends on JSON key order, whitespace or generated file names.
fn reopen(path: &std::path::Path) -> Result<Vec<AgentTurn>, Box<dyn std::error::Error>> {
    let contents = std::fs::read_to_string(path)?;
    contents
        .split("\n## Turn ")
        .skip(1)
        .filter(|section| section.starts_with(|character: char| character.is_ascii_digit()))
        .map(|section| {
            let canonical = section
                .split("\n### Readable transcript")
                .next()
                .ok_or("no canonical turn")?;
            let json = canonical
                .lines()
                .filter_map(|line| line.strip_prefix("    "))
                .collect::<Vec<_>>()
                .join("\n");
            Ok(serde_json::from_str(&json)?)
        })
        .collect()
}

#[test]
fn large_history_is_recoverable_even_when_startup_uses_excerpts() -> TestResult {
    let directory = tempfile::tempdir()?;
    let raw = directory.path().join("original session.jsonl");
    std::fs::write(&raw, "original record\n")?;
    let source = thread("source", "session", 1);
    let turns = history()?;
    let snapshot = snapshot::write(
        directory.path(),
        &source,
        "source",
        &snapshot::Boundary::Latest,
        &turns,
        vec![raw.clone()],
    )?;
    let prompt = handoff::preamble(
        &source,
        "Source agent",
        &turns,
        &snapshot::Boundary::Latest,
        &snapshot,
        handoff::MAX_INLINE_BYTES,
    )?;
    assert!(prompt.len() <= handoff::MAX_INLINE_BYTES);
    assert!(
        prompt.len() > 16_000,
        "startup context must not silently retain the old 16KB cap"
    );
    assert!(prompt.contains("ORIGINAL CONSTRAINT") && prompt.contains("REQUEST END"));
    assert!(prompt.contains("validation still fails"));
    assert!(prompt.contains("excerpt") && prompt.contains("Full session snapshot"));
    assert!(prompt.contains("Raw session") && prompt.contains("original session.jsonl"));
    assert_eq!(
        reopen(&snapshot.path)?,
        turns,
        "all item types and full outputs survive in the file"
    );
    let readable = std::fs::read_to_string(&snapshot.path)?;
    assert!(readable.contains("    specific failing assertion\n    second diagnostic line"));
    let frozen = std::fs::read(&snapshot.path)?;
    std::fs::OpenOptions::new()
        .append(true)
        .open(&raw)?
        .write_all(b"later record\n")?;
    assert_eq!(std::fs::read(&snapshot.path)?, frozen);
    assert!(std::fs::read_to_string(&raw)?.contains("later record"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&snapshot.path)?.permissions().mode() & 0o077,
            0
        );
    }
    Ok(())
}

#[test]
fn a_small_history_is_intact_and_an_insufficient_budget_is_explicit() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = thread("source", "session", 1);
    let mut turns = history()?;
    turns[0].items.retain(|item| {
        matches!(
            item,
            AgentItem::Command { .. } | AgentItem::AgentMessage { .. }
        )
    });
    let snapshot = snapshot::write(
        directory.path(),
        &source,
        "source",
        &snapshot::Boundary::Latest,
        &turns,
        vec![],
    )?;
    let prompt = handoff::preamble(
        &source,
        "Source agent",
        &turns,
        &snapshot::Boundary::Latest,
        &snapshot,
        16_000,
    )?;
    assert!(prompt.contains("0 excerpts; 0 items omitted"));
    assert!(prompt.contains("specific failing assertion") && prompt.contains("cargo test"));
    assert!(prompt.find("cargo test") < prompt.find("Implementation edited"));
    assert!(
        handoff::preamble(
            &source,
            "Source agent",
            &turns,
            &snapshot::Boundary::Latest,
            &snapshot,
            100
        )
        .is_err()
    );
    Ok(())
}

/// Explicit local audit: original Claude JSONL plus its companion turn journal,
/// using the same reconstruction and handoff functions as production. No model
/// request, no source mutation and no transcript content printed to the log.
#[test]
#[ignore = "requires explicit local source, journal and private artifact directory"]
fn audit_local_claude_session() -> TestResult {
    use agent_provider_claude::{
        state::thread_state::ThreadState,
        transcript::{
            chain::active_branch,
            reconstruct::{HistoryContext, reconstruct_turns},
        },
    };
    let raw = std::path::PathBuf::from(std::env::var("CODEWIDE_FORK_AUDIT_SOURCE")?);
    let state: ThreadState = serde_json::from_reader(std::fs::File::open(std::env::var(
        "CODEWIDE_FORK_AUDIT_STATE",
    )?)?)?;
    let output = std::path::PathBuf::from(std::env::var("CODEWIDE_FORK_AUDIT_OUTPUT")?);
    let raw_text = std::fs::read_to_string(&raw)?;
    let rows = raw_text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(serde_json::from_str)
        .collect::<Result<Vec<_>, _>>()?;
    let branch = active_branch(&rows);
    let records: Vec<_> = branch.iter().map(AsRef::as_ref).collect();
    let turns = reconstruct_turns(
        &records,
        &state.turns,
        &HistoryContext {
            app_thread_id: state.app_thread_id.clone(),
            cwd: state.cwd.clone(),
        },
    );
    let mut source = thread("claude", state.app_thread_id.as_str(), state.created_at);
    source.cwd = state.cwd;
    let snapshot = snapshot::write(
        &output,
        &source,
        "claude",
        &snapshot::Boundary::Latest,
        &turns,
        vec![raw],
    )?;
    let prompt = handoff::preamble(
        &source,
        "Claude",
        &turns,
        &snapshot::Boundary::Latest,
        &snapshot,
        handoff::MAX_INLINE_BYTES,
    )?;
    assert!(prompt.len() <= handoff::MAX_INLINE_BYTES);
    assert_eq!(reopen(&snapshot.path)?, turns);
    let mut prompt_file = tempfile::Builder::new()
        .prefix("startup-")
        .suffix(".txt")
        .tempfile_in(&output)?;
    prompt_file.write_all(prompt.as_bytes())?;
    let (_, prompt_path) = prompt_file.keep()?;
    println!(
        "{}",
        json!({"rawBytes": raw_text.len(), "turns": turns.len(), "items": turns.iter().map(|turn| turn.items.len()).sum::<usize>(),
        "lastStatus": turns.last().map(|turn| turn.status), "inlineBytes": prompt.len(), "snapshotBytes": std::fs::metadata(&snapshot.path)?.len(),
        "snapshotPath": snapshot.path, "startupPath": prompt_path, "reopenedHistoryEqual": true})
    );
    Ok(())
}
