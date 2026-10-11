//! The log filter every companion host installs (the Linux executable and the
//! macOS runtime).
//!
//! The defaults always apply: every target reports warnings and errors (so a
//! new crate or dependency is never silenced by omission), and the targets
//! that carry operational records of the companion and its provider children
//! (startup, child process starts and restarts, child stderr, protocol
//! negotiation) report `info`. `RUST_LOG` directives are layered on top: a
//! directive for the same target replaces the default one, every other default
//! stays. A `RUST_LOG` that names only one target therefore never silences the
//! rest of the companion.

use tracing_subscriber::{EnvFilter, filter::Directive};

/// Base directives, applied before `RUST_LOG`.
pub const DEFAULT_LOG_DIRECTIVES: &str = "warn,codewide_companion=info,companion_swift_ffi=info,\
companion_core::agent=info,agent_transport=info,agent_provider_codex=info,agent_provider_claude=info";

/// The environment variable whose directives refine the defaults.
pub const LOG_FILTER_ENV: &str = "RUST_LOG";

/// A filter built from the defaults and optional overrides.
pub struct LogFilter {
    pub filter: EnvFilter,
    /// Override directives that did not parse and were ignored. The caller
    /// logs them once the subscriber is installed.
    pub rejected_directives: Vec<String>,
}

impl LogFilter {
    /// The defaults refined by `RUST_LOG` (when set and valid UTF-8).
    #[must_use]
    pub fn from_env() -> Self {
        Self::with_overrides(std::env::var(LOG_FILTER_ENV).ok().as_deref())
    }

    /// The defaults refined by `overrides` (comma-separated `RUST_LOG`
    /// directives).
    #[must_use]
    pub fn with_overrides(overrides: Option<&str>) -> Self {
        let mut filter = EnvFilter::new(DEFAULT_LOG_DIRECTIVES);
        let mut rejected_directives = Vec::new();
        for directive in overrides
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|directive| !directive.is_empty())
        {
            match directive.parse::<Directive>() {
                Ok(parsed) => filter = filter.add_directive(parsed),
                Err(_) => rejected_directives.push(directive.to_owned()),
            }
        }
        Self {
            filter,
            rejected_directives,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        sync::{Arc, Mutex},
    };

    use tracing::{debug, info, warn};

    use super::*;

    #[derive(Clone, Default)]
    struct Captured(Arc<Mutex<Vec<u8>>>);

    impl Write for Captured {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .map_err(|_| std::io::Error::other("poisoned"))?
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn emit() {
        info!(target: "codewide_companion", "companion-info");
        info!(target: "agent_transport::stdio", "host-stderr-info");
        warn!(target: "agent_transport::stdio", "host-stderr-warn");
        info!(target: "agent_provider_claude", "claude-info");
        info!(target: "companion_core::agent::providers", "providers-info");
        info!(target: "companion_core::sync", "sync-info");
        warn!(target: "companion_core::sync", "sync-warn");
        info!(target: "future_crate", "future-info");
        warn!(target: "future_crate", "future-warn");
        debug!(target: "future_crate", "future-debug");
    }

    fn records(overrides: Option<&str>) -> String {
        let captured = Captured::default();
        let writer = captured.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(LogFilter::with_overrides(overrides).filter)
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(subscriber, emit);
        let bytes = captured
            .0
            .lock()
            .map(|bytes| bytes.clone())
            .unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn assert_defaults(output: &str) {
        for expected in [
            "companion-info",
            "host-stderr-info",
            "host-stderr-warn",
            "claude-info",
            "providers-info",
            "sync-warn",
            "future-warn",
        ] {
            assert!(output.contains(expected), "missing {expected} in {output}");
        }
        for unexpected in ["sync-info", "future-info", "future-debug"] {
            assert!(
                !output.contains(unexpected),
                "unexpected {unexpected} in {output}"
            );
        }
    }

    #[test]
    fn defaults_apply_without_overrides_and_under_the_former_unit_filter() {
        assert_defaults(&records(None));
        // The user unit used to ship `RUST_LOG=codewide_companion=info`, which
        // replaced every default and silenced all library crates.
        assert_defaults(&records(Some("codewide_companion=info")));
    }

    #[test]
    fn overrides_replace_only_their_own_target() {
        let quiet = records(Some("agent_transport=error"));
        assert!(!quiet.contains("host-stderr-info"));
        assert!(!quiet.contains("host-stderr-warn"));
        assert!(quiet.contains("claude-info"));
        assert!(quiet.contains("future-warn"));

        let verbose = records(Some("debug"));
        assert!(verbose.contains("future-debug"));
        assert!(verbose.contains("host-stderr-info"));
    }

    #[test]
    fn rejects_unparsable_directives_and_keeps_the_rest() {
        let filter = LogFilter::with_overrides(Some("agent_transport=error, =bogus=, ,"));
        assert_eq!(filter.rejected_directives, ["=bogus="]);
    }
}
