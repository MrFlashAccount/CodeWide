//! Token and cost accounting of Claude turns. Pure; no I/O.
//!
//! The CLI reports usage as cumulative per-model totals (`modelUsage`) on
//! every result of one session process; they cover the main loop, Task
//! subagents, sidechains and internal calls such as compaction. A turn's usage
//! is the difference between a result's totals and an earlier snapshot of the
//! same running total (the baseline). The companion persists the last few
//! snapshots of the thread's current Claude session (checkpoints, newest
//! first). Rules:
//! - a result whose totals are all zero (crash and startup-error results)
//!   measures nothing and keeps the baseline;
//! - totals that cover the newest checkpoint (every model in it, every counter
//!   at least as high) continue it: the usual case, also for a resumed session
//!   that restored the totals its transcript saved;
//! - otherwise the running total restarted: a resumed session restored older
//!   saved totals, or none, or a mid-session `/clear` reset it. The result is
//!   measured from the newest checkpoint it covers, else from zero. A restart
//!   whose fresh totals happen to cover an old checkpoint is under-counted by
//!   that checkpoint (a documented limit: the CLI does not say which happened);
//! - without a baseline (a session the companion did not start, or state written
//!   before the baseline existed) the first result's totals may include
//!   earlier usage, so that result counts only its main-loop `usage` (per
//!   turn, subagents excluded) with an unknown cost, and sets the baseline;
//! - a turn's cost is known only when every model it used was priced from a
//!   known price table (`costBasis` `list` or `managed`).
//!
//! Between results, [`LiveUsageMeter`] reports each complete top-level model
//! request, and [`model_context_window`] supplies a context window before any
//! result has named one.

use std::{cmp::Ordering, collections::HashMap};

use agent_core::model::{ProviderCost, ProviderCostBasis, TokenUsage};
use serde::{Deserialize, Serialize};

use crate::transcript::frames::{ClaudeFrame, CostBasis, ModelTotals, RequestFigures, ResultFrame};

/// One model's cumulative counters, as kept in the persisted baseline
/// (`state.json` field names).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCounters {
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub cost_usd: f64,
    pub input_tokens: i64,
    /// The `modelUsage` key (raw model string).
    pub model: String,
    pub output_tokens: i64,
    pub thinking_tokens: i64,
}

/// One snapshot of a session's running total: every model's counters.
pub type UsageSnapshot = Vec<ModelCounters>;

/// Snapshots of the thread's current Claude session that results are
/// measured from. Persisted as `{"type":"known","checkpoints":[...]}` or
/// `{"type":"unknown"}`; a state file without the field means
/// [`UsageBaseline::Unknown`] (the reader of `state.json` owns that default).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UsageBaseline {
    /// The latest snapshots, newest first; empty for a session that has used
    /// nothing. At most [`MAX_CHECKPOINTS`].
    Known { checkpoints: Vec<UsageSnapshot> },
    /// The session may hold usage the companion never measured.
    Unknown,
}

/// The baseline of a session the companion starts itself.
pub const NEW_SESSION_BASELINE: UsageBaseline = UsageBaseline::Known {
    checkpoints: Vec::new(),
};

/// How many snapshots a baseline keeps.
pub const MAX_CHECKPOINTS: usize = 8;

/// What a turn (or one result of it) cost. Not persisted.
#[derive(Clone, Debug, PartialEq)]
pub enum TurnCost {
    /// No model request happened.
    None,
    /// A model was priced from no known table; the CLI's figure is a guess.
    Unpriced,
    Priced {
        basis: ProviderCostBasis,
        /// Priced model ids, without duplicates, in first-use order.
        models: Vec<String>,
        usd: f64,
    },
}

/// The thread's cumulative cost: known only while every turn's cost was
/// known. Persisted as `totalCost` in `state.json`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ThreadCost {
    Known { usd: f64 },
    Unknown,
}

/// Usage measured from one or more results.
#[derive(Clone, Debug, PartialEq)]
pub struct UsageDelta {
    /// The largest context window any model of the latest result reported.
    pub context_window: Option<i64>,
    pub cost: TurnCost,
    pub usage: TokenUsage,
}

/// Usage of nothing. Carries an explicit zero cache-write count, as every
/// sum built here does.
pub const ZERO_USAGE: TokenUsage = TokenUsage {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: Some(0),
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
};

const NANO_USD_PER_USD: f64 = 1e9;

/// Rounds a USD amount to whole nano-dollars, so float noise from
/// differencing never shows.
fn round_usd(value: f64) -> f64 {
    (value * NANO_USD_PER_USD).round() / NANO_USD_PER_USD
}

/// The numeric counters of one model, without its id.
#[derive(Clone, Copy, Debug, Default)]
struct Counters {
    cache_creation_input_tokens: i64,
    cache_read_input_tokens: i64,
    cost_usd: f64,
    input_tokens: i64,
    output_tokens: i64,
    thinking_tokens: i64,
}

impl Counters {
    const fn of_totals(totals: &ModelTotals) -> Self {
        Self {
            cache_creation_input_tokens: totals.cache_creation_input_tokens,
            cache_read_input_tokens: totals.cache_read_input_tokens,
            cost_usd: totals.cost_usd,
            input_tokens: totals.input_tokens,
            output_tokens: totals.output_tokens,
            thinking_tokens: totals.thinking_tokens,
        }
    }

    const fn of_snapshot(entry: &ModelCounters) -> Self {
        Self {
            cache_creation_input_tokens: entry.cache_creation_input_tokens,
            cache_read_input_tokens: entry.cache_read_input_tokens,
            cost_usd: entry.cost_usd,
            input_tokens: entry.input_tokens,
            output_tokens: entry.output_tokens,
            thinking_tokens: entry.thinking_tokens,
        }
    }

    /// Whether every counter is zero (`-0.0` counts as zero).
    fn is_zero(&self) -> bool {
        self.cache_creation_input_tokens == 0
            && self.cache_read_input_tokens == 0
            && self.cost_usd.partial_cmp(&0.0) == Some(Ordering::Equal)
            && self.input_tokens == 0
            && self.output_tokens == 0
            && self.thinking_tokens == 0
    }

    /// Whether no counter is lower than the same counter of `earlier`.
    fn at_least(&self, earlier: &Self) -> bool {
        self.cache_creation_input_tokens >= earlier.cache_creation_input_tokens
            && self.cache_read_input_tokens >= earlier.cache_read_input_tokens
            && self.cost_usd >= earlier.cost_usd
            && self.input_tokens >= earlier.input_tokens
            && self.output_tokens >= earlier.output_tokens
            && self.thinking_tokens >= earlier.thinking_tokens
    }

    /// Per-counter growth since `previous`, never negative.
    fn since(&self, previous: &Self) -> Self {
        let grown = |now: i64, before: i64| now.saturating_sub(before).max(0);
        Self {
            cache_creation_input_tokens: grown(
                self.cache_creation_input_tokens,
                previous.cache_creation_input_tokens,
            ),
            cache_read_input_tokens: grown(
                self.cache_read_input_tokens,
                previous.cache_read_input_tokens,
            ),
            cost_usd: round_usd(self.cost_usd - previous.cost_usd).max(0.0),
            input_tokens: grown(self.input_tokens, previous.input_tokens),
            output_tokens: grown(self.output_tokens, previous.output_tokens),
            thinking_tokens: grown(self.thinking_tokens, previous.thinking_tokens),
        }
    }

    /// Neutral counters: the CLI's `input_tokens` excludes cache reads and
    /// writes, the neutral `input_tokens` includes them.
    fn token_usage(&self) -> TokenUsage {
        neutral_usage(
            self.input_tokens,
            self.cache_read_input_tokens,
            self.cache_creation_input_tokens,
            self.output_tokens,
            self.thinking_tokens,
        )
    }
}

fn neutral_usage(
    uncached_input: i64,
    cache_read: i64,
    cache_write: i64,
    output: i64,
    reasoning: i64,
) -> TokenUsage {
    let input = uncached_input
        .saturating_add(cache_read)
        .saturating_add(cache_write);
    TokenUsage {
        input_tokens: input,
        cached_input_tokens: cache_read,
        cache_write_input_tokens: Some(cache_write),
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: input.saturating_add(output),
    }
}

impl ModelCounters {
    fn of_totals(totals: &ModelTotals) -> Self {
        Self {
            cache_creation_input_tokens: totals.cache_creation_input_tokens,
            cache_read_input_tokens: totals.cache_read_input_tokens,
            cost_usd: totals.cost_usd,
            input_tokens: totals.input_tokens,
            model: totals.model.clone(),
            output_tokens: totals.output_tokens,
            thinking_tokens: totals.thinking_tokens,
        }
    }
}

/// Whether `current` continues `snapshot`: it holds every model of it with no
/// counter lower.
fn covers(current: &HashMap<&str, Counters>, snapshot: &[ModelCounters]) -> bool {
    snapshot.iter().all(|entry| {
        current
            .get(entry.model.as_str())
            .is_some_and(|now| now.at_least(&Counters::of_snapshot(entry)))
    })
}

/// The context size of one model request (`last`): its prompt and output,
/// without a reasoning split (the request figures carry none).
#[must_use]
pub fn request_usage(figures: &RequestFigures) -> TokenUsage {
    neutral_usage(
        figures.input_tokens,
        figures.cache_read_input_tokens,
        figures.cache_creation_input_tokens,
        figures.output_tokens,
        0,
    )
}

/// Counter-wise sum; an absent cache-write count adds as zero and the sum
/// always carries one.
#[must_use]
pub fn add_usage(left: TokenUsage, right: TokenUsage) -> TokenUsage {
    TokenUsage {
        input_tokens: left.input_tokens.saturating_add(right.input_tokens),
        cached_input_tokens: left
            .cached_input_tokens
            .saturating_add(right.cached_input_tokens),
        cache_write_input_tokens: Some(
            left.cache_write_input_tokens
                .unwrap_or(0)
                .saturating_add(right.cache_write_input_tokens.unwrap_or(0)),
        ),
        output_tokens: left.output_tokens.saturating_add(right.output_tokens),
        reasoning_output_tokens: left
            .reasoning_output_tokens
            .saturating_add(right.reasoning_output_tokens),
        total_tokens: left.total_tokens.saturating_add(right.total_tokens),
    }
}

/// The cost of two measurements together: `None` is neutral, `Unpriced`
/// absorbs, and two priced costs add (`Managed` wins over `List`).
#[must_use]
pub fn add_cost(left: TurnCost, right: TurnCost) -> TurnCost {
    match (left, right) {
        (TurnCost::None, other) | (other, TurnCost::None) => other,
        (TurnCost::Unpriced, _) | (_, TurnCost::Unpriced) => TurnCost::Unpriced,
        (
            TurnCost::Priced {
                basis: left_basis,
                mut models,
                usd: left_usd,
            },
            TurnCost::Priced {
                basis: right_basis,
                models: right_models,
                usd: right_usd,
            },
        ) => {
            for model in right_models {
                if !models.contains(&model) {
                    models.push(model);
                }
            }
            TurnCost::Priced {
                basis: if left_basis == ProviderCostBasis::Managed
                    || right_basis == ProviderCostBasis::Managed
                {
                    ProviderCostBasis::Managed
                } else {
                    ProviderCostBasis::List
                },
                models,
                usd: round_usd(left_usd + right_usd),
            }
        }
    }
}

/// The cost of one model's growth within a result.
fn model_cost(totals: &ModelTotals, delta: &Counters) -> TurnCost {
    let basis = match totals.cost_basis {
        CostBasis::List => ProviderCostBasis::List,
        CostBasis::Managed => ProviderCostBasis::Managed,
        CostBasis::Unknown => return TurnCost::Unpriced,
    };
    TurnCost::Priced {
        basis,
        models: vec![
            totals
                .canonical_model
                .as_ref()
                .unwrap_or(&totals.model)
                .clone(),
        ],
        usd: delta.cost_usd,
    }
}

/// The largest context window any model of a result reported.
fn result_context_window(totals: &[ModelTotals]) -> Option<i64> {
    totals.iter().filter_map(|entry| entry.context_window).max()
}

/// The figures of one result that usage accounting reads.
#[derive(Clone, Copy, Debug)]
pub struct ResultFigures<'a> {
    /// The result's own main-loop usage (per turn; subagents excluded).
    pub main_loop: Option<RequestFigures>,
    /// Cumulative per-model totals of the session process.
    pub totals: &'a [ModelTotals],
}

impl<'a> ResultFigures<'a> {
    /// The figures a `result` frame carries.
    #[must_use]
    pub fn of(frame: &'a ResultFrame) -> Self {
        Self {
            main_loop: frame.main_loop_usage,
            totals: &frame.model_usage,
        }
    }
}

/// Measures one result's cumulative totals against `baseline`. Returns the
/// usage the result adds and advances `baseline` to the result's totals, or
/// returns `None` and leaves `baseline` untouched for a result with zeroed
/// totals.
pub fn meter_result(baseline: &mut UsageBaseline, result: ResultFigures<'_>) -> Option<UsageDelta> {
    let totals = result.totals;
    let current: Vec<Counters> = totals.iter().map(Counters::of_totals).collect();
    if current.iter().all(Counters::is_zero) {
        return None;
    }
    let snapshot: UsageSnapshot = totals.iter().map(ModelCounters::of_totals).collect();
    let context_window = result_context_window(totals);
    let checkpoints = match baseline {
        UsageBaseline::Unknown => {
            *baseline = UsageBaseline::Known {
                checkpoints: vec![snapshot],
            };
            return Some(UsageDelta {
                context_window,
                cost: TurnCost::Unpriced,
                usage: result.main_loop.as_ref().map_or(ZERO_USAGE, request_usage),
            });
        }
        UsageBaseline::Known { checkpoints } => checkpoints,
    };
    let by_model: HashMap<&str, Counters> = totals
        .iter()
        .zip(&current)
        .map(|(entry, counters)| (entry.model.as_str(), *counters))
        .collect();
    let previous: HashMap<&str, Counters> = checkpoints
        .iter()
        .find(|snapshot| covers(&by_model, snapshot))
        .map(|base| {
            base.iter()
                .map(|entry| (entry.model.as_str(), Counters::of_snapshot(entry)))
                .collect()
        })
        .unwrap_or_default();
    let mut cost = TurnCost::None;
    let mut usage = ZERO_USAGE;
    for (entry, now) in totals.iter().zip(&current) {
        let before = previous
            .get(entry.model.as_str())
            .copied()
            .unwrap_or_default();
        let delta = now.since(&before);
        if delta.is_zero() {
            continue;
        }
        cost = add_cost(cost, model_cost(entry, &delta));
        usage = add_usage(usage, delta.token_usage());
    }
    checkpoints.insert(0, snapshot);
    checkpoints.truncate(MAX_CHECKPOINTS);
    Some(UsageDelta {
        context_window,
        cost,
        usage,
    })
}

/// Usage of two consecutive measurements of one turn; the later context
/// window wins when it has one.
#[must_use]
pub fn add_delta(left: Option<UsageDelta>, right: UsageDelta) -> UsageDelta {
    match left {
        None => right,
        Some(left) => UsageDelta {
            context_window: right.context_window.or(left.context_window),
            cost: add_cost(left.cost, right.cost),
            usage: add_usage(left.usage, right.usage),
        },
    }
}

/// The thread's cost after a turn that cost `turn`.
#[must_use]
pub fn thread_cost_after(thread: ThreadCost, turn: &TurnCost) -> ThreadCost {
    match (turn, thread) {
        (TurnCost::None, thread) | (TurnCost::Priced { .. }, thread @ ThreadCost::Unknown) => {
            thread
        }
        (TurnCost::Unpriced, _) => ThreadCost::Unknown,
        (TurnCost::Priced { usd: turn, .. }, ThreadCost::Known { usd }) => ThreadCost::Known {
            usd: round_usd(usd + turn),
        },
    }
}

/// The cost `usage.updated` reports for a turn, or `None` when it is not
/// known. A turn priced for several models reports the model `"mixed"`.
#[must_use]
pub fn provider_cost(turn: &TurnCost, thread: ThreadCost) -> Option<ProviderCost> {
    let TurnCost::Priced { basis, models, usd } = turn else {
        return None;
    };
    let model = match models.as_slice() {
        [only] => only.clone(),
        _ => "mixed".to_owned(),
    };
    Some(ProviderCost {
        basis: *basis,
        model,
        turn_usd: *usd,
        thread_usd: match thread {
            ThreadCost::Known { usd } => Some(usd),
            ThreadCost::Unknown => None,
        },
    })
}

/// The cost of a thread whose state predates cost tracking: known (zero)
/// only when the thread has used nothing.
#[must_use]
pub const fn initial_thread_cost(total: &TokenUsage) -> ThreadCost {
    if total.total_tokens == 0 {
        ThreadCost::Known { usd: 0.0 }
    } else {
        ThreadCost::Unknown
    }
}

/// Every current Claude model has a 1M window except those listed in
/// [`model_context_window`].
const DEFAULT_WINDOW: i64 = 1_000_000;
const HAIKU_4_5_WINDOW: i64 = 200_000;

/// A model id as price and window tables key it: trimmed, lower-case, without
/// a trailing `[...]` variant suffix such as `[1m]`.
fn canonical_model_id(model: &str) -> String {
    let id = model.trim().to_lowercase();
    let Some(body) = id.strip_suffix(']') else {
        return id;
    };
    // The suffix starts at the first `[` after the last `]` of the body.
    let search_from = body.rfind(']').map_or(0, |close| close + 1);
    match body[search_from..].find('[') {
        Some(open) => body[..search_from + open].to_owned(),
        None => id,
    }
}

/// The context window of a model, used for live context fill before a
/// result has reported one; `None` when the id is not a Claude model.
#[must_use]
pub fn model_context_window(model: &str) -> Option<i64> {
    let id = canonical_model_id(model);
    if !id.starts_with("claude-") {
        return None;
    }
    Some(match id.as_str() {
        "claude-haiku-4-5" => HAIKU_4_5_WINDOW,
        _ => DEFAULT_WINDOW,
    })
}

/// One complete top-level model request.
#[derive(Clone, Debug, PartialEq)]
pub struct LiveRequest {
    /// Canonical API model id, when the CLI reported it.
    pub model: Option<String>,
    pub usage: TokenUsage,
}

#[derive(Debug)]
struct PendingRequest {
    message_id: String,
    request: LiveRequest,
}

/// Live usage of the active turn between results.
///
/// The CLI reports a turn's totals and cost only in its result. Each
/// top-level assistant message carries the usage of the model request that
/// produced it, and one request may arrive as several messages with the same
/// id (the latest figures count). A request is reported once, when it is
/// complete: the next request, a user frame (tool results) or a compaction
/// ends it. A result measures every request since the previous one, so it
/// clears the live sum.
///
/// The caller feeds only top-level content frames (no `parent_tool_use_id`).
#[derive(Debug)]
pub struct LiveUsageMeter {
    pending: Option<PendingRequest>,
    since: TokenUsage,
}

impl Default for LiveUsageMeter {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveUsageMeter {
    /// A meter with nothing observed.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            pending: None,
            since: ZERO_USAGE,
        }
    }

    /// Usage of the requests reported since the last result.
    #[must_use]
    pub const fn since_result(&self) -> TokenUsage {
        self.since
    }

    /// Observes a top-level content frame; returns the request it completed,
    /// if any.
    pub fn observe(&mut self, frame: &ClaudeFrame) -> Option<LiveRequest> {
        match frame {
            ClaudeFrame::Assistant(assistant) => {
                let figures = assistant.usage.as_ref()?;
                let request = LiveRequest {
                    model: assistant.model.clone(),
                    usage: request_usage(figures),
                };
                match &mut self.pending {
                    Some(pending) if pending.message_id == assistant.message_id => {
                        pending.request = request;
                        None
                    }
                    _ => {
                        let completed = self.complete();
                        self.pending = Some(PendingRequest {
                            message_id: assistant.message_id.clone(),
                            request,
                        });
                        completed
                    }
                }
            }
            ClaudeFrame::User(_) | ClaudeFrame::CompactBoundary { .. } => self.complete(),
            _ => None,
        }
    }

    /// A result measured every request so far; the pending one is part of it.
    pub fn result_measured(&mut self) {
        self.pending = None;
        self.since = ZERO_USAGE;
    }

    fn complete(&mut self) -> Option<LiveRequest> {
        let PendingRequest { request, .. } = self.pending.take()?;
        self.since = add_usage(self.since, request.usage);
        Some(request)
    }
}

#[cfg(test)]
#[path = "usage_tests.rs"]
mod tests;
