//! `gh auth login --web` as a long-running host login flow.
//!
//! `gh` runs non-interactively (stdin is a pipe), so it prints the one-time
//! code and the device URL instead of opening a browser, then waits for the
//! user to finish on any device. The parser accepts only the one-time-code
//! line and an `https://<host>/login/device` URL; any other output before
//! both are known ends the flow as failed with the host instructions
//! fallback. The child is killed when the flow is dropped, which happens
//! when the companion closes this plugin's stdin.

use std::{
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::Child,
    sync::mpsc,
    time::timeout,
};

use crate::gh::{GhCli, valid_login};

/// How long `gh` may take to print the code and URL.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(30);
/// The device code lifetime GitHub grants; the companion ends flows at the
/// same bound.
pub const DEFAULT_FLOW_LIFETIME: Duration = Duration::from_mins(15);
/// The fallback shown when the flow cannot continue.
pub const FALLBACK_INSTRUCTIONS: &str =
    "Run `gh auth login` on the companion host, then tap Check again.";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FlowError {
    #[error("gh could not be started")]
    Start,
    #[error("gh output was not understood")]
    Unparsed,
    #[error("gh did not print a one-time code in time")]
    Timeout,
    #[error("gh exited before printing a one-time code")]
    Exited,
}

/// The device prompt `gh` printed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DevicePrompt {
    pub user_code: String,
    pub verification_uri: String,
}

/// The state of a running flow, as `auth.poll` reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FlowPoll {
    Pending,
    Complete { login: String },
    Failed { reason: String },
}

pub struct HostLoginFlow {
    child: Child,
    host: String,
    lines: Arc<Mutex<Vec<String>>>,
    started: Instant,
    lifetime: Duration,
}

impl HostLoginFlow {
    /// Spawns `gh auth login --web` and waits for its device prompt.
    ///
    /// # Errors
    ///
    /// Returns an error when `gh` cannot start, exits early, prints
    /// anything unexpected or is too slow; the child is killed then.
    pub async fn start(
        gh: &GhCli,
        host: &str,
        lifetime: Duration,
    ) -> Result<(Self, DevicePrompt), FlowError> {
        let mut command = gh.command();
        command
            .args([
                "auth",
                "login",
                "--hostname",
                host,
                "--web",
                "--git-protocol",
                "https",
            ])
            .stdin(Stdio::piped());
        let mut child = command.spawn().map_err(|_| FlowError::Start)?;
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let lines = Arc::new(Mutex::new(Vec::new()));
        if let Some(stdout) = child.stdout.take() {
            spawn_reader(stdout, sender.clone(), lines.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_reader(stderr, sender, lines.clone());
        }
        let mut parser = PromptParser::new(host);
        let prompt = timeout(PROMPT_TIMEOUT, async {
            loop {
                let Some(line) = receiver.recv().await else {
                    return Err(FlowError::Exited);
                };
                if let Some(prompt) = parser.accept(&line)? {
                    return Ok(prompt);
                }
            }
        })
        .await
        .map_err(|_| FlowError::Timeout)
        .and_then(|result| result);
        let prompt = match prompt {
            Ok(prompt) => prompt,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        // Interactive `gh` versions wait for Enter before continuing.
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"\n").await;
        }
        Ok((
            Self {
                child,
                host: host.to_owned(),
                lines,
                started: Instant::now(),
                lifetime,
            },
            prompt,
        ))
    }

    #[must_use]
    pub fn host(&self) -> &str {
        &self.host
    }

    /// Reports the flow state without blocking.
    pub fn poll(&mut self) -> FlowPoll {
        if self.started.elapsed() >= self.lifetime {
            let _ = self.child.start_kill();
            return FlowPoll::Failed {
                reason: "The one-time code expired.".into(),
            };
        }
        match self.child.try_wait() {
            Ok(None) => FlowPoll::Pending,
            Ok(Some(status)) if status.success() => {
                let lines = self
                    .lines
                    .lock()
                    .map(|lines| lines.clone())
                    .unwrap_or_default();
                match logged_in_as(&lines) {
                    Some(login) => FlowPoll::Complete { login },
                    None => FlowPoll::Failed {
                        reason: "gh finished, but its output was not understood.".into(),
                    },
                }
            }
            Ok(Some(_)) | Err(_) => FlowPoll::Failed {
                reason: "gh could not complete the login.".into(),
            },
        }
    }
}

impl Drop for HostLoginFlow {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

fn spawn_reader<R>(stream: R, sender: mpsc::UnboundedSender<String>, lines: Arc<Mutex<Vec<String>>>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let line = strip_ansi(&line);
            if let Ok(mut lines) = lines.lock()
                && lines.len() < 256
            {
                lines.push(line.clone());
            }
            let _ = sender.send(line);
        }
    });
}

/// Accepts `gh`'s device prompt line by line.
pub(crate) struct PromptParser {
    expected_uri: String,
    code: Option<String>,
    uri: Option<String>,
}

impl PromptParser {
    pub(crate) fn new(host: &str) -> Self {
        Self {
            expected_uri: format!("https://{host}/login/device"),
            code: None,
            uri: None,
        }
    }

    /// Feeds one output line; returns the prompt once code and URL are both
    /// known.
    pub(crate) fn accept(&mut self, line: &str) -> Result<Option<DevicePrompt>, FlowError> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(None);
        }
        if let Some(code) = line
            .strip_prefix("! First copy your one-time code:")
            .map(str::trim)
        {
            if self.code.is_some() || !valid_user_code(code) {
                return Err(FlowError::Unparsed);
            }
            self.code = Some(code.to_owned());
        } else if let Some(uri) = device_uri(line) {
            if self.uri.is_some() || uri != self.expected_uri {
                return Err(FlowError::Unparsed);
            }
            self.uri = Some(uri.to_owned());
        } else {
            return Err(FlowError::Unparsed);
        }
        Ok(match (&self.code, &self.uri) {
            (Some(code), Some(uri)) => Some(DevicePrompt {
                user_code: code.clone(),
                verification_uri: uri.clone(),
            }),
            _ => None,
        })
    }
}

/// The URL of `Open this URL to continue in your web browser: <url>`
/// (non-interactive) or `Press Enter to open <url> in your browser...`.
fn device_uri(line: &str) -> Option<&str> {
    if let Some(uri) = line.strip_prefix("Open this URL to continue in your web browser:") {
        return Some(uri.trim());
    }
    line.strip_prefix("Press Enter to open ")?
        .strip_suffix("in your browser...")
        .map(str::trim)
}

/// GitHub device codes: `XXXX-XXXX` of uppercase letters and digits.
fn valid_user_code(code: &str) -> bool {
    let bytes = code.as_bytes();
    bytes.len() == 9
        && bytes[4] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn logged_in_as(lines: &[String]) -> Option<String> {
    lines.iter().rev().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix('✓').unwrap_or(line).trim_start();
        let login = rest.strip_prefix("Logged in as ")?.trim();
        valid_login(login).then(|| login.to_owned())
    })
}

fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(character);
    }
    out
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn parse(host: &str, output: &str) -> Result<Option<DevicePrompt>, FlowError> {
        let mut parser = PromptParser::new(host);
        let mut prompt = None;
        for line in output.lines() {
            if let Some(found) = parser.accept(&strip_ansi(line))? {
                prompt = Some(found);
            }
        }
        Ok(prompt)
    }

    /// The device prompt formats `gh` prints: non-interactive (stdin is not
    /// a TTY), with and without colour, and the interactive form. These are
    /// transcribed from `gh`'s device-flow output, not captured from a live
    /// login; a capture of 2.40.0 and the latest tested release replaces them
    /// when available.
    #[test]
    fn accepts_recorded_prompts_of_the_minimum_and_latest_gh() {
        let minimum = "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
        let latest = "\u{1b}[0;33m!\u{1b}[0m First copy your one-time code: \u{1b}[1mWXYZ-9876\u{1b}[0m\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
        let interactive = "! First copy your one-time code: AB12-CD34\nPress Enter to open https://github.com/login/device in your browser... \n";
        for (output, code) in [
            (minimum, "ABCD-1234"),
            (latest, "WXYZ-9876"),
            (interactive, "AB12-CD34"),
        ] {
            let prompt = parse("github.com", output)
                .expect("parses")
                .expect("prompt");
            assert_eq!(prompt.user_code, code);
            assert_eq!(prompt.verification_uri, "https://github.com/login/device");
        }
    }

    #[test]
    fn rejects_http_foreign_hosts_missing_codes_and_extra_prompts() {
        let http = "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: http://github.com/login/device\n";
        let foreign = "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://evil.example/login/device\n";
        let prompt = "? What is your preferred protocol for Git operations on this host?\n";
        let bad_code = "! First copy your one-time code: abcd-1234\n";
        for output in [http, foreign, prompt, bad_code] {
            assert_eq!(parse("github.com", output), Err(FlowError::Unparsed));
        }
        let missing_code =
            "Open this URL to continue in your web browser: https://github.com/login/device\n";
        assert_eq!(parse("github.com", missing_code), Ok(None));
    }

    #[test]
    fn reads_the_login_from_the_completion_lines() {
        let lines = vec![
            "✓ Authentication complete.".to_owned(),
            "- gh config set -h github.com git_protocol https".to_owned(),
            "✓ Logged in as octocat".to_owned(),
        ];
        assert_eq!(logged_in_as(&lines), Some("octocat".into()));
        assert_eq!(logged_in_as(&["✓ Authentication complete.".into()]), None);
    }
}
