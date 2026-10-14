//! Where the Agent SDK's `forkSession` cuts a session file at a message.
//!
//! The SDK finds the cut with its own branch read (`bu` in `sdk.mjs`): the
//! messages a compaction preserved relinked after their anchor, the newest
//! leaf whose ancestry reaches a user or assistant message, walked back
//! through `parentUuid`. The cut keeps the rows up to the message (by file
//! order) and then leaves out the rows that would make another branch the
//! newest one when Claude resumes the copy: compact boundaries after the
//! branch's start that the branch neither descends from nor preserves, and
//! newer leaves of abandoned branches, each with its descendants.
//!
//! This read differs from [`crate::transcript::chain`] on purpose: it is the
//! SDK's, without the parentless-boundary relink and without merging sibling
//! rows of one API message (siblings never decide which rows a cut keeps).
//! Pure.

use std::{
    cmp::Reverse,
    collections::{HashMap, HashSet},
};

use serde_json::{Map, Value};

use crate::transcript::json::{JsonRecord, arr_of, record_of, str_of};

const COMPACT_BOUNDARY: &str = "compact_boundary";
/// The uuid of the leaf the cut appends to find the branch through its last
/// row; never the uuid of a stored row.
const CUT_LEAF: &str = "codewide-fork-cut-leaf";

/// The SDK's active branch of some rows.
#[derive(Debug, Default)]
pub(super) struct Branch {
    /// Positions of the branch rows, oldest first.
    pub chain: Vec<usize>,
    /// The leaf the branch was found from, when a leaf walk found it.
    pub terminal: Option<usize>,
}

/// JavaScript truthiness of an optional JSON value.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|number| number != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

fn uuid(row: &JsonRecord) -> &str {
    str_of(row, "uuid").unwrap_or_default()
}

fn parent(row: &JsonRecord) -> Option<&str> {
    str_of(row, "parentUuid").filter(|parent| !parent.is_empty())
}

fn kind(row: &JsonRecord) -> &str {
    str_of(row, "type").unwrap_or_default()
}

fn is_conversation(row: &JsonRecord) -> bool {
    matches!(kind(row), "user" | "assistant")
}

fn is_compact_boundary(row: &JsonRecord) -> bool {
    kind(row) == "system" && str_of(row, "subtype") == Some(COMPACT_BOUNDARY)
}

/// Rows by uuid: the last row of each uuid, iterated in the order each uuid
/// first appears (a JavaScript `Map` filled row by row).
struct Nodes<'a> {
    order: Vec<&'a str>,
    last: HashMap<&'a str, usize>,
}

impl<'a> Nodes<'a> {
    fn new(rows: &[&'a JsonRecord]) -> Self {
        let mut nodes = Self {
            order: Vec::new(),
            last: HashMap::new(),
        };
        for (position, row) in rows.iter().enumerate() {
            let id = uuid(row);
            if nodes.last.insert(id, position).is_none() {
                nodes.order.push(id);
            }
        }
        nodes
    }
}

/// Parents after the SDK's compaction relinks: preserved messages follow
/// their anchor and whatever followed the anchor follows the last of them.
fn relinked<'a>(rows: &[&'a JsonRecord], nodes: &Nodes<'a>) -> HashMap<&'a str, Option<&'a str>> {
    let mut parents = nodes
        .order
        .iter()
        .map(|id| (*id, parent(rows[nodes.last[id]])))
        .collect::<HashMap<_, _>>();
    for id in &nodes.order {
        let row = rows[nodes.last[id]];
        if !is_compact_boundary(row) {
            continue;
        }
        let Some(metadata) = record_of(row, "compactMetadata") else {
            continue;
        };
        if truthy(metadata.get("preservedMessages")) {
            if let Some(messages) = record_of(metadata, "preservedMessages") {
                relink_messages(messages, nodes, &mut parents);
            }
        } else if let Some(segment) = record_of(metadata, "preservedSegment") {
            relink_segment(segment, nodes, &mut parents);
        }
    }
    parents
}

fn relink_messages<'a>(
    messages: &'a JsonRecord,
    nodes: &Nodes<'a>,
    parents: &mut HashMap<&'a str, Option<&'a str>>,
) {
    let uuids = arr_of(messages, "uuids");
    let kept = uuids
        .iter()
        .map(|id| id.as_str().filter(|id| nodes.last.contains_key(id)))
        .collect::<Option<Vec<_>>>();
    let Some(kept) = kept.filter(|kept| !kept.is_empty()) else {
        return;
    };
    let anchor = str_of(messages, "anchorUuid");
    let mut previous = anchor;
    for id in &kept {
        parents.insert(id, previous);
        previous = Some(id);
    }
    let (first, last) = (kept[0], kept[kept.len() - 1]);
    if anchor.is_some() {
        for (id, parent) in parents.iter_mut() {
            if *parent == anchor && *id != first {
                *parent = Some(last);
            }
        }
    }
}

fn relink_segment<'a>(
    segment: &'a JsonRecord,
    nodes: &Nodes<'a>,
    parents: &mut HashMap<&'a str, Option<&'a str>>,
) {
    let head = str_of(segment, "headUuid");
    let anchor = str_of(segment, "anchorUuid");
    if let Some(head) = head.filter(|head| nodes.last.contains_key(head)) {
        parents.insert(head, anchor);
    }
    if anchor.is_some() {
        let tail = str_of(segment, "tailUuid");
        for (id, parent) in parents.iter_mut() {
            if *parent == anchor && Some(*id) != head {
                *parent = tail;
            }
        }
    }
}

/// Whether a row may end the branch. `stripped` reads rows as the cut
/// copies them: neither a side chain nor a team row.
fn can_lead(row: &JsonRecord, stripped: bool) -> bool {
    (stripped || (!truthy(row.get("isSidechain")) && !truthy(row.get("teamName"))))
        && kind(row) != "progress"
        && !(kind(row) == "attachment"
            && record_of(row, "attachment").and_then(|attachment| str_of(attachment, "type"))
                == Some("fork_briefing"))
}

/// The SDK's branch of `rows`.
pub(super) fn branch(rows: &[&JsonRecord], stripped: bool) -> Branch {
    let nodes = Nodes::new(rows);
    let parents = relinked(rows, &nodes);
    let parent_of = |id: &str| parents.get(id).copied().flatten();
    let referenced = parents.values().flatten().copied().collect::<HashSet<_>>();
    let leading_parents = nodes
        .order
        .iter()
        .filter(|id| can_lead(rows[nodes.last[*id]], stripped))
        .filter_map(|id| parent_of(id))
        .collect::<HashSet<_>>();
    let mut candidates = nodes
        .order
        .iter()
        .copied()
        .filter(|id| can_lead(rows[nodes.last[id]], stripped) && !leading_parents.contains(id))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|id| Reverse(nodes.last[id]));
    let mut walked = HashSet::new();
    let mut found = None;
    for candidate in candidates {
        let mut path = Vec::new();
        let mut seen = HashSet::new();
        let mut current = Some(candidate);
        while let Some(id) = current {
            let Some(&position) = nodes.last.get(id) else {
                break;
            };
            if walked.contains(id) || !seen.insert(id) {
                break;
            }
            if is_conversation(rows[position]) {
                found = Some((id, candidate));
                break;
            }
            path.push(id);
            current = parent_of(id);
        }
        if found.is_some() {
            break;
        }
        walked.extend(path);
    }
    let (leaf, terminal) = match found {
        Some((leaf, terminal)) => (leaf, Some(nodes.last[terminal])),
        None => match fallback_leaf(rows, &nodes, &referenced, &parent_of, stripped) {
            Some(leaf) => (leaf, None),
            None => return Branch::default(),
        },
    };
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut current = Some(leaf);
    while let Some(id) = current {
        let Some(&position) = nodes.last.get(id) else {
            break;
        };
        if !seen.insert(id) {
            break;
        }
        chain.push(position);
        current = parent_of(id);
    }
    chain.reverse();
    Branch { chain, terminal }
}

/// Without a leading leaf: the newest conversation message any leaf reaches,
/// preferring one that is neither a side chain, a team nor a meta row.
fn fallback_leaf<'a>(
    rows: &[&'a JsonRecord],
    nodes: &Nodes<'a>,
    referenced: &HashSet<&'a str>,
    parent_of: &impl Fn(&str) -> Option<&'a str>,
    stripped: bool,
) -> Option<&'a str> {
    let mut reached = Vec::new();
    for leaf in nodes.order.iter().filter(|id| !referenced.contains(*id)) {
        let mut seen = HashSet::new();
        let mut current = Some(*leaf);
        while let Some(id) = current {
            let Some(&position) = nodes.last.get(id) else {
                break;
            };
            if !seen.insert(id) {
                break;
            }
            if is_conversation(rows[position]) {
                reached.push(id);
                break;
            }
            current = parent_of(id);
        }
    }
    let plain = |id: &&'a str| {
        let row = rows[nodes.last[*id]];
        (stripped || (!truthy(row.get("isSidechain")) && !truthy(row.get("teamName"))))
            && !truthy(row.get("isMeta"))
    };
    newest(nodes, reached.iter().copied().filter(plain))
        .or_else(|| newest(nodes, reached.iter().copied()))
}

/// The id with the latest row; the earliest listed wins a tie.
fn newest<'a>(nodes: &Nodes<'a>, ids: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    ids.fold(None, |best, id| match best {
        Some(best) if nodes.last[id] <= nodes.last[best] => Some(best),
        _ => Some(id),
    })
}

/// The position of the row `up_to` names in `rows`: by uuid, else the
/// queued prompt whose `source_uuid` it is, looked up first on the branch
/// and the rows after it, then in the whole file.
fn cut_position(rows: &[&JsonRecord], up_to: &str) -> Option<usize> {
    let mut first = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        first.entry(uuid(row)).or_insert(position);
    }
    let chain = branch(rows, false).chain;
    let after = chain
        .iter()
        .filter_map(|position| first.get(uuid(rows[*position])).copied())
        .max()
        .map_or(0, |last| last + 1);
    let near = || chain.iter().copied().chain(after..rows.len());
    let by_uuid = |position: &usize| uuid(rows[*position]) == up_to;
    let by_source = |position: &usize| queued_source(rows[*position]) == Some(up_to);
    near()
        .find(by_uuid)
        .or_else(|| near().find(by_source))
        .and_then(|position| first.get(uuid(rows[position])).copied())
        .or_else(|| (0..rows.len()).find(by_uuid))
        .or_else(|| (0..rows.len()).find(by_source))
}

/// The prompt uuid a queued-command attachment delivers.
pub(super) fn queued_source(row: &JsonRecord) -> Option<&str> {
    let attachment = record_of(row, "attachment").filter(|_| kind(row) == "attachment")?;
    (str_of(attachment, "type") == Some("queued_command"))
        .then(|| str_of(attachment, "source_uuid"))
        .flatten()
        .filter(|source| !source.is_empty())
}

/// The positions of `rows` a fork through `up_to` copies, in file order;
/// `None` when no row is that message.
pub(super) fn cut(rows: &[&JsonRecord], up_to: &str) -> Option<Vec<usize>> {
    let end = cut_position(rows, up_to)?;
    Some(prune(&rows[..=end]))
}

/// The SDK's `uuids` a compaction preserved, as its prune reads them.
fn preserved_ids(row: &JsonRecord) -> Vec<&str> {
    let Some(metadata) = record_of(row, "compactMetadata") else {
        return Vec::new();
    };
    let mut ids = record_of(metadata, "preservedMessages")
        .map(|messages| {
            arr_of(messages, "uuids")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(segment) = record_of(metadata, "preservedSegment") {
        ids.extend(
            ["headUuid", "tailUuid"]
                .iter()
                .filter_map(|key| str_of(segment, key)),
        );
    }
    ids
}

/// What the prune knows of the cut slice.
struct Prune<'s, 'a> {
    slice: &'s [&'a JsonRecord],
    first: HashMap<&'a str, usize>,
    last: HashMap<&'a str, &'a JsonRecord>,
    live: HashSet<&'a str>,
    start: usize,
    left_out: HashSet<&'a str>,
}

impl<'a> Prune<'_, 'a> {
    /// A row off the branch's ancestry at or after the branch's start.
    fn is_dead(&self, row: &JsonRecord) -> bool {
        let id = uuid(row);
        !self.live.contains(id) && self.first.get(id).copied().unwrap_or(self.start) >= self.start
    }

    /// Leaves out `row`, its dead ancestors and every row hanging off them.
    fn leave_out(&mut self, row: &'a JsonRecord) {
        let mut current = self.last.get(uuid(row)).copied();
        while let Some(row) = current {
            if !self.is_dead(row) || !self.left_out.insert(uuid(row)) {
                break;
            }
            current = parent(row).and_then(|parent| self.last.get(parent).copied());
        }
        for row in self.slice {
            if parent(row).is_some_and(|parent| self.left_out.contains(parent)) {
                self.left_out.insert(uuid(row));
            }
        }
    }
}

/// The SDK's prune of a cut slice (`lve`): keeps the branch through the
/// slice's last row the newest one.
fn prune(slice: &[&JsonRecord]) -> Vec<usize> {
    let everything = || (0..slice.len()).collect::<Vec<_>>();
    let Some(last_row) = slice.last() else {
        return Vec::new();
    };
    let mut leaf = Map::new();
    leaf.insert("type".to_owned(), Value::from("system"));
    leaf.insert("uuid".to_owned(), Value::from(CUT_LEAF));
    leaf.insert("parentUuid".to_owned(), Value::from(uuid(last_row)));
    let mut with_leaf = slice.to_vec();
    with_leaf.push(&leaf);
    let through = branch(&with_leaf, true).chain;
    let mut first = HashMap::new();
    let mut last = HashMap::new();
    for (position, row) in slice.iter().enumerate() {
        first.entry(uuid(row)).or_insert(position);
        last.insert(uuid(row), *row);
    }
    let Some(start) = through
        .first()
        .and_then(|head| first.get(uuid(with_leaf[*head])).copied())
    else {
        return everything();
    };
    let branch_ids = through
        .iter()
        .map(|position| uuid(with_leaf[*position]))
        .collect::<HashSet<_>>();
    let mut live = HashSet::new();
    for id in std::iter::once(uuid(last_row)).chain(branch_ids.iter().copied()) {
        let mut current = last.get(id).copied();
        while let Some(row) = current {
            if !live.insert(uuid(row)) {
                break;
            }
            current = parent(row).and_then(|parent| last.get(parent).copied());
        }
    }
    let mut prune = Prune {
        slice,
        first,
        last,
        live,
        start,
        left_out: HashSet::new(),
    };
    for row in slice {
        if is_compact_boundary(row)
            && prune.is_dead(row)
            && !preserved_ids(row).iter().any(|id| prune.live.contains(id))
        {
            prune.leave_out(row);
        }
    }
    loop {
        let remaining = slice
            .iter()
            .copied()
            .filter(|row| !prune.left_out.contains(uuid(row)))
            .collect::<Vec<_>>();
        let found = branch(&remaining, true);
        if found.chain.len() == branch_ids.len()
            && found
                .chain
                .iter()
                .all(|position| branch_ids.contains(uuid(remaining[*position])))
        {
            break;
        }
        let Some(terminal) = found
            .terminal
            .map(|position| remaining[position])
            .filter(|row| prune.is_dead(row))
        else {
            break;
        };
        prune.leave_out(terminal);
    }
    if prune.left_out.is_empty() {
        return everything();
    }
    (0..slice.len())
        .filter(|position| !prune.left_out.contains(uuid(slice[*position])))
        .collect()
}

/// Whether a row is a side-chain row, which a fork never copies.
pub(super) fn is_side_chain(row: &JsonRecord) -> bool {
    truthy(row.get("isSidechain"))
}
