//! The active branch of a Claude session file: the messages the conversation
//! consists of now, oldest first.
//!
//! A session file keeps every row Claude ever wrote. A rewind or an edited
//! prompt starts a new branch from an older message and leaves the old one
//! in the file; a compaction writes a boundary without a parent. The branch
//! is found as Claude's own session read finds it: the newest leaf whose
//! ancestry reaches a user or assistant message, walked back through
//! `parentUuid`. Two relinks come first:
//! - the messages a compaction preserved (`compactMetadata.preservedMessages`,
//!   formerly `preservedSegment`) follow the compact summary, as Claude
//!   relinks them;
//! - a boundary without a parent continues the message the compacted
//!   conversation ended with (the original parent of the first preserved
//!   message, else `logicalParentUuid`), so the history before a compaction
//!   stays part of the conversation shown to a person;
//! - a row whose parent Claude never stored (a lost write: a full disk, or
//!   a message Claude sent without persisting it) continues the conversation
//!   message stored before it at its level, so one missing row does not cut
//!   the history before it.
//!
//! Rows on the branch are returned as stored; side-chain rows, team rows,
//! progress rows and rows without a uuid never are. Pure.

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use serde_json::Value;

use super::json::{JsonRecord, is_true, record_of, str_of};

/// One stored row with a uuid, and where it is in the file.
struct Node<'a> {
    row: &'a JsonRecord,
    index: usize,
    kind: &'a str,
}

fn is_conversation(kind: &str) -> bool {
    matches!(kind, "user" | "assistant")
}

/// Whether a row may end the branch: not a side chain, team, progress or
/// fork-briefing row.
fn can_lead(node: &Node<'_>) -> bool {
    !is_true(node.row, "isSidechain")
        && node.row.get("teamName").is_none_or(Value::is_null)
        && node.kind != "progress"
        && !(node.kind == "attachment"
            && record_of(node.row, "attachment").and_then(|attachment| str_of(attachment, "type"))
                == Some("fork_briefing"))
}

/// The uuids a compaction preserved, oldest first, with the summary they follow.
fn preserved(row: &JsonRecord) -> Option<(Vec<&str>, &str)> {
    let metadata = record_of(row, "compactMetadata")?;
    if let Some(messages) = record_of(metadata, "preservedMessages") {
        let anchor = str_of(messages, "anchorUuid")?;
        let uuids = messages
            .get("uuids")
            .and_then(Value::as_array)?
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        return (!uuids.is_empty()).then_some((uuids, anchor));
    }
    let segment = record_of(metadata, "preservedSegment")?;
    let head = str_of(segment, "headUuid")?;
    let tail = str_of(segment, "tailUuid")?;
    let anchor = str_of(segment, "anchorUuid")?;
    Some((
        if head == tail {
            vec![head]
        } else {
            vec![head, tail]
        },
        anchor,
    ))
}

/// Parents after the compaction relinks.
fn linked_parents<'a>(nodes: &HashMap<&'a str, Node<'a>>) -> HashMap<&'a str, Option<&'a str>> {
    let original = nodes
        .iter()
        .map(|(uuid, node)| (*uuid, str_of(node.row, "parentUuid")))
        .collect::<HashMap<_, _>>();
    let mut parents = original.clone();
    let mut boundaries = nodes
        .values()
        .filter(|node| {
            node.kind == "system" && str_of(node.row, "subtype") == Some("compact_boundary")
        })
        .collect::<Vec<_>>();
    boundaries.sort_by_key(|node| node.index);
    for boundary in boundaries {
        let Some(uuid) = str_of(boundary.row, "uuid") else {
            continue;
        };
        let kept = preserved(boundary.row)
            .filter(|(uuids, _)| uuids.iter().all(|id| nodes.contains_key(id)));
        if let Some((uuids, anchor)) = &kept {
            let first = uuids[0];
            let last = uuids[uuids.len() - 1];
            for (position, id) in uuids.iter().enumerate() {
                let parent = if position == 0 {
                    *anchor
                } else {
                    uuids[position - 1]
                };
                parents.insert(*id, Some(parent));
            }
            let followers = parents
                .iter()
                .filter(|(id, parent)| **parent == Some(*anchor) && **id != first)
                .map(|(id, _)| *id)
                .collect::<Vec<_>>();
            for id in followers {
                parents.insert(id, Some(last));
            }
        }
        if original.get(uuid).copied().flatten().is_none() {
            let continued = kept
                .as_ref()
                .and_then(|(uuids, _)| original.get(uuids[0]).copied().flatten())
                .or_else(|| str_of(boundary.row, "logicalParentUuid"))
                .filter(|parent| nodes.contains_key(parent));
            if continued.is_some() {
                parents.insert(uuid, continued);
            }
        }
    }
    bridge_missing_parents(nodes, &original, &mut parents);
    parents
}

/// Relinks each row whose stored parent is in no row (and that no
/// compaction relinked) to the conversation message stored before it at
/// its level.
fn bridge_missing_parents<'a>(
    nodes: &HashMap<&'a str, Node<'a>>,
    original: &HashMap<&'a str, Option<&'a str>>,
    parents: &mut HashMap<&'a str, Option<&'a str>>,
) {
    let dangling = original
        .iter()
        .filter(|(id, parent)| {
            parent.is_some_and(|parent| !nodes.contains_key(parent))
                && parents.get(*id) == Some(*parent)
        })
        .map(|(id, _)| *id)
        .collect::<Vec<_>>();
    if dangling.is_empty() {
        return;
    }
    let mut conversation = nodes
        .iter()
        .filter(|(_, node)| is_conversation(node.kind))
        .collect::<Vec<_>>();
    conversation.sort_by_key(|(_, node)| node.index);
    for id in dangling {
        let node = &nodes[id];
        let before = conversation.partition_point(|(_, other)| other.index < node.index);
        let previous = conversation[..before]
            .iter()
            .rev()
            .find(|(_, other)| same_level(node, other))
            .map(|(uuid, _)| **uuid);
        if previous.is_some() {
            parents.insert(id, previous);
        }
    }
}

/// The conversation message that ends the active branch.
fn leaf<'a>(
    nodes: &HashMap<&'a str, Node<'a>>,
    parents: &HashMap<&'a str, Option<&'a str>>,
) -> Option<&'a str> {
    let referenced = nodes
        .iter()
        .filter(|(_, node)| can_lead(node))
        .filter_map(|(uuid, _)| parents.get(uuid).copied().flatten())
        .collect::<HashSet<_>>();
    let mut candidates = nodes
        .iter()
        .filter(|(uuid, node)| can_lead(node) && !referenced.contains(*uuid))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, node)| std::cmp::Reverse(node.index));
    let mut walked = HashSet::new();
    for (uuid, _) in candidates {
        let mut current = Some(*uuid);
        let mut path = HashSet::new();
        while let Some(id) = current {
            if walked.contains(id) || !path.insert(id) {
                break;
            }
            let Some(node) = nodes.get(id) else {
                break;
            };
            if is_conversation(node.kind) {
                return Some(id);
            }
            current = parents.get(id).copied().flatten();
        }
        walked.extend(path);
    }
    nodes
        .iter()
        .filter(|(_, node)| is_conversation(node.kind) && !is_true(node.row, "isSidechain"))
        .max_by_key(|(_, node)| node.index)
        .map(|(uuid, _)| *uuid)
}

/// The rows of the active branch, oldest first: stored rows, with the
/// prompts Claude queued during a turn as user messages.
#[must_use]
pub fn active_branch(rows: &[Value]) -> Vec<Cow<'_, JsonRecord>> {
    let mut nodes = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(row) = row.as_object() else {
            continue;
        };
        let (Some(uuid), Some(kind)) = (str_of(row, "uuid"), str_of(row, "type")) else {
            continue;
        };
        nodes.insert(uuid, Node { row, index, kind });
    }
    let parents = linked_parents(&nodes);
    let Some(leaf) = leaf(&nodes, &parents) else {
        return Vec::new();
    };
    let mut branch = Vec::new();
    let mut visited = HashSet::new();
    let mut current = Some(leaf);
    while let Some(id) = current {
        if !visited.insert(id) {
            break;
        }
        let Some(node) = nodes.get(id) else {
            break;
        };
        branch.push(node);
        current = parents.get(id).copied().flatten();
    }
    branch.reverse();
    let branch = with_sibling_rows(&nodes, branch);
    let trailing = trailing_queued(&nodes, &branch, leaf);
    with_queued_prompts(&branch, &trailing)
        .into_iter()
        .filter(|row| {
            matches!(str_of(row, "type"), Some("user" | "assistant" | "system"))
                && !is_true(row, "isSidechain")
                && row.get("teamName").is_none_or(Value::is_null)
        })
        .collect()
}

/// The API message id of an assistant row.
fn message_id<'a>(node: &Node<'a>) -> Option<&'a str> {
    (node.kind == "assistant")
        .then(|| record_of(node.row, "message").and_then(|message| str_of(message, "id")))
        .flatten()
}

/// The `field` values of the `kind` content blocks of a row's message.
fn block_ids<'a>(row: &'a JsonRecord, kind: &str, field: &str) -> Vec<&'a str> {
    record_of(row, "message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(Value::as_object)
                .filter(|block| str_of(block, "type") == Some(kind))
                .filter_map(|block| str_of(block, field))
                .collect()
        })
        .unwrap_or_default()
}

fn is_tool_result_row(node: &Node<'_>) -> bool {
    node.kind == "user"
        && str_of(node.row, "parentUuid").is_some()
        && !block_ids(node.row, "tool_result", "tool_use_id").is_empty()
}

fn same_level(left: &Node<'_>, right: &Node<'_>) -> bool {
    is_true(left.row, "isSidechain") == is_true(right.row, "isSidechain")
        && left.row.get("agentId") == right.row.get("agentId")
}

/// Where each API message's rows and tool results lie in a session file.
struct Siblings<'a, 'n> {
    /// Every assistant row of each message, in file order.
    by_message: HashMap<&'a str, Vec<&'n Node<'a>>>,
    /// The row that made each tool call; `None` when two messages claim it.
    tool_owner: HashMap<&'a str, Option<&'n Node<'a>>>,
    /// Tool-result rows by the row they answer or hang off.
    attached: HashMap<&'a str, Vec<&'n Node<'a>>>,
}

impl<'a, 'n> Siblings<'a, 'n> {
    fn new(nodes: &'n HashMap<&'a str, Node<'a>>) -> Self {
        let mut ordered = nodes.values().collect::<Vec<_>>();
        ordered.sort_by_key(|node| node.index);
        let mut siblings = Self {
            by_message: HashMap::new(),
            tool_owner: HashMap::new(),
            attached: HashMap::new(),
        };
        for node in &ordered {
            let Some(message) = message_id(node) else {
                continue;
            };
            siblings.by_message.entry(message).or_default().push(node);
            for tool in block_ids(node.row, "tool_use", "id") {
                let owner = siblings.tool_owner.entry(tool).or_insert(Some(node));
                if owner.is_some_and(|owner| message_id(owner) != Some(message)) {
                    *owner = None;
                }
            }
        }
        for node in ordered.into_iter().filter(|node| is_tool_result_row(node)) {
            siblings.attach_result(nodes, node);
        }
        siblings
    }

    fn attach(&mut self, anchor: &'a str, node: &'n Node<'a>) {
        let rows = self.attached.entry(anchor).or_default();
        if !rows.iter().any(|row| std::ptr::eq(*row, node)) {
            rows.push(node);
        }
    }

    /// Files a tool result under its parent, the call row it names and the
    /// rows of the calls it answers.
    fn attach_result(&mut self, nodes: &'n HashMap<&'a str, Node<'a>>, node: &'n Node<'a>) {
        if let Some(parent) = str_of(node.row, "parentUuid") {
            self.attach(parent, node);
        }
        if let Some(source) = str_of(node.row, "sourceToolAssistantUUID")
            .filter(|source| Some(*source) != str_of(node.row, "parentUuid"))
            .and_then(|source| nodes.get(source))
            .filter(|source| same_level(node, source))
            .and_then(|source| str_of(source.row, "uuid"))
        {
            self.attach(source, node);
        }
        for tool in block_ids(node.row, "tool_result", "tool_use_id") {
            if let Some(owner) = self
                .tool_owner
                .get(tool)
                .copied()
                .flatten()
                .filter(|owner| same_level(node, owner))
                .and_then(|owner| str_of(owner.row, "uuid"))
            {
                self.attach(owner, node);
            }
        }
    }

    /// The rows of `message` the branch lacks and the results that belong
    /// with them, each by time; `included` and `answered` describe the
    /// branch so far.
    fn missing(
        &self,
        message: &str,
        included: &HashSet<usize>,
        answered: &HashSet<&'a str>,
    ) -> (Vec<&'n Node<'a>>, Vec<&'n Node<'a>>) {
        let group = self.by_message.get(message).map_or(&[][..], Vec::as_slice);
        let members = group
            .iter()
            .filter_map(|member| str_of(member.row, "uuid"))
            .collect::<HashSet<_>>();
        let mut extra = group
            .iter()
            .copied()
            .filter(|member| !included.contains(&member.index))
            .collect::<Vec<_>>();
        let (mut results, mut elsewhere) = (Vec::new(), Vec::new());
        let mut seen = HashSet::new();
        for uuid in &members {
            for result in self.attached.get(uuid).map_or(&[][..], Vec::as_slice) {
                if included.contains(&result.index) || !seen.insert(result.index) {
                    continue;
                }
                if str_of(result.row, "parentUuid").is_some_and(|parent| members.contains(parent)) {
                    results.push(*result);
                } else {
                    elsewhere.push(*result);
                }
            }
        }
        if !elsewhere.is_empty() {
            let mut known = answered.clone();
            known.extend(
                results
                    .iter()
                    .flat_map(|result| block_ids(result.row, "tool_result", "tool_use_id")),
            );
            elsewhere.sort_by_key(|result| result.index);
            for result in elsewhere {
                let ids = block_ids(result.row, "tool_result", "tool_use_id");
                let answers_ours = ids.iter().any(|id| {
                    !known.contains(id)
                        && self
                            .tool_owner
                            .get(id)
                            .copied()
                            .flatten()
                            .and_then(|owner| str_of(owner.row, "uuid"))
                            .is_some_and(|uuid| members.contains(uuid))
                });
                if answers_ours {
                    known.extend(ids);
                    results.push(result);
                }
            }
        }
        let by_time = |left: &&Node<'_>, right: &&Node<'_>| {
            str_of(left.row, "timestamp")
                .unwrap_or_default()
                .cmp(str_of(right.row, "timestamp").unwrap_or_default())
        };
        extra.sort_by(by_time);
        results.sort_by(by_time);
        (extra, results)
    }
}

/// The branch with the rows of each API message it shows that lie beside
/// it, and their tool results: Claude stores one response as several rows,
/// and parallel tool calls and their results may hang off a sibling row.
/// They follow the branch's last row of that message, by time.
fn with_sibling_rows<'a, 'n>(
    nodes: &'n HashMap<&'a str, Node<'a>>,
    branch: Vec<&'n Node<'a>>,
) -> Vec<&'n Node<'a>> {
    let siblings = Siblings::new(nodes);
    let mut included = branch.iter().map(|node| node.index).collect::<HashSet<_>>();
    let mut answered = branch
        .iter()
        .flat_map(|node| block_ids(node.row, "tool_result", "tool_use_id"))
        .collect::<HashSet<_>>();
    let last_of_message = branch
        .iter()
        .filter_map(|node| message_id(node).map(|message| (message, node.index)))
        .collect::<HashMap<_, _>>();
    let mut insertions: HashMap<usize, Vec<&'n Node<'a>>> = HashMap::new();
    let mut seen_messages = HashSet::new();
    for message in branch.iter().filter_map(|node| message_id(node)) {
        if !seen_messages.insert(message) {
            continue;
        }
        let (extra, results) = siblings.missing(message, &included, &answered);
        for added in extra.iter().chain(&results) {
            included.insert(added.index);
            answered.extend(block_ids(added.row, "tool_result", "tool_use_id"));
        }
        if let Some(anchor) = last_of_message.get(message) {
            insertions
                .entry(*anchor)
                .or_default()
                .extend(extra.into_iter().chain(results));
        }
    }
    if insertions.values().all(Vec::is_empty) {
        return branch;
    }
    let mut merged = Vec::with_capacity(branch.len());
    for node in branch {
        let index = node.index;
        merged.push(node);
        if let Some(added) = insertions.remove(&index) {
            merged.extend(added);
        }
    }
    merged
}

fn queued_command(row: &JsonRecord) -> Option<&JsonRecord> {
    (str_of(row, "type") == Some("attachment"))
        .then(|| record_of(row, "attachment"))
        .flatten()
        .filter(|attachment| str_of(attachment, "type") == Some("queued_command"))
}

/// Prompts queued after the leaf that no turn has taken yet.
fn trailing_queued<'a, 'n>(
    nodes: &'n HashMap<&'a str, Node<'a>>,
    branch: &[&'n Node<'a>],
    leaf: &'a str,
) -> Vec<&'n Node<'a>> {
    let on_branch = branch.iter().map(|node| node.index).collect::<HashSet<_>>();
    let mut children: HashMap<&str, Vec<&Node<'a>>> = HashMap::new();
    for node in nodes.values().filter(|node| !is_conversation(node.kind)) {
        if let Some(parent) = str_of(node.row, "parentUuid") {
            children.entry(parent).or_default().push(node);
        }
    }
    // Rows another branch's messages descend from were taken by that branch.
    let mut taken = HashSet::new();
    for node in nodes.values().filter(|node| {
        is_conversation(node.kind) && can_lead(node) && !on_branch.contains(&node.index)
    }) {
        let mut parent = str_of(node.row, "parentUuid").and_then(|parent| nodes.get(parent));
        while let Some(ancestor) = parent {
            if on_branch.contains(&ancestor.index) || !taken.insert(ancestor.index) {
                break;
            }
            parent = str_of(ancestor.row, "parentUuid").and_then(|parent| nodes.get(parent));
        }
    }
    let mut found = Vec::new();
    let mut visited = on_branch.clone();
    let mut pending = vec![leaf];
    while let Some(uuid) = pending.pop() {
        let mut next = children.get(uuid).cloned().unwrap_or_default();
        next.sort_by(|left, right| {
            str_of(left.row, "timestamp")
                .unwrap_or_default()
                .cmp(str_of(right.row, "timestamp").unwrap_or_default())
        });
        for child in next.into_iter().rev() {
            if !visited.insert(child.index) {
                continue;
            }
            if queued_command(child.row).is_some() && !taken.contains(&child.index) {
                found.push(child);
            }
            if let Some(id) = str_of(child.row, "uuid") {
                pending.push(id);
            }
        }
    }
    found.sort_by_key(|node| node.index);
    found
}

/// The branch with each delivered queued prompt as a user message: an
/// attachment a model reply follows (it was delivered into the running
/// turn), and every trailing one. A prompt already stored as its own user
/// message is not repeated.
fn with_queued_prompts<'a>(
    branch: &[&Node<'a>],
    trailing: &[&Node<'a>],
) -> Vec<Cow<'a, JsonRecord>> {
    let rows = branch.iter().chain(trailing).collect::<Vec<_>>();
    let mut replied = vec![false; rows.len()];
    let mut next = None;
    for (position, node) in rows.iter().enumerate().rev() {
        replied[position] = next == Some(true);
        if node.kind == "assistant" || is_tool_result_row(node) {
            next = Some(true);
        } else if node.kind == "user"
            && !is_true(node.row, "isMeta")
            && !is_true(node.row, "isCompactSummary")
        {
            next = Some(false);
        }
    }
    let mut uuids = rows
        .iter()
        .filter_map(|node| str_of(node.row, "uuid"))
        .collect::<HashSet<_>>();
    let trailing_start = branch.len();
    rows.iter()
        .enumerate()
        .map(|(position, node)| {
            let deliver = replied[position] || position >= trailing_start;
            match queued_command(node.row)
                .filter(|_| deliver)
                .and_then(|attachment| queued_prompt(node.row, attachment, &mut uuids))
            {
                Some(prompt) => Cow::Owned(prompt),
                None => Cow::Borrowed(node.row),
            }
        })
        .collect()
}

/// The user message of a queued prompt, or `None` when its source message
/// is stored already or it carries no prompt.
fn queued_prompt<'a>(
    row: &'a JsonRecord,
    attachment: &'a JsonRecord,
    uuids: &mut HashSet<&'a str>,
) -> Option<JsonRecord> {
    let prompt = attachment
        .get("prompt")
        .filter(|prompt| prompt.is_string() || prompt.is_array())?;
    let own = str_of(row, "uuid")?;
    let uuid = str_of(attachment, "source_uuid")
        .filter(|source| !source.is_empty())
        .unwrap_or(own);
    if uuid != own && !uuids.insert(uuid) {
        return None;
    }
    let mut message = JsonRecord::new();
    message.insert("type".into(), Value::from("user"));
    message.insert("uuid".into(), Value::from(uuid));
    for field in [
        "parentUuid",
        "sessionId",
        "timestamp",
        "isSidechain",
        "teamName",
    ] {
        if let Some(value) = row.get(field) {
            message.insert(field.into(), value.clone());
        }
    }
    let mut body = JsonRecord::new();
    body.insert("role".into(), Value::from("user"));
    body.insert("content".into(), prompt.clone());
    message.insert("message".into(), Value::Object(body));
    if is_true(attachment, "isMeta") {
        message.insert("isMeta".into(), Value::Bool(true));
    }
    // A queued task notification records its kind in `commandMode` only.
    match attachment
        .get("origin")
        .filter(|origin| origin.get("kind").is_some_and(Value::is_string))
    {
        Some(origin) => {
            message.insert("origin".into(), origin.clone());
        }
        None if str_of(attachment, "commandMode") == Some("task-notification") => {
            message.insert(
                "origin".into(),
                serde_json::json!({"kind": "task-notification"}),
            );
        }
        None => {}
    }
    message.insert("isQueuedCommand".into(), Value::Bool(true));
    Some(message)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn row(uuid: &str, parent: Option<&str>, kind: &str) -> Value {
        json!({"uuid": uuid, "parentUuid": parent, "type": kind, "message": {"content": uuid}})
    }

    fn ids(rows: &[Value]) -> Vec<String> {
        active_branch(rows)
            .iter()
            .filter_map(|row| str_of(row, "uuid").map(ToOwned::to_owned))
            .collect()
    }

    #[test]
    fn a_rewind_leaves_the_abandoned_branch_out() {
        let rows = [
            row("p1", None, "user"),
            row("a1", Some("p1"), "assistant"),
            row("p2", Some("a1"), "user"),
            row("a2", Some("p2"), "assistant"),
            // The person rewound to after a1 and asked again.
            row("p2b", Some("a1"), "user"),
            row("a2b", Some("p2b"), "assistant"),
        ];
        assert_eq!(ids(&rows), ["p1", "a1", "p2b", "a2b"]);
    }

    #[test]
    fn a_compaction_keeps_the_history_before_it_and_moves_preserved_messages_after_the_summary() {
        let mut boundary = row("b", None, "system");
        boundary["subtype"] = json!("compact_boundary");
        boundary["logicalParentUuid"] = json!("a2");
        boundary["compactMetadata"] =
            json!({"preservedMessages": {"anchorUuid": "s", "uuids": ["a2"]}});
        let mut summary = row("s", Some("b"), "user");
        summary["isCompactSummary"] = json!(true);
        let rows = [
            row("p1", None, "user"),
            row("a1", Some("p1"), "assistant"),
            row("a2", Some("a1"), "assistant"),
            boundary,
            summary,
            row("p3", Some("s"), "user"),
            row("a3", Some("p3"), "assistant"),
        ];
        assert_eq!(ids(&rows), ["p1", "a1", "b", "s", "a2", "p3", "a3"]);
    }

    fn queued(uuid: &str, parent: &str, mode: Option<&str>) -> Value {
        let mut attachment = json!({"type": "queued_command", "prompt": "later", "source_uuid": format!("src-{uuid}")});
        if let Some(mode) = mode {
            attachment["commandMode"] = json!(mode);
        }
        json!({"uuid": uuid, "parentUuid": parent, "type": "attachment", "attachment": attachment})
    }

    #[test]
    fn a_prompt_queued_into_a_running_turn_becomes_a_queued_user_message() {
        let rows = [
            row("p1", None, "user"),
            queued("q1", "p1", None),
            row("a1", Some("q1"), "assistant"),
            queued("n1", "a1", Some("task-notification")),
            row("a2", Some("n1"), "assistant"),
        ];
        let branch = active_branch(&rows);
        let queued = branch
            .iter()
            .filter(|row| is_true(row, "isQueuedCommand"))
            .map(|row| {
                (
                    str_of(row, "uuid").unwrap_or_default().to_owned(),
                    row.get("origin").cloned(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            queued,
            [
                ("src-q1".to_owned(), None),
                (
                    "src-n1".to_owned(),
                    Some(json!({"kind": "task-notification"}))
                ),
            ]
        );
    }

    #[test]
    fn parallel_tool_calls_of_one_response_and_their_results_stay_together() {
        let tool = |uuid: &str, parent: &str, id: &str| {
            json!({"uuid": uuid, "parentUuid": parent, "type": "assistant", "timestamp": "2026-10-01T10:00:01.000Z",
                "message": {"id": "msg_1", "content": [{"type": "tool_use", "id": id, "name": "Bash", "input": {}}]}})
        };
        let result = |uuid: &str, parent: &str, id: &str| {
            json!({"uuid": uuid, "parentUuid": parent, "type": "user", "timestamp": "2026-10-01T10:00:09.000Z",
                "message": {"content": [{"type": "tool_result", "tool_use_id": id, "content": "ok"}]}})
        };
        // The first call's result hangs off its own row beside the branch.
        let rows = [
            row("p1", None, "user"),
            tool("t1", "p1", "toolu_1"),
            tool("t2", "t1", "toolu_2"),
            result("r1", "t1", "toolu_1"),
            result("r2", "t2", "toolu_2"),
            row("a1", Some("r2"), "assistant"),
        ];
        assert_eq!(ids(&rows), ["p1", "t1", "t2", "r1", "r2", "a1"]);
    }

    #[test]
    fn a_message_claude_never_stored_does_not_cut_the_history_before_it() {
        let mut side = row("x", Some("i2"), "assistant");
        side["isSidechain"] = json!(true);
        let rows = [
            row("p1", None, "user"),
            row("a1", Some("p1"), "assistant"),
            row("p2", Some("a1"), "user"),
            row("i2", Some("p2"), "user"),
            side,
            // Claude answered a message it sent without storing it.
            row("a3", Some("lost"), "assistant"),
            row("a4", Some("a3"), "assistant"),
        ];
        assert_eq!(ids(&rows), ["p1", "a1", "p2", "i2", "a3", "a4"]);
    }

    #[test]
    fn side_chains_meta_rows_and_rows_without_uuids_stay_out_and_cycles_end() {
        let mut side = row("x", Some("a1"), "user");
        side["isSidechain"] = json!(true);
        let rows = [
            json!({"type": "ai-title", "aiTitle": "t"}),
            row("p1", None, "user"),
            row("a1", Some("p1"), "assistant"),
            side,
            json!({"type": "attachment", "uuid": "att", "parentUuid": "a1"}),
        ];
        assert_eq!(ids(&rows), ["p1", "a1"]);
        let cycle = [
            row("c1", Some("c2"), "user"),
            row("c2", Some("c1"), "assistant"),
        ];
        assert_eq!(active_branch(&cycle).len(), 2);
    }
}
