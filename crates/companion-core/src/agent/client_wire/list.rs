//! `thread/list` across providers.
//!
//! The primary provider leads pagination. Each page covers a window of the
//! sort key derived from the raw lead page (`desc`: `[b_k, b_(k-1))`, `asc`
//! mirrored), clamped so windows never overlap; non-lead rows inside the
//! window are merged in sort order. With one provider the lead cursor and
//! result pass through byte-for-byte. The composite cursor is
//! `"cwl1." + base64url(JSON {lead, leadDone, bound})`; a raw lead cursor is
//! still accepted.

use std::{cmp::Ordering, sync::Arc};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tracing::warn;

use super::{WireProvider, items};
use crate::agent::{
    model::{AgentThread, SortDirection, SortWindow, ThreadListParams, ThreadSortKey},
    provider::{AgentProvider, ProviderStatus},
};

const COMPOSITE_PREFIX: &str = "cwl1.";
const NON_LEAD_PAGE_SIZE: u32 = 100;
const MAX_NON_LEAD_PAGES: usize = 10;

/// Params the client sends to `thread/list` (callers:
/// `thread-catalog-loader.ts`, `sync-client/session.ts`).
const KNOWN_PARAMS: [&str; 15] = [
    "cursor",
    "limit",
    "sortKey",
    "sortDirection",
    "modelProviders",
    "sourceKinds",
    "originators",
    "archived",
    "sectionId",
    "projectId",
    "cwd",
    "useStateDbOnly",
    "searchTerm",
    "parentThreadId",
    "ancestorThreadId",
];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CompositeCursor {
    lead: Option<String>,
    lead_done: bool,
    /// The previous page's lower window bound (`desc`) or upper bound (`asc`).
    bound: Option<i64>,
}

/// Which non-lead rows a request admits.
#[derive(Clone, Debug, PartialEq)]
struct NonLeadQuery {
    archived: bool,
    cwd: Vec<String>,
    search_term: Option<String>,
    sort_key: ThreadSortKey,
    direction: SortDirection,
    model_providers: Option<Vec<String>>,
}

/// A prepared multi-provider list request.
#[derive(Clone, Debug, PartialEq)]
pub struct ListPlan {
    /// Params for the lead request, or `None` when the lead is exhausted.
    pub lead_params: Option<Value>,
    cursor: CompositeCursor,
    query: Option<NonLeadQuery>,
    passthrough: bool,
}

impl ListPlan {
    /// Whether the lead request and response pass through unchanged.
    #[must_use]
    pub const fn is_passthrough(&self) -> bool {
        self.passthrough
    }
}

fn encode_cursor(cursor: &CompositeCursor) -> Option<String> {
    let encoded = serde_json::to_vec(cursor).ok()?;
    Some(format!(
        "{COMPOSITE_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(encoded)
    ))
}

fn decode_cursor(cursor: &str) -> Option<CompositeCursor> {
    let encoded = cursor.strip_prefix(COMPOSITE_PREFIX)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn string_list(value: Option<&Value>) -> Option<Vec<String>> {
    let values = value?.as_array()?;
    Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    )
}

fn non_lead_query(params: &Map<String, Value>) -> Option<NonLeadQuery> {
    if let Some(unknown) = params
        .keys()
        .find(|key| !KNOWN_PARAMS.contains(&key.as_str()))
    {
        warn!(param = %unknown, "thread/list has an unknown param; only the lead provider answers");
        return None;
    }
    let present = |name: &str| params.get(name).is_some_and(|value| !value.is_null());
    if present("parentThreadId")
        || present("ancestorThreadId")
        || present("sectionId")
        || present("projectId")
        || string_list(params.get("originators")).is_some_and(|list| !list.is_empty())
    {
        return None;
    }
    if let Some(kinds) = string_list(params.get("sourceKinds"))
        && !kinds.is_empty()
        && !kinds
            .iter()
            .any(|kind| matches!(kind.as_str(), "cli" | "vscode" | "appServer"))
    {
        return None;
    }
    let sort_key = match params.get("sortKey").and_then(Value::as_str) {
        None | Some("created_at") => ThreadSortKey::CreatedAt,
        Some("updated_at") => ThreadSortKey::UpdatedAt,
        Some("recency_at") => ThreadSortKey::RecencyAt,
        Some(_) => return None,
    };
    let direction = match params.get("sortDirection").and_then(Value::as_str) {
        Some("asc") => SortDirection::Asc,
        _ => SortDirection::Desc,
    };
    let cwd = match params.get("cwd") {
        Some(Value::String(cwd)) => vec![cwd.clone()],
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    };
    Some(NonLeadQuery {
        archived: params.get("archived").and_then(Value::as_bool) == Some(true),
        cwd,
        search_term: params
            .get("searchTerm")
            .and_then(Value::as_str)
            .map(str::to_owned),
        sort_key,
        direction,
        model_providers: string_list(params.get("modelProviders")).filter(|list| !list.is_empty()),
    })
}

/// Prepares a list request. `multi_provider` false keeps the request intact.
#[must_use]
pub fn prepare(params: &Value, multi_provider: bool) -> ListPlan {
    if !multi_provider {
        return ListPlan {
            lead_params: Some(params.clone()),
            cursor: CompositeCursor::default(),
            query: None,
            passthrough: true,
        };
    }
    let object = params.as_object().cloned().unwrap_or_default();
    let cursor = match object.get("cursor").and_then(Value::as_str) {
        Some(text) => decode_cursor(text).unwrap_or_else(|| CompositeCursor {
            lead: Some(text.to_owned()),
            ..CompositeCursor::default()
        }),
        None => CompositeCursor::default(),
    };
    let lead_params = (!cursor.lead_done).then(|| {
        let mut lead = object.clone();
        lead.insert("cursor".into(), serde_json::json!(cursor.lead));
        Value::Object(lead)
    });
    ListPlan {
        lead_params,
        query: non_lead_query(&object),
        cursor,
        passthrough: false,
    }
}

fn row_key(row: &Value, sort_key: ThreadSortKey) -> Option<i64> {
    let field = |name: &str| row.get(name).and_then(Value::as_i64);
    match sort_key {
        ThreadSortKey::CreatedAt => field("createdAt"),
        ThreadSortKey::UpdatedAt => field("updatedAt"),
        ThreadSortKey::RecencyAt => field("recencyAt").or_else(|| field("updatedAt")),
    }
}

fn thread_key(thread: &AgentThread, sort_key: ThreadSortKey) -> i64 {
    match sort_key {
        ThreadSortKey::CreatedAt => thread.created_at,
        ThreadSortKey::UpdatedAt => thread.updated_at,
        ThreadSortKey::RecencyAt => thread.recency_at.unwrap_or(thread.updated_at),
    }
}

/// The window this page covers, from the raw lead page.
fn window(
    plan: &ListPlan,
    query: &NonLeadQuery,
    raw_lead: Option<&Value>,
) -> (SortWindow, Option<i64>, bool) {
    let rows = raw_lead
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array);
    let lead_exhausted =
        raw_lead.is_none_or(|result| result.get("nextCursor").is_none_or(Value::is_null));
    let keys = rows
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row_key(row, query.sort_key))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let previous = plan.cursor.bound;
    match query.direction {
        SortDirection::Desc => {
            let edge = if lead_exhausted {
                None
            } else {
                keys.iter().min().copied()
            };
            let edge = match (edge, previous) {
                (Some(edge), Some(previous)) => Some(edge.min(previous)),
                (edge, _) => edge,
            };
            (
                SortWindow {
                    lower: edge,
                    lower_inclusive: true,
                    upper: previous,
                    upper_inclusive: false,
                },
                edge,
                lead_exhausted,
            )
        }
        SortDirection::Asc => {
            let edge = if lead_exhausted {
                None
            } else {
                keys.iter().max().copied()
            };
            let edge = match (edge, previous) {
                (Some(edge), Some(previous)) => Some(edge.max(previous)),
                (edge, _) => edge,
            };
            (
                SortWindow {
                    lower: previous,
                    lower_inclusive: false,
                    upper: edge,
                    upper_inclusive: true,
                },
                edge,
                lead_exhausted,
            )
        }
    }
}

/// Fetches the non-lead rows of one window from every live non-lead
/// provider (at most `MAX_NON_LEAD_PAGES` pages each).
async fn fetch_non_lead(
    providers: &[(Arc<dyn AgentProvider>, WireProvider)],
    query: &NonLeadQuery,
    window: SortWindow,
) -> (Vec<(i64, Value)>, bool) {
    let mut rows = Vec::new();
    let mut truncated = false;
    for (provider, wire) in providers {
        if provider.status() != ProviderStatus::Live {
            continue;
        }
        if let Some(allowed) = &query.model_providers
            && !allowed.contains(&wire.descriptor.model_provider)
        {
            continue;
        }
        let mut cursor = None;
        for page in 0..MAX_NON_LEAD_PAGES {
            let result = provider
                .thread_list(ThreadListParams {
                    archived: query.archived,
                    cwd: (query.cwd.len() == 1).then(|| query.cwd[0].clone()),
                    search_term: query.search_term.clone(),
                    sort_key: query.sort_key,
                    sort_direction: query.direction,
                    window: Some(window),
                    cursor: cursor.take(),
                    limit: NON_LEAD_PAGE_SIZE,
                })
                .await;
            let result = match result {
                Ok(result) => result,
                Err(err) => {
                    warn!(provider = %wire.descriptor.id, err = %err, "non-lead thread/list page failed");
                    break;
                }
            };
            for thread in result.threads {
                if query.cwd.len() > 1 && !query.cwd.contains(&thread.cwd) {
                    continue;
                }
                rows.push((
                    thread_key(&thread, query.sort_key),
                    items::thread(&thread, wire, &[]),
                ));
            }
            match result.next_cursor {
                Some(next) if page + 1 < MAX_NON_LEAD_PAGES => cursor = Some(next),
                Some(_) => truncated = true,
                None => break,
            }
        }
    }
    (rows, truncated)
}

/// Merges non-lead rows into the processed lead result and replaces the
/// cursor. `raw_lead` is the lead response before catalog filtering.
pub async fn finish(
    plan: &ListPlan,
    raw_lead: Option<&Value>,
    lead_result: Value,
    non_lead: &[(Arc<dyn AgentProvider>, WireProvider)],
) -> Value {
    if plan.passthrough {
        return lead_result;
    }
    let mut result = lead_result;
    let Some(object) = result.as_object_mut() else {
        return result;
    };
    let lead_next = raw_lead
        .and_then(|raw| raw.get("nextCursor"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let Some(query) = &plan.query else {
        // No non-lead row can match: the lead cursor passes through raw.
        return result;
    };
    let (window, mut edge, lead_exhausted) = window(plan, query, raw_lead);
    let (mut extra, truncated) = fetch_non_lead(non_lead, query, window).await;
    let descending = query.direction == SortDirection::Desc;
    extra.sort_by(|left, right| {
        let order = left.0.cmp(&right.0);
        if descending { order.reverse() } else { order }
    });
    if truncated && let Some(last) = extra.last() {
        // The excess moves on: the next window starts at the last emitted key.
        edge = Some(last.0);
    }
    let rows = object
        .remove("data")
        .and_then(|data| match data {
            Value::Array(rows) => Some(rows),
            _ => None,
        })
        .unwrap_or_default();
    object.insert(
        "data".into(),
        Value::Array(merge_rows(rows, extra, query.sort_key, descending)),
    );
    let next = if lead_exhausted && !truncated {
        None
    } else {
        encode_cursor(&CompositeCursor {
            lead: lead_next,
            lead_done: lead_exhausted,
            bound: edge,
        })
    };
    object.insert("nextCursor".into(), next.map_or(Value::Null, Value::String));
    result
}

fn merge_rows(
    lead: Vec<Value>,
    extra: Vec<(i64, Value)>,
    sort_key: ThreadSortKey,
    descending: bool,
) -> Vec<Value> {
    let mut merged = Vec::with_capacity(lead.len() + extra.len());
    let mut extra = extra.into_iter().peekable();
    for row in lead {
        if let Some(key) = row_key(&row, sort_key) {
            while let Some((extra_key, _)) = extra.peek() {
                let before = match extra_key.cmp(&key) {
                    Ordering::Greater => descending,
                    Ordering::Less => !descending,
                    Ordering::Equal => false,
                };
                if !before {
                    break;
                }
                if let Some((_, value)) = extra.next() {
                    merged.push(value);
                }
            }
        }
        merged.push(row);
    }
    merged.extend(extra.map(|(_, value)| value));
    merged
}

/// Ids of the rows a lead page listed, for binding observation.
#[must_use]
pub fn lead_row_ids(result: &Value) -> Vec<String> {
    result
        .get("data")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests;
