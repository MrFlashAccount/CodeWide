//! One socket's thread-list subscription: visibility, dirty rows and the
//! flush timing.
//!
//! A flush always takes **every** dirty row. It happens:
//!
//! - at once when an urgent change is dirty;
//! - for a change of a thread in the socket's interest, at the end of the
//!   ingest batch but no sooner than [`INTEREST_FLUSH_INTERVAL`] after the
//!   previous flush, so a streaming open chat yields at most four frames a
//!   second;
//! - for coalesced changes, at once when the previous flush is at least
//!   [`COALESCE_INTERVAL`] old (the leading edge after silence), otherwise
//!   at `lastFlush + COALESCE_INTERVAL`.
//!
//! An invisible subscriber collects nothing; becoming invisible drops its
//! dirty rows (the device re-reads its pages when it becomes visible). Time
//! and interest membership are passed in, so the machine runs without tokio.

use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

use super::{COALESCE_INTERVAL, INTEREST_FLUSH_INTERVAL, flush::FlushClass};

/// What a subscriber should do now.
#[derive(Debug, Eq, PartialEq)]
pub enum FlushPoll {
    /// Nothing is dirty.
    Idle,
    /// Something is dirty; check again at this instant.
    WaitUntil(Instant),
    /// Send these threads' rows (or tombstones) now, in marking order.
    Flush(Vec<String>),
}

/// The per-socket state machine.
#[derive(Debug)]
pub struct Subscriber {
    visible: bool,
    /// Dirty thread ids in the order they were first marked.
    dirty: Vec<String>,
    dirty_set: HashSet<String>,
    urgent: bool,
    last_flush: Option<Instant>,
}

impl Subscriber {
    #[must_use]
    pub fn new(visible: bool) -> Self {
        Self {
            visible,
            dirty: Vec::new(),
            dirty_set: HashSet::new(),
            urgent: false,
            last_flush: None,
        }
    }

    #[must_use]
    pub const fn visible(&self) -> bool {
        self.visible
    }

    /// Applies a `listStream` frame. Hiding drops the dirty rows.
    pub fn set_visible(&mut self, visible: bool) {
        self.visible = visible;
        if !visible {
            self.dirty.clear();
            self.dirty_set.clear();
            self.urgent = false;
        }
    }

    /// Marks a thread's row dirty; returns whether this added work.
    pub fn mark(&mut self, thread_id: &str, class: FlushClass) -> bool {
        if !self.visible {
            return false;
        }
        let added = self.dirty_set.insert(thread_id.to_owned());
        if added {
            self.dirty.push(thread_id.to_owned());
        }
        let escalated = class == FlushClass::Urgent && !self.urgent;
        self.urgent |= class == FlushClass::Urgent;
        added || escalated
    }

    /// Decides at `now` whether to flush; `in_interest` tells whether a
    /// thread is in the socket's interest at this moment.
    pub fn poll(&mut self, now: Instant, in_interest: impl Fn(&str) -> bool) -> FlushPoll {
        if self.dirty.is_empty() {
            return FlushPoll::Idle;
        }
        let since = |interval: Duration| {
            self.last_flush
                .map_or(now, |last| last.checked_add(interval).unwrap_or(now))
        };
        let mut due = since(COALESCE_INTERVAL);
        if !self.urgent && self.dirty.iter().any(|thread_id| in_interest(thread_id)) {
            due = due.min(since(INTEREST_FLUSH_INTERVAL));
        }
        if self.urgent || due <= now {
            self.urgent = false;
            self.last_flush = Some(now);
            self.dirty_set.clear();
            return FlushPoll::Flush(std::mem::take(&mut self.dirty));
        }
        FlushPoll::WaitUntil(due)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none(_: &str) -> bool {
        false
    }

    fn flushed(poll: FlushPoll) -> Vec<String> {
        match poll {
            FlushPoll::Flush(ids) => ids,
            other => panic!("expected a flush, got {other:?}"),
        }
    }

    #[test]
    fn the_first_coalesced_change_after_silence_flushes_at_once() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(true);
        assert_eq!(subscriber.poll(start, none), FlushPoll::Idle);
        subscriber.mark("a", FlushClass::Coalesced);
        assert_eq!(flushed(subscriber.poll(start, none)), ["a"]);
    }

    #[test]
    fn coalesced_changes_inside_the_interval_share_one_flush() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(true);
        subscriber.mark("first", FlushClass::Coalesced);
        flushed(subscriber.poll(start, none));
        let threads = (0..10).map(|index| format!("t{index}")).collect::<Vec<_>>();
        for thread in &threads {
            subscriber.mark(thread, FlushClass::Coalesced);
            subscriber.mark(thread, FlushClass::Coalesced);
        }
        let later = start + Duration::from_millis(400);
        assert_eq!(
            subscriber.poll(later, none),
            FlushPoll::WaitUntil(start + COALESCE_INTERVAL)
        );
        assert_eq!(
            flushed(subscriber.poll(start + COALESCE_INTERVAL, none)),
            threads
        );
    }

    #[test]
    fn an_urgent_change_flushes_every_dirty_row_and_restarts_the_interval() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(true);
        subscriber.mark("first", FlushClass::Coalesced);
        flushed(subscriber.poll(start, none));
        subscriber.mark("preview", FlushClass::Coalesced);
        subscriber.mark("status", FlushClass::Urgent);
        let urgent_at = start + Duration::from_millis(100);
        assert_eq!(
            flushed(subscriber.poll(urgent_at, none)),
            ["preview", "status"]
        );
        subscriber.mark("preview", FlushClass::Coalesced);
        assert_eq!(
            subscriber.poll(urgent_at, none),
            FlushPoll::WaitUntil(urgent_at + COALESCE_INTERVAL),
            "lastFlush moved to the urgent flush"
        );
    }

    #[test]
    fn interest_threads_flush_within_the_interest_interval() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(true);
        let open = |thread: &str| thread == "open";
        subscriber.mark("open", FlushClass::Coalesced);
        flushed(subscriber.poll(start, open));
        subscriber.mark("open", FlushClass::Coalesced);
        subscriber.mark("other", FlushClass::Coalesced);
        assert_eq!(
            subscriber.poll(start + Duration::from_millis(10), open),
            FlushPoll::WaitUntil(start + INTEREST_FLUSH_INTERVAL)
        );
        assert_eq!(
            flushed(subscriber.poll(start + INTEREST_FLUSH_INTERVAL, open)),
            ["open", "other"]
        );
    }

    #[test]
    fn a_streaming_interest_thread_is_bounded_by_the_interest_interval() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(true);
        let open = |thread: &str| thread == "open";
        let mut frames = 0;
        // A delta every 16 ms for ten seconds.
        for tick in 0..=625_u64 {
            let now = start + Duration::from_millis(tick * 16);
            subscriber.mark("open", FlushClass::Coalesced);
            if matches!(subscriber.poll(now, open), FlushPoll::Flush(_)) {
                frames += 1;
            }
        }
        assert!(frames <= 41, "{frames} frames in ten seconds");
        assert!(
            frames >= 30,
            "{frames} frames: the interest interval still flushes"
        );
    }

    #[test]
    fn an_invisible_subscriber_collects_nothing_and_hiding_drops_dirty_rows() {
        let start = Instant::now();
        let mut subscriber = Subscriber::new(false);
        assert!(!subscriber.mark("a", FlushClass::Urgent));
        assert_eq!(subscriber.poll(start, none), FlushPoll::Idle);
        subscriber.set_visible(true);
        assert!(subscriber.mark("a", FlushClass::Urgent));
        subscriber.set_visible(false);
        assert_eq!(subscriber.poll(start, none), FlushPoll::Idle);
        subscriber.set_visible(true);
        assert_eq!(subscriber.poll(start, none), FlushPoll::Idle);
    }
}
