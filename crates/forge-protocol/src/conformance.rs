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
    ConversationPage, FilesResult, ForgeAccountRef, ForgePrRef, InitializeResult, ListResult,
    PROTOCOL_VERSION, PluginIcon, PullRequestCategory, PullRequestOverview, RawActionCatalog,
    ResolveResult, ReviewThread, ScenarioContext, ThreadAnchor, capability, code, methods,
    read_frame, write_frame,
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
                    capability::COMMENTS
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
        expect::<crate::ActivityPage>(methods::PULL_REQUEST_ACTIVITY, activity, &[])
            .map(|_| "page".into()),
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
    let files = session
        .call(
            methods::PULL_REQUEST_FILES,
            &json!({"account": account, "ref": pr, "headRevision": head, "cursor": null}),
        )
        .await;
    report.record(
        methods::PULL_REQUEST_FILES,
        expect::<FilesResult>(methods::PULL_REQUEST_FILES, files, &[]).and_then(|files| {
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
    report.record(
        methods::PULL_REQUEST_CONVERSATION,
        expect::<ConversationPage>(methods::PULL_REQUEST_CONVERSATION, page, &[]).and_then(
            |page| {
                let page = page.ok_or("conversation failed")?;
                for entry in &page.entries {
                    if let ConversationEntry::ReviewThread { thread } = entry {
                        conversation_thread_rules(thread)?;
                    }
                }
                Ok(format!("{} entries", page.entries.len()))
            },
        ),
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
/// positive lines with `startLine` strictly before `line`, a positive
/// iteration number and a non-empty anchored path.
fn conversation_thread_rules(thread: &ReviewThread) -> Result<(), String> {
    if thread.comments.is_empty() {
        return Err(format!("review thread {} has no comments", thread.id));
    }
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
