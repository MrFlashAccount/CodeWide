//! Claude subscription usage limits as neutral `ProviderRateLimits`.
//!
//! Two sources describe the same windows by the same ids:
//!
//! - the `rate_limit_event` frame (streamed during a turn) names one window at
//!   a time (`rateLimitType`) with a 0–1 `utilization` fraction, an
//!   epoch-seconds `resetsAt` and a status;
//! - the `get_usage` control request (`ClaudeProcess::read_usage`) reports
//!   several windows at once as 0–100 percentages with RFC 3339 reset times.
//!
//! `RateLimitBook` owns the merged snapshot; `RateLimitReporter` feeds it,
//! throttles live usage reads and publishes every change
//! (`rateLimits.updated`). Pure: the clock and the publisher are injected, and
//! the caller performs the usage read itself. Nothing here is a credential.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use agent_core::model::{
    ProviderRateLimitWindow, ProviderRateLimits, RateLimitWindowKind, RateLimitWindowStatus,
};
use serde_json::{Map, Value};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// Minimum time between two usage reads through live sessions.
pub const USAGE_READ_INTERVAL_MS: i64 = 120_000;

const SESSION_MINUTES: u32 = 300;
const WEEK_MINUTES: u32 = 10_080;
const MAX_PERCENT: u8 = 100;
const MS_PER_SECOND: i64 = 1000;
const MAX_WINDOW_ID_LENGTH: usize = 64;

/// Reports of one window disagree on its reset by a rounding second (the
/// usage read's RFC 3339 time keeps fractions the streamed epoch seconds
/// round); a reset moves it by the window's length.
const RESET_TOLERANCE_SECONDS: i64 = 60;

/// The usage-read windows mapped from a `get_usage` answer.
const USAGE_READ_WINDOWS: [&str; 4] = [
    "five_hour",
    "seven_day",
    "seven_day_opus",
    "seven_day_sonnet",
];

/// Kind, label and length of a window id.
struct WindowShape<'id> {
    duration_mins: Option<u32>,
    kind: RateLimitWindowKind,
    label: &'id str,
}

/// The windows Claude names today; another id is kept as an `other` window
/// labelled with its id.
fn window_shape(id: &str) -> WindowShape<'_> {
    let (duration_mins, kind, label) = match id {
        "five_hour" => (
            Some(SESSION_MINUTES),
            RateLimitWindowKind::Session,
            "Session",
        ),
        "seven_day" => (Some(WEEK_MINUTES), RateLimitWindowKind::Weekly, "Weekly"),
        "seven_day_opus" => (
            Some(WEEK_MINUTES),
            RateLimitWindowKind::Weekly,
            "Weekly · Opus",
        ),
        "seven_day_sonnet" => (
            Some(WEEK_MINUTES),
            RateLimitWindowKind::Weekly,
            "Weekly · Sonnet",
        ),
        "seven_day_overage_included" => (
            Some(WEEK_MINUTES),
            RateLimitWindowKind::Weekly,
            "Weekly · Included models",
        ),
        "overage" => (None, RateLimitWindowKind::Other, "Extra usage"),
        other => (None, RateLimitWindowKind::Other, other),
    };
    WindowShape {
        duration_mins,
        kind,
        label,
    }
}

/// The figures one report carries for a window.
#[derive(Clone, Copy)]
struct Figures {
    resets_at: Option<i64>,
    status: Option<RateLimitWindowStatus>,
    used_percent: Option<u8>,
}

fn window_of(id: String, figures: Figures) -> ProviderRateLimitWindow {
    let shape = window_shape(&id);
    let kind = shape.kind;
    let label = shape.label.to_owned();
    let window_duration_mins = shape.duration_mins;
    ProviderRateLimitWindow {
        id,
        kind,
        label,
        resets_at: figures.resets_at,
        status: figures.status,
        used_percent: figures.used_percent,
        window_duration_mins,
    }
}

/// `value` rounded down to a whole number, saturating at the `i64` range.
fn floor_whole(value: f64) -> i64 {
    // WHY: std has no checked float-to-integer conversion; `as` saturates and
    // every caller passes a finite JSON number, so the cast cannot misbehave.
    #[allow(clippy::cast_possible_truncation)]
    let whole = value.floor() as i64;
    whole
}

/// A percentage rounded half up and clamped to 0–100.
fn percent(value: f64) -> u8 {
    let clamped = floor_whole(value + 0.5).clamp(0, i64::from(MAX_PERCENT));
    // The clamp keeps the value inside `u8`; the fallback is unreachable.
    u8::try_from(clamped).unwrap_or(MAX_PERCENT)
}

fn number(record: &Map<String, Value>, key: &str) -> Option<f64> {
    record.get(key).and_then(Value::as_f64)
}

/// Positive epoch seconds, floored; `None` otherwise.
fn epoch_seconds(value: Option<&Value>) -> Option<i64> {
    let seconds = value.and_then(Value::as_f64)?;
    (seconds > 0.0).then(|| floor_whole(seconds))
}

/// An RFC 3339 time after the epoch as whole seconds; `None` otherwise.
fn rfc3339_seconds(value: Option<&Value>) -> Option<i64> {
    let time = OffsetDateTime::parse(value?.as_str()?, &Rfc3339).ok()?;
    (time.unix_timestamp_nanos() > 0).then(|| time.unix_timestamp())
}

fn window_status(value: Option<&Value>) -> Option<RateLimitWindowStatus> {
    match value?.as_str()? {
        "allowed" => Some(RateLimitWindowStatus::Allowed),
        "allowed_warning" => Some(RateLimitWindowStatus::Warning),
        "rejected" => Some(RateLimitWindowStatus::Rejected),
        _ => None,
    }
}

/// A window id: 1–64 characters of `[a-z0-9_]`.
fn window_id(value: Option<&Value>) -> Option<&str> {
    let id = value?.as_str()?;
    let valid = !id.is_empty()
        && id.len() <= MAX_WINDOW_ID_LENGTH
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    valid.then_some(id)
}

/// The window one `rate_limit_event`'s `rate_limit_info` reports
/// (`ClaudeFrame::RateLimit::info`); `None` when it names no usable window or
/// carries no figure at all.
#[must_use]
pub fn rate_limit_event_window(info: &Value) -> Option<ProviderRateLimitWindow> {
    let info = info.as_object()?;
    let id = window_id(info.get("rateLimitType"))?;
    let figures = Figures {
        resets_at: epoch_seconds(info.get("resetsAt")),
        status: window_status(info.get("status")),
        // The streamed utilization is a 0–1 fraction.
        used_percent: number(info, "utilization")
            .map(|fraction| percent(fraction * f64::from(MAX_PERCENT))),
    };
    if figures.resets_at.is_none() && figures.status.is_none() && figures.used_percent.is_none() {
        return None;
    }
    Some(window_of(id.to_owned(), figures))
}

/// The windows of a `get_usage` answer (`rate_limits` with 0–100
/// `utilization` and RFC 3339 `resets_at` per window), validated
/// structurally. Empty for any other shape, including a session where plan
/// limits do not apply (`rate_limits_available` not `true`).
#[must_use]
pub fn usage_read_windows(response: &Value) -> Vec<ProviderRateLimitWindow> {
    let Some(response) = response.as_object() else {
        return Vec::new();
    };
    if response.get("rate_limits_available") != Some(&Value::Bool(true)) {
        return Vec::new();
    }
    let Some(limits) = response.get("rate_limits").and_then(Value::as_object) else {
        return Vec::new();
    };
    USAGE_READ_WINDOWS
        .iter()
        .filter_map(|&id| {
            let window = limits.get(id)?.as_object()?;
            let utilization = number(window, "utilization")?;
            Some(window_of(
                id.to_owned(),
                Figures {
                    resets_at: rfc3339_seconds(window.get("resets_at")),
                    status: None,
                    used_percent: Some(percent(utilization)),
                },
            ))
        })
        .collect()
}

/// A later report replaces the figures it carries. A missing percentage keeps
/// the earlier one unless the window reset in between.
fn merged(
    previous: Option<&ProviderRateLimitWindow>,
    next: ProviderRateLimitWindow,
) -> ProviderRateLimitWindow {
    let Some(previous) = previous else {
        return next;
    };
    let reset = matches!(
        (next.resets_at, previous.resets_at),
        (Some(next), Some(previous)) if (next - previous).abs() > RESET_TOLERANCE_SECONDS
    );
    ProviderRateLimitWindow {
        resets_at: next.resets_at.or(previous.resets_at),
        status: next.status.or(previous.status),
        used_percent: next
            .used_percent
            .or(if reset { None } else { previous.used_percent }),
        ..next
    }
}

const fn kind_rank(kind: RateLimitWindowKind) -> u8 {
    match kind {
        RateLimitWindowKind::Session => 0,
        RateLimitWindowKind::Weekly => 1,
        RateLimitWindowKind::Other => 2,
    }
}

/// Rank of an id character in the host's `localeCompare` order: punctuation
/// before digits before letters (ids are `[a-z0-9_]`).
fn id_char_rank(character: char) -> (u8, char) {
    match character {
        '_' => (0, character),
        '0'..='9' => (1, character),
        _ => (2, character),
    }
}

/// Session before weekly before other windows, then by id.
fn window_order(left: &ProviderRateLimitWindow, right: &ProviderRateLimitWindow) -> Ordering {
    kind_rank(left.kind)
        .cmp(&kind_rank(right.kind))
        .then_with(|| {
            left.id
                .chars()
                .map(id_char_rank)
                .cmp(right.id.chars().map(id_char_rank))
        })
}

/// The provider's merged limit snapshot; windows are merged by id.
#[derive(Debug, Default)]
pub struct RateLimitBook {
    windows: BTreeMap<String, ProviderRateLimitWindow>,
    current: Option<ProviderRateLimits>,
}

impl RateLimitBook {
    /// The latest snapshot; `None` until the first report.
    #[must_use]
    pub const fn snapshot(&self) -> Option<&ProviderRateLimits> {
        self.current.as_ref()
    }

    /// Merges reported windows. Returns the new full snapshot stamped
    /// `now_seconds`, or `None` when nothing changed (nothing to report).
    pub fn apply(
        &mut self,
        reported: impl IntoIterator<Item = ProviderRateLimitWindow>,
        now_seconds: i64,
    ) -> Option<&ProviderRateLimits> {
        let mut changed = false;
        for next in reported {
            let previous = self.windows.get(&next.id);
            let window = merged(previous, next);
            if previous != Some(&window) {
                self.windows.insert(window.id.clone(), window);
                changed = true;
            }
        }
        if !changed {
            return None;
        }
        let mut windows: Vec<ProviderRateLimitWindow> = self.windows.values().cloned().collect();
        windows.sort_by(window_order);
        Some(self.current.insert(ProviderRateLimits {
            updated_at: now_seconds,
            windows,
        }))
    }
}

/// Owner of Claude's subscription limits: merges every report into one
/// `RateLimitBook` and hands each changed snapshot to `publish`
/// (`rateLimits.updated`).
///
/// Reports come from `rate_limit_event` frames of live sessions
/// ([`Self::reported`]) and from `get_usage` reads ([`Self::usage_read`]):
/// the startup probe's, and after a turn's result at most once per
/// [`USAGE_READ_INTERVAL_MS`] through a live session
/// ([`Self::claim_usage_read`]). A usage read is best effort: a failure or an
/// unknown shape changes nothing.
pub struct RateLimitReporter<Clock, Publish> {
    book: RateLimitBook,
    /// Unix milliseconds now.
    now_ms: Clock,
    /// Called with the full snapshot whenever it changed.
    publish: Publish,
    /// When the latest usage read started or finished.
    last_read_at_ms: Option<i64>,
}

impl<Clock, Publish> RateLimitReporter<Clock, Publish>
where
    Clock: Fn() -> i64,
    Publish: FnMut(&ProviderRateLimits),
{
    /// A reporter without any report yet.
    pub fn new(now_ms: Clock, publish: Publish) -> Self {
        Self {
            book: RateLimitBook::default(),
            now_ms,
            publish,
            last_read_at_ms: None,
        }
    }

    /// The latest snapshot; `None` until the first report.
    #[must_use]
    pub const fn snapshot(&self) -> Option<&ProviderRateLimits> {
        self.book.snapshot()
    }

    /// A window a `rate_limit_event` frame reported.
    pub fn reported(&mut self, window: ProviderRateLimitWindow) {
        self.apply([window]);
    }

    /// A live session produced a turn result. Returns `true` when a usage read
    /// is due; the slot is then claimed, and the caller reads usage through
    /// that session and hands a successful answer to [`Self::usage_read`]
    /// (a failed read is the caller's to log and changes nothing).
    pub fn claim_usage_read(&mut self) -> bool {
        let now = (self.now_ms)();
        if self
            .last_read_at_ms
            .is_some_and(|last| now - last < USAGE_READ_INTERVAL_MS)
        {
            return false;
        }
        self.last_read_at_ms = Some(now);
        true
    }

    /// Applies one `get_usage` answer (the probe's or a live session's).
    pub fn usage_read(&mut self, response: &Value) {
        self.last_read_at_ms = Some((self.now_ms)());
        self.apply(usage_read_windows(response));
    }

    fn apply(&mut self, windows: impl IntoIterator<Item = ProviderRateLimitWindow>) {
        let now_seconds = (self.now_ms)().div_euclid(MS_PER_SECOND);
        if let Some(next) = self.book.apply(windows, now_seconds) {
            (self.publish)(next);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use serde_json::json;

    use super::*;
    use crate::transcript::frames::{ClaudeFrame, classify_frame};

    const RESET: i64 = 1_760_010_000;

    fn usage_answer() -> Value {
        json!({
            "rate_limits_available": true,
            "rate_limits": {
                "five_hour": { "utilization": 12.4, "resets_at": "2025-10-09T12:00:00Z" },
                "seven_day": { "utilization": 61, "resets_at": null },
                "seven_day_opus": null,
            },
        })
    }

    fn event_window(
        id: &str,
        used_percent: Option<u8>,
        resets_at: Option<i64>,
    ) -> ProviderRateLimitWindow {
        let mut info = json!({ "rateLimitType": id, "status": "allowed" });
        if let Some(used) = used_percent {
            info["utilization"] = json!(f64::from(used) / 100.0);
        }
        if let Some(resets_at) = resets_at {
            info["resetsAt"] = json!(resets_at);
        }
        rate_limit_event_window(&info).unwrap_or_else(|| panic!("window {id}"))
    }

    fn ids(limits: Option<&ProviderRateLimits>) -> Vec<&str> {
        limits
            .map(|limits| {
                limits
                    .windows
                    .iter()
                    .map(|window| window.id.as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn maps_an_event_windows_fraction_reset_and_status() {
        let window = rate_limit_event_window(&json!({
            "status": "allowed_warning",
            "rateLimitType": "seven_day",
            "utilization": 0.834,
            "resetsAt": RESET,
        }));
        assert_eq!(
            window,
            Some(ProviderRateLimitWindow {
                id: "seven_day".to_owned(),
                kind: RateLimitWindowKind::Weekly,
                label: "Weekly".to_owned(),
                resets_at: Some(RESET),
                status: Some(RateLimitWindowStatus::Warning),
                used_percent: Some(83),
                window_duration_mins: Some(10_080),
            })
        );
    }

    #[test]
    fn keeps_an_unknown_window_as_other_and_clamps_the_percentage() {
        let window = rate_limit_event_window(&json!({
            "status": "rejected",
            "rateLimitType": "monthly_x",
            "utilization": 1.7,
        }));
        assert_eq!(
            window,
            Some(ProviderRateLimitWindow {
                id: "monthly_x".to_owned(),
                kind: RateLimitWindowKind::Other,
                label: "monthly_x".to_owned(),
                resets_at: None,
                status: Some(RateLimitWindowStatus::Rejected),
                used_percent: Some(100),
                window_duration_mins: None,
            })
        );
    }

    #[test]
    fn ignores_events_without_a_usable_window() {
        assert_eq!(
            rate_limit_event_window(&json!({ "status": "allowed" })),
            None
        );
        assert_eq!(
            rate_limit_event_window(&json!({ "rateLimitType": "five_hour" })),
            None
        );
        assert_eq!(
            rate_limit_event_window(&json!({ "rateLimitType": "Five Hour!", "utilization": 0.1 })),
            None
        );
        assert_eq!(rate_limit_event_window(&Value::Null), None);
        let frame = classify_frame(&json!({
            "type": "rate_limit_event",
            "rate_limit_info": { "status": "allowed" },
        }));
        let ClaudeFrame::RateLimit { status, info } = frame else {
            panic!("rate-limit frame expected, got {frame:?}");
        };
        assert_eq!(status.as_deref(), Some("allowed"));
        assert_eq!(rate_limit_event_window(&info), None);
    }

    #[test]
    fn maps_usage_read_percentages_and_reset_times_of_the_known_windows() {
        let reset = OffsetDateTime::parse("2025-10-09T12:00:00Z", &Rfc3339)
            .map(OffsetDateTime::unix_timestamp)
            .ok();
        assert_eq!(
            usage_read_windows(&usage_answer()),
            vec![
                ProviderRateLimitWindow {
                    id: "five_hour".to_owned(),
                    kind: RateLimitWindowKind::Session,
                    label: "Session".to_owned(),
                    resets_at: reset,
                    status: None,
                    used_percent: Some(12),
                    window_duration_mins: Some(300),
                },
                ProviderRateLimitWindow {
                    id: "seven_day".to_owned(),
                    kind: RateLimitWindowKind::Weekly,
                    label: "Weekly".to_owned(),
                    resets_at: None,
                    status: None,
                    used_percent: Some(61),
                    window_duration_mins: Some(10_080),
                },
            ]
        );
    }

    #[test]
    fn reads_nothing_where_plan_limits_do_not_apply_or_the_shape_is_unknown() {
        assert!(
            usage_read_windows(&json!({ "rate_limits_available": false, "rate_limits": null }))
                .is_empty()
        );
        assert!(
            usage_read_windows(&json!({ "rate_limits_available": true, "rate_limits": "x" }))
                .is_empty()
        );
        assert!(usage_read_windows(&Value::Null).is_empty());
    }

    #[test]
    fn book_merges_by_id_orders_by_kind_and_skips_no_op_updates() {
        let mut book = RateLimitBook::default();
        let overage = rate_limit_event_window(&json!({
            "rateLimitType": "overage",
            "status": "rejected",
        }))
        .unwrap_or_else(|| panic!("overage window"));
        let weekly = event_window("seven_day", Some(40), Some(RESET));
        let session = event_window("five_hour", Some(10), Some(RESET));
        assert_eq!(
            ids(book.apply([overage, weekly], 100)),
            ["seven_day", "overage"]
        );
        let next = book.apply([session.clone()], 101);
        assert_eq!(next.map(|limits| limits.updated_at), Some(101));
        assert_eq!(ids(next), ["five_hour", "seven_day", "overage"]);
        assert_eq!(book.apply([session], 102), None);
        assert_eq!(book.snapshot().map(|limits| limits.updated_at), Some(101));
    }

    #[test]
    fn book_orders_ids_of_one_kind_as_the_host_does() {
        let mut book = RateLimitBook::default();
        let windows = ["x1", "x_", "xa"].map(|id| event_window(id, Some(1), None));
        assert_eq!(ids(book.apply(windows, 1)), ["x_", "x1", "xa"]);
    }

    #[test]
    fn book_keeps_a_known_percentage_after_a_status_only_report_until_a_reset() {
        let mut book = RateLimitBook::default();
        book.apply([event_window("five_hour", Some(30), Some(RESET))], 1);
        assert_eq!(
            book.apply([event_window("five_hour", None, Some(RESET))], 2),
            None
        );
        let after_reset = book.apply([event_window("five_hour", None, Some(RESET + 18_000))], 3);
        assert_eq!(
            after_reset.map(|limits| limits.windows[0].used_percent),
            Some(None)
        );
    }

    #[test]
    fn book_keeps_the_percentage_when_another_report_rounds_the_same_reset() {
        let mut book = RateLimitBook::default();
        // The usage read's RFC 3339 reset floors to …399; the streamed event says …400.
        book.apply([event_window("five_hour", Some(25), Some(RESET - 1))], 1);
        book.apply([event_window("five_hour", None, Some(RESET))], 2);
        let window = book.snapshot().map(|limits| &limits.windows[0]);
        assert_eq!(window.and_then(|window| window.used_percent), Some(25));
        assert_eq!(window.and_then(|window| window.resets_at), Some(RESET));
    }

    #[test]
    fn reporter_publishes_streamed_windows_and_reads_usage_at_most_once_per_interval() {
        let clock = Rc::new(Cell::new(1_760_000_000_000_i64));
        let published = Rc::new(RefCell::new(Vec::<Vec<Option<u8>>>::new()));
        let mut reporter = RateLimitReporter::new(
            {
                let clock = Rc::clone(&clock);
                move || clock.get()
            },
            {
                let published = Rc::clone(&published);
                move |limits: &ProviderRateLimits| {
                    published.borrow_mut().push(
                        limits
                            .windows
                            .iter()
                            .map(|window| window.used_percent)
                            .collect(),
                    );
                }
            },
        );

        // First turn: a streamed window, a figureless event, then the result.
        reporter.reported(event_window("five_hour", Some(50), None));
        assert_eq!(
            rate_limit_event_window(&json!({ "status": "allowed" })),
            None
        );
        assert!(reporter.claim_usage_read());
        reporter.usage_read(&usage_answer());
        assert_eq!(
            *published.borrow(),
            [vec![Some(50)], vec![Some(12), Some(61)]]
        );
        assert_eq!(
            reporter.snapshot().map(|limits| limits.updated_at),
            Some(1_760_000_000)
        );

        // Second turn within the interval: no read.
        assert!(!reporter.claim_usage_read());

        // After the interval a read is due again; the same figures publish nothing.
        clock.set(clock.get() + USAGE_READ_INTERVAL_MS);
        assert!(reporter.claim_usage_read());
        reporter.usage_read(&usage_answer());
        assert_eq!(published.borrow().len(), 2);
    }

    #[test]
    fn reporter_throttles_from_the_start_of_a_read_that_failed() {
        let clock = Rc::new(Cell::new(0_i64));
        let mut reporter = RateLimitReporter::new(
            {
                let clock = Rc::clone(&clock);
                move || clock.get()
            },
            |_: &ProviderRateLimits| panic!("nothing to publish"),
        );
        assert!(reporter.claim_usage_read());
        clock.set(USAGE_READ_INTERVAL_MS - 1);
        assert!(!reporter.claim_usage_read());
        clock.set(USAGE_READ_INTERVAL_MS);
        assert!(reporter.claim_usage_read());
        reporter.usage_read(&json!({ "rate_limits_available": false }));
        assert_eq!(reporter.snapshot(), None);
    }

    #[test]
    fn snapshot_serializes_as_the_rate_limits_updated_payload() {
        let mut book = RateLimitBook::default();
        let snapshot = book.apply([event_window("five_hour", Some(90), None)], 1);
        assert_eq!(
            snapshot.map(serde_json::to_value).and_then(Result::ok),
            Some(json!({
                "updatedAt": 1,
                "windows": [{
                    "id": "five_hour",
                    "kind": "session",
                    "label": "Session",
                    "resetsAt": null,
                    "status": "allowed",
                    "usedPercent": 90,
                    "windowDurationMins": 300,
                }],
            }))
        );
    }
}
