//! The semantic parity harness of the session index (opt-in, manual): it
//! dumps the neutral read of every session of a Claude store snapshot, so
//! two builds can be compared on the same input, and compares the reads
//! with a dump an earlier build wrote. Writes JSON files under
//! `CODEWIDE_PARITY_OUT`; prints ids and counts only, never content.
//!
//! `CODEWIDE_PARITY_ROOT=<snapshot> CODEWIDE_PARITY_OUT=<dir>
//! [CODEWIDE_PARITY_BASELINE=<earlier dir>] cargo test -p
//! agent-provider-claude --release dump_session_reads -- --ignored
//! --nocapture`, where `<snapshot>` holds `projects/` (a copy of
//! `~/.claude/projects`) and `claude-journal/` (a copy of the companion's
//! thread state). Every read runs with no Claude process holding a session.

use std::{collections::BTreeMap, path::Path};

use agent_core::model::{AgentTurn, NativeSessionReadResult};
use serde_json::Value;

use super::*;

/// What differs between two reads of one session.
fn differences(baseline: &NativeSessionReadResult, read: &NativeSessionReadResult) -> Vec<String> {
    fn ids(turns: &[AgentTurn]) -> Vec<&str> {
        turns.iter().map(|turn| turn.turn_id.as_str()).collect()
    }
    fn items(turn: &AgentTurn) -> Vec<(String, &str)> {
        turn.items
            .iter()
            .map(|item| {
                let kind = serde_json::to_value(item)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("type")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_default();
                (kind, item.item_id().as_str())
            })
            .collect()
    }
    let mut found = Vec::new();
    if baseline.session != read.session {
        found.push("session".to_owned());
    }
    if ids(&baseline.turns) == ids(&read.turns) {
        for (left, right) in baseline.turns.iter().zip(&read.turns) {
            if left == right {
                continue;
            }
            let (left_items, right_items) = (items(left), items(right));
            let mut sorted = (left_items.clone(), right_items.clone());
            sorted.0.sort();
            sorted.1.sort();
            found.push(if left_items == right_items {
                format!("turn {}: item fields", left.turn_id)
            } else if sorted.0 == sorted.1 {
                format!("turn {}: item order", left.turn_id)
            } else {
                format!(
                    "turn {}: items {} -> {}",
                    left.turn_id,
                    left_items.len(),
                    right_items.len()
                )
            });
        }
    } else {
        found.push(format!(
            "turn ids: {} -> {} turns",
            baseline.turns.len(),
            read.turns.len()
        ));
    }
    for (left, right) in baseline.subagents.iter().zip(&read.subagents) {
        if left != right {
            found.push(format!("sub-agent {}", left.agent_id));
        }
    }
    if baseline.subagents.len() != read.subagents.len() {
        found.push("sub-agent set".to_owned());
    }
    found
}

#[tokio::test]
#[ignore = "reads a snapshot of the developer's own Claude store"]
async fn dump_session_reads() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::var("CODEWIDE_PARITY_ROOT")?;
    let out = std::env::var("CODEWIDE_PARITY_OUT")?;
    let baseline = std::env::var("CODEWIDE_PARITY_BASELINE").ok();
    let root = Path::new(&root);
    std::fs::create_dir_all(&out)?;
    let reader = LocalSessions::for_test(
        root.join("projects"),
        root.join("claude-journal"),
        HashSet::new(),
    );
    let (mut read, mut failed, mut same) = (0, 0, 0);
    let mut differing = BTreeMap::new();
    let mut sessions = files::sessions(&root.join("projects"));
    sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    for session in sessions {
        match reader.read(&session.session_id).await {
            Ok(result) => {
                read += 1;
                let name = format!("{}.json", session.session_id);
                std::fs::write(
                    Path::new(&out).join(&name),
                    serde_json::to_vec_pretty(&result)?,
                )?;
                let Some(baseline) = &baseline else {
                    continue;
                };
                let earlier: NativeSessionReadResult =
                    serde_json::from_slice(&std::fs::read(Path::new(baseline).join(&name))?)?;
                let found = differences(&earlier, &result);
                if found.is_empty() {
                    same += 1;
                } else {
                    differing.insert(session.session_id.clone(), found);
                }
            }
            Err(error) => {
                failed += 1;
                println!("{}: not read: {error}", session.session_id);
            }
        }
    }
    for (session_id, found) in &differing {
        println!("{session_id}: {}", found.join("; "));
    }
    println!(
        "read={read} failed={failed} same={same} differing={}",
        differing.len()
    );
    Ok(())
}
