//! The forge plugin conformance harness.
//!
//! It spawns a plugin executable the way the companion does (no shell,
//! stdin/stdout framing, stderr discarded, a private temporary state
//! directory) and checks every capability the plugin declares against
//! recorded fixture inputs: an account, a pull request and a remote the
//! plugin must be able to serve. Results are checked for shape and for the
//! typed error codes the companion maps.
//!
//! Writes are probed only with a deliberately stale head, and only when the
//! caller asks: a conformant plugin must answer `staleHead` (or invalid
//! params) and write nothing. A plugin that accepts such a write fails.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncWriteExt as _, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

use crate::{
    AuthMethodKind, AuthMethodsResult, AuthVerifyResult, ChecksResult, ConversationEntry,
    ConversationPage, FileContent, FilePatch, FileStatus, FilesResult, ForgeAccountRef, ForgePrRef,
    InitializeResult, ListResult, MAX_FILE_CONTENT_BYTES, PROTOCOL_VERSION, PluginIcon,
    PullRequestCategory, PullRequestOverview, RawActionCatalog, ResolveResult, ReviewThread,
    ScenarioContext, ThreadAnchor, capability, code, methods, read_frame, write_frame,
};

const CALL_TIMEOUT: Duration = Duration::from_mins(1);
const STALE_HEAD: &str = "codewide-conformance-stale-head";

/// The recorded inputs a plugin is checked with.
#[derive(Clone, Debug, Default)]
pub struct Fixtures {
    pub account: Option<ForgeAccountRef>,
    pub pull_request: Option<ForgePrRef>,
    pub remote: Option<String>,
    /// Probe write methods with a stale head (they must not write).
    pub write_probes: bool,
}

/// One check and its result.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutcome {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

/// The harness report.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub provider: Option<String>,
    pub version: Option<String>,
    pub capabilities: Vec<String>,
    pub checks: Vec<CheckOutcome>,
}

impl Report {
    /// Whether every check passed (and at least one ran).
    #[must_use]
    pub fn passed(&self) -> bool {
        !self.checks.is_empty() && self.checks.iter().all(|check| check.passed)
    }

    fn record(&mut self, name: &str, result: Result<String, String>) {
        let (passed, detail) = match result {
            Ok(detail) => (true, detail),
            Err(detail) => (false, detail),
        };
        self.checks.push(CheckOutcome {
            name: name.to_owned(),
            passed,
            detail,
        });
    }
}

/// A call's outcome: a result or a typed plugin error code.
enum Answer {
    Result(Value),
    Error(i64),
}

struct Session {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl Session {
    fn spawn(executable: &Path, args: &[String], state: &Path) -> Result<Self, String> {
        let mut child = Command::new(executable)
            .args(args)
            .current_dir(state)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("the plugin could not start: {error}"))?;
        let stdin = child.stdin.take().ok_or("no plugin stdin")?;
        let stdout = child.stdout.take().ok_or("no plugin stdout")?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        })
    }

    async fn call<P: Serialize>(&mut self, method: &str, params: &P) -> Result<Answer, String> {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let encoded = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        let exchange = async {
            write_frame(&mut self.stdin, &encoded)
                .await
                .map_err(|error| error.to_string())?;
            read_frame(&mut self.stdout)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "the plugin closed stdout".to_owned())
        };
        let frame = timeout(CALL_TIMEOUT, exchange)
            .await
            .map_err(|_| format!("{method} timed out"))??;
        let response: Value =
            serde_json::from_slice(&frame).map_err(|_| format!("{method}: invalid JSON"))?;
        if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
            || response.get("id").and_then(Value::as_u64) != Some(id)
        {
            return Err(format!("{method}: response version or id mismatch"));
        }
        if let Some(error) = response.get("error") {
            let code = error
                .get("code")
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("{method}: error without code"))?;
            return Ok(Answer::Error(code));
        }
        response
            .get("result")
            .cloned()
            .map(Answer::Result)
            .ok_or_else(|| format!("{method}: no result"))
    }

    async fn shutdown(mut self) {
        let _ = self.stdin.shutdown().await;
        if timeout(Duration::from_secs(2), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.start_kill();
        }
    }
}

/// A result of type `T`, or one of the `allowed` typed error codes.
fn expect<T: DeserializeOwned>(
    method: &str,
    answer: Result<Answer, String>,
    allowed: &[i64],
) -> Result<Option<T>, String> {
    match answer? {
        Answer::Result(value) => serde_json::from_value(value)
            .map(Some)
            .map_err(|error| format!("{method}: invalid result shape: {error}")),
        Answer::Error(code) if allowed.contains(&code) => Ok(None),
        Answer::Error(code) => Err(format!("{method}: unexpected error code {code}")),
    }
}

/// Runs the harness against one plugin executable.
pub async fn run(executable: &Path, args: &[String], fixtures: &Fixtures) -> Report {
    let mut report = Report::default();
    let state = state_directory();
    if let Err(error) = std::fs::create_dir_all(&state) {
        report.record("state directory", Err(error.to_string()));
        return report;
    }
    let session = Session::spawn(executable, args, &state);
    let mut session = match session {
        Ok(session) => session,
        Err(error) => {
            report.record("start", Err(error));
            return report;
        }
    };
    let declared = initialize(&mut session, &state, &mut report).await;
    if let Some(declared) = declared {
        check_auth(&mut session, &declared, fixtures, &mut report).await;
        check_reads(&mut session, &declared, fixtures, &mut report).await;
        check_resolve(&mut session, &declared, fixtures, &mut report).await;
        if fixtures.write_probes {
            check_writes(&mut session, &declared, fixtures, &mut report).await;
        }
        let unknown = session
            .call("codewide.conformance.unknown", &json!({}))
            .await;
        report.record(
            "unknown method",
            match unknown {
                Ok(Answer::Error(code::METHOD_NOT_FOUND)) => Ok("method not found".into()),
                Ok(_) => Err("an unknown method must answer -32601".into()),
                Err(error) => Err(error),
            },
        );
    }
    session.shutdown().await;
    let _ = std::fs::remove_dir_all(&state);
    report
}

fn state_directory() -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    std::env::temp_dir().join(format!(
        "codewide-forge-conformance-{}-{unique}",
        std::process::id()
    ))
}

async fn initialize(
    session: &mut Session,
    state: &Path,
    report: &mut Report,
) -> Option<Vec<String>> {
    let answer = session
        .call(
            methods::INITIALIZE,
            &json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": {"name": "codewide-conformance"},
                "capabilities": [
                    capability::AUTH, capability::LIST, capability::READ, capability::DIFF,
                    capability::ACTIONS, capability::REVIEW, capability::CHECKS, capability::VIEWED,
                    capability::RESOLVE, capability::SCENARIO_CONTEXT, capability::CONVERSATION,
                    capability::COMMENTS, capability::FILE_CONTENT
                ],
                "stateDirectory": state,
            }),
        )
        .await;
    let result = expect::<Value>(methods::INITIALIZE, answer, &[]).and_then(|raw| {
        let raw = raw.ok_or("initialize failed")?;
        // `InitializeResult` reads a malformed icon as none; the harness
        // holds a plugin to the exact `PluginIcon` shape.
        if let Some(icon) = raw.get("providerIcon").filter(|icon| !icon.is_null()) {
            serde_json::from_value::<PluginIcon>(icon.clone())
                .map_err(|error| format!("initialize: invalid providerIcon: {error}"))?;
        }
        let info = serde_json::from_value::<InitializeResult>(raw)
            .map_err(|error| format!("initialize: invalid result shape: {error}"))?;
        if info.protocol_version != PROTOCOL_VERSION {
            return Err(format!("protocol version {}", info.protocol_version));
        }
        if info.provider.is_empty() || info.version.is_empty() || info.forge_name.is_empty() {
            return Err("provider, forgeName and version are required".into());
        }
        if let Some(missing) = capability::REQUIRED
            .iter()
            .find(|required| !info.capabilities.iter().any(|cap| cap == *required))
        {
            return Err(format!("missing required capability {missing}"));
        }
        Ok(info)
    });
    match result {
        Ok(info) => {
            report.provider = Some(info.provider.clone());
            report.version = Some(info.version.clone());
            report.capabilities.clone_from(&info.capabilities);
            report.record(
                "initialize",
                Ok(format!("{} {}", info.provider, info.version)),
            );
            Some(info.capabilities)
        }
        Err(error) => {
            report.record("initialize", Err(error));
            None
        }
    }
}

async fn check_auth(
    session: &mut Session,
    _declared: &[String],
    fixtures: &Fixtures,
    report: &mut Report,
) {
    let methods_answer = session
        .call(methods::AUTH_METHODS, &json!({"host": null}))
        .await;
    let checked = expect::<AuthMethodsResult>(methods::AUTH_METHODS, methods_answer, &[]).and_then(
        |result| {
            let result = result.ok_or("auth.methods failed")?;
            for method in &result.methods {
                if !method.available
                    && method
                        .unavailable_reason
                        .as_deref()
                        .is_none_or(str::is_empty)
                {
                    return Err(format!(
                        "method {} is unavailable without a reason",
                        method.method_id
                    ));
                }
                if method.kind == AuthMethodKind::PasteToken
                    && method
                        .links
                        .iter()
                        .any(|link| !link.url.starts_with("https://"))
                {
                    return Err(format!(
                        "method {} links to a non-https page",
                        method.method_id
                    ));
                }
            }
            Ok(format!("{} methods", result.methods.len()))
        },
    );
    report.record(methods::AUTH_METHODS, checked);
    if let Some(account) = &fixtures.account {
        let answer = session
            .call(
                methods::AUTH_VERIFY,
                &json!({"host": account.host, "login": account.login, "purpose": "account"}),
            )
            .await;
        report.record(
            methods::AUTH_VERIFY,
            expect::<AuthVerifyResult>(methods::AUTH_VERIFY, answer, &[code::AUTH_REQUIRED]).map(
                |verified| {
                    verified.map_or_else(
                        || "authRequired".to_owned(),
                        |verified| format!("login {}", verified.login),
                    )
                },
            ),
        );
    }
}

async fn check_reads(
    session: &mut Session,
    declared: &[String],
    fixtures: &Fixtures,
    report: &mut Report,
) {
    let Some(account) = &fixtures.account else {
        return;
    };
    let typed = [
        code::AUTH_REQUIRED,
        code::CAPABILITY_UNAVAILABLE,
        code::RATE_LIMITED,
    ];
    let answer = session
        .call(
            methods::PULL_REQUESTS_LIST,
            &json!({"account": account, "category": PullRequestCategory::Authored, "repository": null, "cursor": null, "limit": 50}),
        )
        .await;
    report.record(
        methods::PULL_REQUESTS_LIST,
        expect::<ListResult>(methods::PULL_REQUESTS_LIST, answer, &typed).and_then(|listed| {
            let Some(listed) = listed else {
                return Ok("typed error".into());
            };
            if listed.rows.len() > 50 {
                return Err("more than 50 rows".into());
            }
            Ok(format!("{} rows", listed.rows.len()))
        }),
    );
    check_pull_request(session, declared, fixtures, account, report).await;
    if let Some(pr) = &fixtures.pull_request
        && declared.iter().any(|cap| cap == capability::CONVERSATION)
    {
        check_conversation(session, account, pr, report).await;
    }
}

async fn check_pull_request(
    session: &mut Session,
    declared: &[String],
    fixtures: &Fixtures,
    account: &ForgeAccountRef,
    report: &mut Report,
) {
    let Some(pr) = &fixtures.pull_request else {
        return;
    };
    let target = json!({"account": account, "ref": pr});
    let read = session.call(methods::PULL_REQUEST_READ, &target).await;
    let overview = match expect::<PullRequestOverview>(methods::PULL_REQUEST_READ, read, &[]) {
        Ok(Some(overview)) => {
            report.record(
                methods::PULL_REQUEST_READ,
                Ok(format!("head {}", overview.head_revision)),
            );
            overview
        }
        Ok(None) => return,
        Err(error) => {
            report.record(methods::PULL_REQUEST_READ, Err(error));
            return;
        }
    };
    let head = overview.head_revision.clone();
    let activity = session
        .call(
            methods::PULL_REQUEST_ACTIVITY,
            &json!({"account": account, "ref": pr, "cursor": null}),
        )
        .await;
    report.record(
        methods::PULL_REQUEST_ACTIVITY,
        expect::<crate::ActivityPage>(methods::PULL_REQUEST_ACTIVITY, activity, &[]).and_then(
            |page| {
                let Some(page) = page else {
                    return Ok("page".into());
                };
                let times: Vec<&str> = page
                    .items
                    .iter()
                    .map(|item| item.created_at.as_str())
                    .collect();
                newest_first(&times, "activity items")?;
                Ok(format!("{} items, newest first", page.items.len()))
            },
        ),
    );
    if declared.iter().any(|cap| cap == capability::CHECKS) {
        let checks = session
            .call(
                methods::PULL_REQUEST_CHECKS,
                &json!({"account": account, "ref": pr, "headRevision": head}),
            )
            .await;
        report.record(
            methods::PULL_REQUEST_CHECKS,
            expect::<ChecksResult>(
                methods::PULL_REQUEST_CHECKS,
                checks,
                &[code::CAPABILITY_UNAVAILABLE],
            )
            .map(|checks| {
                checks.map_or_else(
                    || "unavailable".into(),
                    |checks| format!("{} items", checks.items.len()),
                )
            }),
        );
    }
    let readable = check_files(session, account, pr, &head, report).await;
    if declared.iter().any(|cap| cap == capability::FILE_CONTENT) {
        check_file_content(
            session,
            &json!({"account": account, "ref": pr, "headRevision": head}),
            readable.as_deref(),
            report,
        )
        .await;
    }
    let actions = session.call(methods::PULL_REQUEST_ACTIONS, &target).await;
    report.record(
        methods::PULL_REQUEST_ACTIONS,
        expect::<RawActionCatalog>(methods::PULL_REQUEST_ACTIONS, actions, &[]).and_then(
            |catalog| {
                let catalog = catalog.ok_or("actions failed")?;
                if catalog.head_revision != head {
                    return Err("the catalog names another head".into());
                }
                Ok(format!("{} actions", catalog.actions.len()))
            },
        ),
    );
}

/// `forge.pullRequest.files` at the head and at a stale head; answers the
/// path of a listed file the head still has, with a patch.
async fn check_files(
    session: &mut Session,
    account: &ForgeAccountRef,
    pr: &ForgePrRef,
    head: &str,
    report: &mut Report,
) -> Option<String> {
    let files = session
        .call(
            methods::PULL_REQUEST_FILES,
            &json!({"account": account, "ref": pr, "headRevision": head, "cursor": null}),
        )
        .await;
    let files = expect::<FilesResult>(methods::PULL_REQUEST_FILES, files, &[]);
    // A file the head still has, with a patch, is one a client asks the whole content of.
    let readable = files
        .as_ref()
        .ok()
        .and_then(Option::as_ref)
        .and_then(|listed| {
            listed.files.iter().find(|file| {
                file.status != FileStatus::Removed
                    && matches!(file.patch, FilePatch::Present { .. })
            })
        })
        .map(|file| file.path.clone());
    report.record(
        methods::PULL_REQUEST_FILES,
        files.and_then(|files| {
            let files = files.ok_or("files failed")?;
            if files.head_revision != head {
                return Err("files answered another head".into());
            }
            Ok(format!("{} files", files.files.len()))
        }),
    );
    let stale = session
        .call(
            methods::PULL_REQUEST_FILES,
            &json!({"account": account, "ref": pr, "headRevision": STALE_HEAD, "cursor": null}),
        )
        .await;
    report.record(
        "forge.pullRequest.files stale head",
        match stale {
            Ok(Answer::Error(code::STALE_HEAD)) => Ok("staleHead".into()),
            Ok(_) => Err("a stale head must answer -32112".into()),
            Err(error) => Err(error),
        },
    );
    readable
}

/// `forge.fileContent@1`: a listed file reads as a bounded state, a path the
/// head cannot have reads as `missing`, and a traversing path is refused.
async fn check_file_content(
    session: &mut Session,
    target: &Value,
    readable: Option<&str>,
    report: &mut Report,
) {
    let mut read = async |path: &str| {
        let mut params = target.clone();
        params["path"] = json!(path);
        session
            .call(methods::PULL_REQUEST_FILE_CONTENT, &params)
            .await
    };
    if let Some(path) = readable {
        let answer = read(path).await;
        report.record(
            methods::PULL_REQUEST_FILE_CONTENT,
            expect::<FileContent>(methods::PULL_REQUEST_FILE_CONTENT, answer, &[])
                .and_then(|content| file_content_rules(content.ok_or("file content failed")?)),
        );
    }
    let missing = read("codewide-conformance/missing-file.txt").await;
    report.record(
        "forge.pullRequest.fileContent missing path",
        match expect::<FileContent>(methods::PULL_REQUEST_FILE_CONTENT, missing, &[]) {
            Ok(Some(FileContent::Missing)) => Ok("missing".into()),
            Ok(_) => Err("a path the head does not have must answer state missing".into()),
            Err(error) => Err(error),
        },
    );
    let traversal = read("../codewide-conformance").await;
    report.record(
        "forge.pullRequest.fileContent traversal",
        match traversal {
            Ok(Answer::Error(code::INVALID_PARAMS)) => Ok("refused".into()),
            Ok(_) => Err("a path with a .. segment must answer -32602".into()),
            Err(error) => Err(error),
        },
    );
}

/// The `FileContent` rules serde cannot express: text within the bound and
/// without NUL, and a `tooLarge` size, when known, above the bound.
fn file_content_rules(content: FileContent) -> Result<String, String> {
    match content {
        FileContent::Text { content } if content.len() > MAX_FILE_CONTENT_BYTES => Err(format!(
            "{} bytes of text exceed the 1 MiB bound",
            content.len()
        )),
        FileContent::Text { content } if content.contains('\0') => {
            Err("text content contains NUL".into())
        }
        FileContent::Text { content } => Ok(format!("{} bytes", content.len())),
        FileContent::TooLarge { bytes: Some(bytes) }
            if usize::try_from(bytes).is_ok_and(|bytes| bytes <= MAX_FILE_CONTENT_BYTES) =>
        {
            Err(format!("tooLarge reports {bytes} bytes, within the bound"))
        }
        FileContent::TooLarge { .. } => Ok("tooLarge".into()),
        FileContent::Binary => Ok("binary".into()),
        FileContent::Missing => Ok("missing".into()),
    }
}

/// `forge.conversation@1`: a well-formed first page, and a media read of a
/// foreign host refused without fetching it.
async fn check_conversation(
    session: &mut Session,
    account: &ForgeAccountRef,
    pr: &ForgePrRef,
    report: &mut Report,
) {
    let page = session
        .call(
            methods::PULL_REQUEST_CONVERSATION,
            &json!({"account": account, "ref": pr, "cursor": null}),
        )
        .await;
    let page = expect::<ConversationPage>(methods::PULL_REQUEST_CONVERSATION, page, &[]);
    let older = match &page {
        Ok(Some(ConversationPage {
            next_cursor: Some(cursor),
            ..
        })) => Some(expect::<ConversationPage>(
            methods::PULL_REQUEST_CONVERSATION,
            session
                .call(
                    methods::PULL_REQUEST_CONVERSATION,
                    &json!({"account": account, "ref": pr, "cursor": cursor}),
                )
                .await,
            &[],
        )),
        _ => None,
    };
    report.record(
        methods::PULL_REQUEST_CONVERSATION,
        page.and_then(|page| {
            let page = page.ok_or("conversation failed")?;
            let older = older.transpose()?.flatten();
            let entries: Vec<&ConversationEntry> = page
                .entries
                .iter()
                .chain(older.iter().flat_map(|older| &older.entries))
                .collect();
            for entry in &entries {
                if let ConversationEntry::ReviewThread { thread } = entry {
                    conversation_thread_rules(thread)?;
                }
            }
            let times: Vec<&str> = entries.iter().map(|entry| entry.created_at()).collect();
            newest_first(&times, "conversation entries")?;
            Ok(format!(
                "{} entries, newest first{}",
                page.entries.len(),
                if older.is_some() {
                    " across two pages"
                } else {
                    ""
                }
            ))
        }),
    );
    let foreign = session
        .call(
            methods::MEDIA_READ,
            &json!({"account": account, "url": "https://example.invalid/conformance.png"}),
        )
        .await;
    report.record(
        "forge.media.read foreign host",
        match foreign {
            Ok(Answer::Error(code::INVALID_PARAMS)) => Ok("refused".into()),
            Ok(_) => Err("a foreign media host must answer -32602".into()),
            Err(error) => Err(error),
        },
    );
}

/// The `ReviewThread` rules serde cannot express: at least one comment,
/// comments oldest first, positive lines with `startLine` strictly before
/// `line`, a positive iteration number and a non-empty anchored path.
fn conversation_thread_rules(thread: &ReviewThread) -> Result<(), String> {
    if thread.comments.is_empty() {
        return Err(format!("review thread {} has no comments", thread.id));
    }
    let mut times: Vec<&str> = thread
        .comments
        .iter()
        .map(|comment| comment.created_at.as_str())
        .collect();
    times.reverse();
    newest_first(
        &times,
        &format!("review thread {} comments (oldest first)", thread.id),
    )?;
    let anchor_valid = match &thread.anchor {
        ThreadAnchor::PullRequest => true,
        ThreadAnchor::File { path } => !path.is_empty(),
        ThreadAnchor::Line {
            path,
            line,
            start_line,
            ..
        } => {
            !path.is_empty()
                && *line > 0
                && start_line.is_none_or(|start| start > 0 && start < *line)
        }
    };
    if !anchor_valid {
        return Err(format!("review thread {} has an invalid anchor", thread.id));
    }
    if thread
        .iteration
        .as_ref()
        .is_some_and(|iteration| iteration.number == 0 || iteration.id.is_empty())
    {
        return Err(format!(
            "review thread {} has an invalid iteration",
            thread.id
        ));
    }
    Ok(())
}

/// Order keys that must not increase: every one RFC 3339, each at most
/// as late as the one before it.
fn newest_first(times: &[&str], what: &str) -> Result<(), String> {
    let mut previous: Option<(i64, u32)> = None;
    for time in times {
        let instant = rfc3339_instant(time)
            .ok_or_else(|| format!("{what}: createdAt {time:?} is not RFC 3339"))?;
        if previous.is_some_and(|previous| instant > previous) {
            return Err(format!("{what} are not newest first at {time}"));
        }
        previous = Some(instant);
    }
    Ok(())
}

/// An RFC 3339 timestamp as seconds since the Unix epoch and nanoseconds,
/// so timestamps with different offsets or precision compare correctly.
fn rfc3339_instant(text: &str) -> Option<(i64, u32)> {
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let digits = text.get(range)?;
        digits
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| digits.parse().ok())?
    };
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !matches!(bytes[10], b'T' | b't' | b' ')
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = &text[19..];
    let mut nanos = 0_u32;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        for (index, byte) in fraction.bytes().take(digits).enumerate() {
            if index < 9 {
                nanos = nanos * 10 + u32::from(byte - b'0');
            }
        }
        for _ in digits..9 {
            nanos *= 10;
        }
        rest = &fraction[digits..];
    }
    let offset = match rest {
        "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes().first()? {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let offset = rest.get(1..)?;
            if offset.len() != 5 || offset.as_bytes()[2] != b':' {
                return None;
            }
            let hours: i64 = offset[..2].parse().ok()?;
            let minutes: i64 = offset[3..].parse().ok()?;
            sign * (hours * 3_600 + minutes * 60)
        }
    };
    // Days from the civil date (Howard Hinnant's algorithm).
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some((
        days * 86_400 + hour * 3_600 + minute * 60 + second - offset,
        nanos,
    ))
}

async fn check_resolve(
    session: &mut Session,
    declared: &[String],
    fixtures: &Fixtures,
    report: &mut Report,
) {
    if !declared.iter().any(|cap| cap == capability::RESOLVE) {
        return;
    }
    let foreign = session
        .call(
            methods::REPOSITORY_RESOLVE,
            &json!({"remotes": ["https://example.invalid/conformance/none.git"]}),
        )
        .await;
    report.record(
        "forge.repository.resolve foreign remote",
        match foreign {
            Ok(Answer::Error(code::NOT_OWNED)) => Ok("not owned".into()),
            Ok(_) => Err("a foreign remote must answer -32004".into()),
            Err(error) => Err(error),
        },
    );
    if let Some(remote) = &fixtures.remote {
        let answer = session
            .call(methods::REPOSITORY_RESOLVE, &json!({"remotes": [remote]}))
            .await;
        report.record(
            methods::REPOSITORY_RESOLVE,
            expect::<ResolveResult>(methods::REPOSITORY_RESOLVE, answer, &[]).and_then(
                |resolved| {
                    let resolved = resolved.ok_or("resolve failed")?;
                    Ok(format!("{} on {}", resolved.repository, resolved.host))
                },
            ),
        );
    }
}

async fn check_writes(
    session: &mut Session,
    declared: &[String],
    fixtures: &Fixtures,
    report: &mut Report,
) {
    let (Some(account), Some(pr)) = (&fixtures.account, &fixtures.pull_request) else {
        return;
    };
    let refused = [code::STALE_HEAD, code::INVALID_PARAMS];
    let mut probe = async |name: &str, method: &str, params: Value| {
        let answer = session.call(method, &params).await;
        let outcome = match answer {
            Ok(Answer::Error(code)) if refused.contains(&code) => {
                Ok("refused at a stale head".into())
            }
            Ok(Answer::Error(code)) => Err(format!("unexpected error code {code}")),
            Ok(Answer::Result(_)) => Err("accepted a write at a stale head".into()),
            Err(error) => Err(error),
        };
        (name.to_owned(), outcome)
    };
    let mut results = vec![
        probe(
            "forge.pullRequest.action.run stale head",
            methods::PULL_REQUEST_ACTION_RUN,
            json!({"account": account, "ref": pr, "actionId": "merge", "headRevision": STALE_HEAD, "input": null, "idempotencyKey": "conformance-action"}),
        )
        .await,
        probe(
            "forge.pullRequest.review.submit stale head",
            methods::PULL_REQUEST_REVIEW_SUBMIT,
            json!({"account": account, "ref": pr, "headRevision": STALE_HEAD, "verdictActionId": "comment", "body": "conformance", "comments": [], "idempotencyKey": "conformance-review"}),
        )
        .await,
    ];
    if declared.iter().any(|cap| cap == capability::VIEWED) {
        results.push(
            probe(
                "forge.pullRequest.viewed.set stale head",
                methods::PULL_REQUEST_VIEWED_SET,
                json!({"account": account, "ref": pr, "headRevision": STALE_HEAD, "path": "README.md", "viewed": true}),
            )
            .await,
        );
    }
    for (name, outcome) in results {
        report.record(&name, outcome);
    }
    if declared.iter().any(|cap| cap == capability::COMMENTS) {
        // A reply to a thread that cannot exist writes nothing; a comment
        // create has no safe probe, because it publishes immediately.
        let answer = session
            .call(
                methods::PULL_REQUEST_REVIEW_THREAD_REPLY,
                &json!({"account": account, "ref": pr, "threadId": "codewide-conformance-missing-thread",
                        "body": "conformance", "idempotencyKey": "conformance-reply"}),
            )
            .await;
        report.record(
            "forge.pullRequest.reviewThread.reply missing thread",
            match answer {
                Ok(Answer::Error(
                    code::NOT_FOUND | code::INVALID_PARAMS | code::FORGE_REJECTED,
                )) => Ok("refused".into()),
                Ok(Answer::Error(code)) => Err(format!("unexpected error code {code}")),
                Ok(Answer::Result(_)) => Err("replied to a thread that does not exist".into()),
                Err(error) => Err(error),
            },
        );
    }
    if declared
        .iter()
        .any(|cap| cap == capability::SCENARIO_CONTEXT)
    {
        let answer = session
            .call(
                methods::PULL_REQUEST_SCENARIO_CONTEXT,
                &json!({"account": account, "ref": pr, "scenario": "reviewPr", "checkId": null}),
            )
            .await;
        report.record(
            methods::PULL_REQUEST_SCENARIO_CONTEXT,
            expect::<ScenarioContext>(methods::PULL_REQUEST_SCENARIO_CONTEXT, answer, &[])
                .and_then(|context| {
                    let context = context.ok_or("scenario context failed")?;
                    let size = serde_json::to_vec(&context).map_or(usize::MAX, |bytes| bytes.len());
                    if size > crate::MAX_SCENARIO_CONTEXT_BYTES {
                        return Err(format!("{size} bytes exceed the 64 KiB bound"));
                    }
                    Ok(format!("{size} bytes"))
                }),
        );
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    fn thread(anchor: &Value, iteration: &Value) -> ReviewThread {
        serde_json::from_value(json!({
            "id": "t-1", "anchor": anchor, "outdated": false,
            "resolution": {"kind": "none"}, "reviewId": null, "iteration": iteration,
            "comments": [{"id": "c", "author": {"login": "a", "kind": "user", "avatarUrl": null},
                          "createdAt": "2026-10-01T00:00:00Z", "updatedAt": null, "body": "x",
                          "url": null, "reactions": []}],
            "viewerCanReply": false
        }))
        .expect("thread")
    }

    #[test]
    fn file_content_rules_hold_text_and_sizes_to_the_bound() {
        assert!(
            file_content_rules(FileContent::Text {
                content: "a\n".into()
            })
            .is_ok()
        );
        assert!(
            file_content_rules(FileContent::Text {
                content: "a\0".into()
            })
            .is_err()
        );
        assert!(
            file_content_rules(FileContent::Text {
                content: "a".repeat(MAX_FILE_CONTENT_BYTES + 1)
            })
            .is_err()
        );
        assert!(file_content_rules(FileContent::TooLarge { bytes: Some(10) }).is_err());
        assert!(file_content_rules(FileContent::TooLarge { bytes: None }).is_ok());
        assert!(file_content_rules(FileContent::Missing).is_ok());
    }

    #[test]
    fn order_rules_compare_instants_across_offsets_and_precision() {
        assert_eq!(rfc3339_instant("1970-01-01T00:00:00Z"), Some((0, 0)));
        assert_eq!(
            rfc3339_instant("2026-10-01T03:00:00+03:00"),
            rfc3339_instant("2026-10-01T00:00:00Z")
        );
        assert_eq!(
            rfc3339_instant("2026-10-01T00:00:00.5Z"),
            rfc3339_instant("2026-10-01T00:00:00.500000000Z")
        );
        assert_eq!(rfc3339_instant("2026-10-01"), None);
        assert!(
            newest_first(
                &[
                    "2026-10-02T00:00:00Z",
                    "2026-10-01T05:00:00+03:00",
                    "2026-10-01T01:00:00.5Z",
                    "2026-10-01T01:00:00Z",
                    "2026-10-01T01:00:00Z",
                ],
                "entries"
            )
            .is_ok()
        );
        assert!(
            newest_first(&["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"], "entries").is_err()
        );
        assert!(newest_first(&["yesterday"], "entries").is_err());
    }

    #[test]
    fn thread_rules_require_comments_oldest_first() {
        let mut later = thread(&json!({"kind": "pullRequest"}), &Value::Null);
        let mut reply = later.comments[0].clone();
        reply.created_at = "2026-10-01T01:00:00Z".into();
        later.comments.push(reply);
        assert!(conversation_thread_rules(&later).is_ok());
        later.comments.reverse();
        assert!(conversation_thread_rules(&later).is_err());
    }

    #[test]
    fn thread_rules_refuse_impossible_lines_and_iterations() {
        let line = |line: u32, start: Option<u32>| json!({"kind": "line", "path": "a.rs", "line": line, "startLine": start, "side": "new"});
        for valid in [
            thread(&json!({"kind": "pullRequest"}), &Value::Null),
            thread(
                &json!({"kind": "file", "path": "a.rs"}),
                &json!({"id": "i", "number": 1}),
            ),
            thread(&line(4, Some(2)), &Value::Null),
            thread(&line(4, None), &Value::Null),
        ] {
            assert!(conversation_thread_rules(&valid).is_ok());
        }
        for invalid in [
            thread(&json!({"kind": "file", "path": ""}), &Value::Null),
            thread(&line(0, None), &Value::Null),
            thread(&line(4, Some(4)), &Value::Null),
            thread(&line(4, Some(0)), &Value::Null),
            thread(&line(4, None), &json!({"id": "i", "number": 0})),
        ] {
            assert!(conversation_thread_rules(&invalid).is_err());
        }
    }
}
