//! Fixture tests of the GitHub plugin against a fake `gh` and a local fake
//! GitHub API, driven through the real protocol loop.
//!
//! They prove the BE S1 auth contract: link existing, host login (pending,
//! complete, cancel, expiry, unparsable output), gh missing or too old,
//! pasted tokens (valid classic, missing scopes, invalid, fine-grained),
//! credential precedence, and that no response frame and no other request
//! frame carries a token.
#![allow(clippy::expect_used)]

use std::{
    collections::HashMap,
    fs,
    os::unix::fs::PermissionsExt as _,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::Bytes,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use forge_github::{
    GithubPlugin, PluginConfig, api::Endpoints, credentials::EnvTokens, media::MediaOrigins,
};
use forge_protocol::{Secret, read_frame, serve, write_frame};
use serde_json::{Value, json};
use tokio::io::{AsyncWriteExt as _, BufReader, DuplexStream};

const GH_TOKEN: &str = "gho_sentinel_gh_cli_token";
const ENV_TOKEN: &str = "ghp_sentinel_environment_token";
const ENTERPRISE_TOKEN: &str = "ghp_sentinel_enterprise_token";
const PASTED_TOKEN: &str = "ghp_sentinel_pasted_classic_token";
const FINE_GRAINED_TOKEN: &str = "github_pat_sentinel_fine_grained";
const NARROW_TOKEN: &str = "ghp_sentinel_missing_scopes";
const ALL_TOKENS: [&str; 6] = [
    GH_TOKEN,
    ENV_TOKEN,
    ENTERPRISE_TOKEN,
    PASTED_TOKEN,
    FINE_GRAINED_TOKEN,
    NARROW_TOKEN,
];

/// A fake GitHub API: tokens map to logins and optional classic scopes.
#[derive(Default)]
struct FakeGithub {
    tokens: HashMap<String, (String, Option<String>)>,
    /// `(api tag, bearer token)` of every request.
    seen: Vec<(String, String)>,
    search_queries: Vec<String>,
    submitted_reviews: usize,
    /// `PRRT_1`'s resolution, and every resolve mutation GitHub received.
    thread_resolved: bool,
    resolve_mutations: Vec<String>,
    /// The credentialed web origin, the anonymous media host and a foreign
    /// host, for redirects.
    web_base: String,
    media_base: String,
    foreign_base: String,
    /// `(media server path, had an Authorization header)` of every media hit.
    media_hits: Vec<(String, bool)>,
    foreign_hits: usize,
    created_comments: Vec<String>,
    /// `(encoded path, query, Accept)` of every contents request.
    content_requests: Vec<(String, String, String)>,
}

/// A PNG signature followed by padding, `size` bytes long.
fn png(size: usize) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.resize(size, 0);
    bytes
}

/// An anonymous media host (`foreign = false`) or a host no account owns.
async fn serve_media(state: Shared, foreign: bool) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let address = listener.local_addr().expect("address");
    let router = Router::new().fallback(move |uri: Uri, headers: HeaderMap| {
        let state = state.clone();
        async move {
            let mut state = state.lock().expect("state");
            if foreign {
                state.foreign_hits += 1;
                return png(16).into_response();
            }
            state
                .media_hits
                .push((uri.path().to_owned(), headers.contains_key("authorization")));
            let foreign_base = state.foreign_base.clone();
            match uri.path() {
                "/img.png" => ([("content-type", "image/png")], png(64)).into_response(),
                "/huge.png" => png(11 * 1024 * 1024).into_response(),
                "/away" => (
                    StatusCode::FOUND,
                    [("location", format!("{foreign_base}/img.png"))],
                )
                    .into_response(),
                _ => StatusCode::NOT_FOUND.into_response(),
            }
        }
    });
    tokio::spawn(async move { axum::serve(listener, router).await });
    format!("http://{address}")
}

fn graphql_comment(id: &str, body: &str) -> Value {
    json!({"id": id, "author": {"login": "hubot", "avatarUrl": null}, "createdAt": "2026-10-02T00:00:00Z",
           "lastEditedAt": null, "body": body, "url": null, "reactionGroups": []})
}

/// A thread comment published with the review `review_id`.
fn review_comment(id: &str, body: &str, review_id: &str) -> Value {
    let mut comment = graphql_comment(id, body);
    comment["pullRequestReview"] = json!({"id": review_id});
    comment
}

type Shared = Arc<Mutex<FakeGithub>>;

async fn serve_api(tag: &'static str, state: Shared) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let address = listener.local_addr().expect("address");
    let router = Router::new().fallback(
        move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
            let state = state.clone();
            async move { respond(tag, &state, &method, &uri, &headers, &body) }
        },
    );
    tokio::spawn(async move { axum::serve(listener, router).await });
    format!("http://{address}")
}

fn respond(
    tag: &str,
    state: &Shared,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> Response {
    let token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_owned();
    let mut state = state.lock().expect("state");
    state.seen.push((tag.to_owned(), token.clone()));
    let Some((login, scopes)) = state.tokens.get(&token).cloned() else {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"message": "Bad credentials"})),
        )
            .into_response();
    };
    if let Some(response) = conversation_rest(&mut state, method, uri, &login, body) {
        return response;
    }
    if let Some(response) = contents_rest(&mut state, uri, headers) {
        return response;
    }
    let json = |value: Value| axum::Json(value).into_response();
    match (method.as_str(), uri.path()) {
        ("GET", "/user") => {
            let mut response = json(json!({"login": login}));
            if let Some(scopes) = scopes {
                response
                    .headers_mut()
                    .insert("x-oauth-scopes", scopes.parse().expect("header"));
            }
            response
        }
        ("POST", "/graphql") => {
            let query: Value = serde_json::from_slice(body).expect("graphql body");
            let text = query["query"].as_str().unwrap_or_default();
            if let Some(response) = conversation_graphql(&mut state, &query) {
                response
            } else if text.contains("search(") {
                state.search_queries.push(
                    query
                        .pointer("/variables/q")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                );
                json(json!({"data": {"search": {
                    "pageInfo": {"hasNextPage": false, "endCursor": null},
                    "nodes": [{
                        "number": 1, "title": "Fix the parser", "url": "https://github.com/octo/repo/pull/1",
                        "isDraft": false, "state": "OPEN", "updatedAt": "2026-10-01T00:00:00Z",
                        "author": {"login": "someone"}, "repository": {"nameWithOwner": "octo/repo"},
                        "reviewRequests": {"nodes": [{"requestedReviewer": {"login": login}}]},
                        "commits": {"nodes": []}
                    }]
                }}}))
            } else {
                json(json!({"data": {"repository": {"pullRequest": {"files": {
                    "pageInfo": {"hasNextPage": false, "endCursor": null}, "nodes": []
                }}}}}))
            }
        }
        ("GET", "/repos/octo/repo/pulls/1") => json(json!({
            "node_id": "PR_1", "head": {"sha": "abc123", "ref": "fix"}, "base": {"ref": "main"},
            "state": "open", "draft": false, "merged": false, "user": {"login": "someone"},
            "title": "Fix the parser", "body": "Body", "html_url": "https://github.com/octo/repo/pull/1",
            "changed_files": 1, "additions": 1, "deletions": 0, "mergeable_state": "clean",
            "updated_at": "2026-10-01T00:00:00Z"
        })),
        ("GET", "/repos/octo/repo") => json(json!({"allow_merge_commit": true})),
        ("GET", path) if path.ends_with("/comments") || path.ends_with("/reviews") => {
            json(json!([]))
        }
        ("POST", "/repos/octo/repo/pulls/1/reviews") => {
            state.submitted_reviews += 1;
            json(json!({"html_url": "https://github.com/octo/repo/pull/1#review-1"}))
        }
        _ => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({"message": "Not Found"})),
        )
            .into_response(),
    }
}

/// The conversation GraphQL operations: a page, a thread's owner and a reply.
fn conversation_graphql(state: &mut FakeGithub, query: &Value) -> Option<Response> {
    let json = |value: Value| axum::Json(value).into_response();
    let text = query["query"].as_str().unwrap_or_default();
    let thread_state = |resolved: bool| json!({"isResolved": resolved, "viewerCanResolve": !resolved, "viewerCanUnresolve": resolved});
    let response = if let Some(mutation) = ["unresolveReviewThread", "resolveReviewThread"]
        .into_iter()
        .find(|mutation| text.contains(&format!("{mutation}(")))
    {
        state.resolve_mutations.push(mutation.to_owned());
        state.thread_resolved = mutation == "resolveReviewThread";
        json(json!({"data": {mutation: {"thread": thread_state(state.thread_resolved)}}}))
    } else if text.contains("addPullRequestReviewThreadReply") {
        let reply = query
            .pointer("/variables/body")
            .and_then(Value::as_str)
            .unwrap_or_default();
        state.created_comments.push(reply.to_owned());
        json(json!({"data": {"addPullRequestReviewThreadReply": {
            "comment": graphql_comment("PRRC_new", reply)
        }}}))
    } else if text.contains("pullRequest { number repository") {
        let number = if query.pointer("/variables/id") == Some(&json!("PRRT_1")) {
            1
        } else {
            2
        };
        let mut node = json!({"__typename": "PullRequestReviewThread",
            "pullRequest": {"number": number, "repository": {"nameWithOwner": "octo/repo"}}});
        if let (Some(node), Value::Object(fields)) =
            (node.as_object_mut(), thread_state(state.thread_resolved))
        {
            node.extend(fields);
        }
        json(json!({"data": {"node": node}}))
    } else if text.contains("reviewThreads(") {
        json(json!({"data": {"repository": {"pullRequest": {
            "timelineItems": {"pageInfo": {"hasPreviousPage": false}, "edges": [
                {"cursor": "t1", "node": {"__typename": "IssueComment", "id": "IC_1",
                    "author": {"__typename": "Bot", "login": "ci-bot", "avatarUrl": null}, "createdAt": "2026-10-01T00:00:00Z",
                    "lastEditedAt": null, "body": "Looks good", "url": null, "reactionGroups": []}}
            ]},
            "reviewThreads": {"pageInfo": {"hasPreviousPage": false}, "edges": [
                {"cursor": "r1", "node": {"id": "PRRT_1", "path": "src/a.rs", "line": 3, "startLine": null,
                    "diffSide": "RIGHT", "isResolved": false, "isOutdated": false, "viewerCanReply": true,
                    "viewerCanResolve": true, "viewerCanUnresolve": false,
                    "opening": {"nodes": [{"diffHunk": "@@ -1,2 +1,3 @@\n fn a() {}\n+fn b() {}\n fn c() {}"}]},
                    "comments": {"pageInfo": {"hasNextPage": false, "endCursor": null},
                        "nodes": [review_comment("PRRC_1", "Rename this", "PRR_1")]}}}
            ]}
        }}}}))
    } else {
        return None;
    };
    Some(response)
}

/// The conversation REST routes: a new comment and the media of the web
/// origin.
fn conversation_rest(
    state: &mut FakeGithub,
    method: &Method,
    uri: &Uri,
    login: &str,
    body: &Bytes,
) -> Option<Response> {
    Some(match (method.as_str(), uri.path()) {
        ("POST", "/repos/octo/repo/issues/1/comments") => {
            let request: Value = serde_json::from_slice(body).expect("comment body");
            let text = request["body"].as_str().unwrap_or_default().to_owned();
            state.created_comments.push(text.clone());
            (
                StatusCode::CREATED,
                axum::Json(json!({
                    "id": 11, "node_id": "IC_new", "user": {"login": login, "avatar_url": null},
                    "created_at": "2026-10-02T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z",
                    "body": text, "html_url": "https://github.com/octo/repo/pull/1#issuecomment-11"
                })),
            )
                .into_response()
        }
        ("GET", "/user-attachments/assets/direct") => png(32).into_response(),
        ("GET", "/user-attachments/assets/redirect") => (
            StatusCode::FOUND,
            [("location", format!("{}/img.png", state.media_base))],
        )
            .into_response(),
        ("GET", "/user-attachments/assets/foreign") => (
            StatusCode::FOUND,
            [("location", format!("{}/img.png", state.foreign_base))],
        )
            .into_response(),
        _ => return None,
    })
}

/// The head commit the contents routes answer.
const HEAD_SHA: &str = "0123456789abcdef0123456789abcdef01234567";
const HEAD_FILE: &str = "fn main() {\n    new();\n}\n";

/// The contents API in the raw media type at [`HEAD_SHA`]: a text file, a
/// file with a space in its name, a binary, an oversized file, a directory
/// (answered as a JSON listing) and 404 for anything else.
fn contents_rest(state: &mut FakeGithub, uri: &Uri, headers: &HeaderMap) -> Option<Response> {
    let path = uri.path().strip_prefix("/repos/octo/repo/contents/")?;
    let accept = headers
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let query = uri.query().unwrap_or_default().to_owned();
    state
        .content_requests
        .push((path.to_owned(), query.clone(), accept));
    let raw = |body: Vec<u8>| {
        (
            [(
                "content-type",
                "application/vnd.github.raw+json; charset=utf-8",
            )],
            body,
        )
            .into_response()
    };
    if query != format!("ref={HEAD_SHA}") {
        return Some(StatusCode::NOT_FOUND.into_response());
    }
    Some(match path {
        "src/a.rs" => raw(HEAD_FILE.as_bytes().to_vec()),
        "docs/read%20me.md" => raw(b"# Read me\n".to_vec()),
        "assets/logo.png" => raw(png(64)),
        "data/huge.txt" => raw(vec![b'a'; forge_protocol::MAX_FILE_CONTENT_BYTES + 1]),
        "src" => axum::Json(json!([{"type": "file", "name": "a.rs"}])).into_response(),
        _ => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({"message": "Not Found"})),
        )
            .into_response(),
    })
}

/// A fake `gh` whose state lives in files of `dir`.
fn fake_gh(dir: &Path, version: Option<&str>) -> PathBuf {
    let state = dir.join("gh-state");
    fs::create_dir_all(state.join("tokens")).expect("gh state");
    fs::write(state.join("logins"), "").expect("logins");
    if let Some(version) = version {
        fs::write(state.join("version"), version).expect("version");
    }
    let script = dir.join("gh");
    fs::write(
        &script,
        format!(
            r#"#!/bin/sh
state='{state}'
echo "$*" >> "$state/calls"
case "$1 $2" in
  "--version ")
    [ -f "$state/version" ] || exit 127
    printf 'gh version %s (2026-01-01)\nhttps://github.com/cli/cli/releases\n' "$(cat "$state/version")"
    ;;
  "auth status")
    while read -r login; do
      [ -n "$login" ] && printf '  ✓ Logged in to %s account %s (keyring)\n  - Token: gho_****\n' "$4" "$login" >&2
    done < "$state/logins"
    ;;
  "auth token")
    [ -f "$state/tokens/$6" ] || exit 1
    cat "$state/tokens/$6"
    ;;
  "auth logout")
    rm -f "$state/tokens/$6"
    grep -v "^$6\$" "$state/logins" > "$state/logins.next"; mv "$state/logins.next" "$state/logins"
    ;;
  "auth login")
    cat "$state/login_output" >&2
    mode=$(cat "$state/login_mode")
    if [ "$mode" = "complete" ]; then
      while [ ! -f "$state/login_go" ]; do sleep 0.05; done
      printf 'hubot\n' >> "$state/logins"
      printf '%s' '{gh_token}' > "$state/tokens/hubot"
      echo "✓ Authentication complete." >&2
      echo "✓ Logged in as hubot" >&2
      exit 0
    fi
    sleep 30
    ;;
esac
"#,
            state = state.display(),
            gh_token = GH_TOKEN,
        ),
    )
    .expect("script");
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
    script
}

struct Harness {
    dir: tempfile::TempDir,
    api: Shared,
    client_in: BufReader<DuplexStream>,
    client_out: DuplexStream,
    /// Every frame in both directions, as text.
    traffic: Vec<String>,
    next_id: u64,
}

impl Harness {
    async fn start(gh_version: Option<&str>, env: EnvTokens, lifetime: Duration) -> Self {
        let dir = tempfile::tempdir().expect("dir");
        let api: Shared = Arc::default();
        {
            let mut state = api.lock().expect("state");
            for (token, login, scopes) in [
                (GH_TOKEN, "hubot", Some("repo, read:org, gist")),
                (ENV_TOKEN, "octocat", Some("repo, read:org")),
                (ENTERPRISE_TOKEN, "enterprise-user", Some("repo, read:org")),
                (PASTED_TOKEN, "paster", Some("repo, read:org, workflow")),
                (FINE_GRAINED_TOKEN, "finegrained", None),
                (NARROW_TOKEN, "narrow", Some("gist")),
            ] {
                state.tokens.insert(
                    token.to_owned(),
                    (login.to_owned(), scopes.map(str::to_owned)),
                );
            }
        }
        let public = serve_api("github.com", api.clone()).await;
        let enterprise = serve_api("ghe.example.com", api.clone()).await;
        let other = serve_api("other.example", api.clone()).await;
        let media = serve_media(api.clone(), false).await;
        let foreign = serve_media(api.clone(), true).await;
        {
            let mut state = api.lock().expect("state");
            state.web_base.clone_from(&public);
            state.media_base.clone_from(&media);
            state.foreign_base = foreign;
        }
        let web_origin = public.clone();
        let gh = fake_gh(dir.path(), gh_version);
        let config = PluginConfig {
            gh_program: gh,
            env,
            endpoints: Arc::new(move |host: &str| {
                let base = match host {
                    "github.com" => &public,
                    "ghe.example.com" => &enterprise,
                    _ => &other,
                };
                Endpoints {
                    rest: base.clone(),
                    graphql: format!("{base}/graphql"),
                }
            }),
            media: Arc::new(move |host: &str| {
                if host == "github.com" {
                    MediaOrigins {
                        credentialed: vec![web_origin.clone()],
                        anonymous: vec![media.clone()],
                    }
                } else {
                    MediaOrigins::for_host(host)
                }
            }),
            version: "9.9.9".into(),
            flow_lifetime: lifetime,
        };
        let (client_out, plugin_in) = tokio::io::duplex(1 << 20);
        let (plugin_out, client_in) = tokio::io::duplex(1 << 20);
        tokio::spawn(async move {
            let mut plugin = GithubPlugin::new(config);
            let mut reader = BufReader::new(plugin_in);
            let mut writer = plugin_out;
            let _ = serve(&mut plugin, &mut reader, &mut writer).await;
        });
        let mut harness = Self {
            dir,
            api,
            client_in: BufReader::new(client_in),
            client_out,
            traffic: Vec::new(),
            next_id: 1,
        };
        let state = harness.dir.path().join("plugin-state");
        let initialized = harness
            .call(
                "initialize",
                json!({"protocolVersion": 1, "client": {"name": "test"}, "capabilities": [], "stateDirectory": state}),
            )
            .await;
        assert_eq!(initialized["result"]["provider"], "github");
        assert_eq!(initialized["result"]["version"], "9.9.9");
        // The plugin declares its own identity: the GitHub mark and host.
        assert_eq!(initialized["result"]["defaultHost"], "github.com");
        assert_eq!(initialized["result"]["providerIcon"]["kind"], "glyph");
        assert_eq!(
            initialized["result"]["providerIcon"]["viewBox"],
            "0 0 16 16"
        );
        assert!(
            initialized["result"]["providerIcon"]["path"]
                .as_str()
                .is_some_and(|path| path.starts_with("M8 0C3.58"))
        );
        harness
    }

    fn gh_state(&self) -> PathBuf {
        self.dir.path().join("gh-state")
    }

    fn secrets(&self) -> PathBuf {
        self.dir.path().join("plugin-state/secrets")
    }

    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let encoded = serde_json::to_vec(&request).expect("encode");
        self.traffic
            .push(String::from_utf8(encoded.clone()).expect("utf8"));
        write_frame(&mut self.client_out, &encoded)
            .await
            .expect("write");
        let frame = read_frame(&mut self.client_in)
            .await
            .expect("read")
            .expect("frame");
        self.traffic
            .push(String::from_utf8(frame.clone()).expect("utf8"));
        serde_json::from_slice(&frame).expect("json")
    }

    async fn close(mut self) -> Vec<String> {
        self.client_out.shutdown().await.expect("close");
        self.traffic
    }

    fn calls(&self) -> String {
        fs::read_to_string(self.gh_state().join("calls")).unwrap_or_default()
    }
}

fn no_env() -> EnvTokens {
    EnvTokens::default()
}

fn account(login: &str) -> Value {
    json!({"host": "github.com", "login": login})
}

fn method<'a>(methods: &'a Value, id: &str) -> &'a Value {
    methods["result"]["methods"]
        .as_array()
        .expect("methods")
        .iter()
        .find(|method| method["methodId"] == id)
        .expect("method")
}

#[tokio::test]
async fn gh_missing_or_too_old_offers_instructions_and_paste_only() {
    for version in [None, Some("2.39.2")] {
        let mut harness = Harness::start(version, no_env(), Duration::from_mins(1)).await;
        let methods = harness
            .call("auth.methods", json!({"host": "github.com"}))
            .await;
        assert_eq!(method(&methods, "gh-login")["available"], false);
        assert!(
            method(&methods, "gh-login")["unavailableReason"]
                .as_str()
                .is_some()
        );
        assert_eq!(method(&methods, "install-gh")["kind"], "instructions");
        assert_eq!(method(&methods, "token")["available"], true);
        assert_eq!(
            method(&methods, "token")["links"][0]["url"],
            "https://github.com/settings/tokens/new?scopes=repo,read:org&description=CodeWide"
        );
    }
}

#[tokio::test]
async fn links_an_existing_gh_login_without_returning_its_token() {
    let mut harness = Harness::start(Some("2.40.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(harness.gh_state().join("logins"), "hubot\n").expect("logins");
    fs::write(harness.gh_state().join("tokens/hubot"), GH_TOKEN).expect("token");
    let methods = harness.call("auth.methods", json!({"host": null})).await;
    assert_eq!(
        method(&methods, "gh-existing")["existingLogins"],
        json!(["hubot"])
    );
    assert!(
        methods["result"]["methods"]
            .as_array()
            .expect("methods")
            .iter()
            .all(|method| method["methodId"] != "install-gh")
    );
    let linked = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-existing", "host": "github.com", "login": "hubot", "token": null}),
        )
        .await;
    assert_eq!(
        linked["result"],
        json!({"kind": "linked", "login": "hubot", "scopes": ["repo", "read:org", "gist"], "credentialSource": "ghCli"})
    );
    // Logging out of gh on the host makes the account fail verification.
    fs::remove_file(harness.gh_state().join("tokens/hubot")).expect("logout");
    let verify = harness
        .call(
            "auth.verify",
            json!({"host": "github.com", "login": "hubot", "purpose": "account"}),
        )
        .await;
    assert_eq!(verify["error"]["code"], -32_110);
    let traffic = harness.close().await;
    for frame in traffic {
        assert!(!frame.contains(GH_TOKEN), "token leaked: {frame}");
    }
}

#[tokio::test]
async fn host_login_reports_pending_then_complete_and_verifies_the_login() {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(
        harness.gh_state().join("login_output"),
        "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
    )
    .expect("output");
    fs::write(harness.gh_state().join("login_mode"), "complete").expect("mode");
    let started = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-login", "host": "github.com", "login": null, "token": null}),
        )
        .await;
    assert_eq!(
        started["result"],
        json!({"kind": "hostLogin", "userCode": "ABCD-1234", "verificationUri": "https://github.com/login/device", "expiresInSeconds": 60})
    );
    assert_eq!(
        harness.call("auth.poll", json!({})).await["result"],
        json!({"state": "pending"})
    );
    fs::write(harness.gh_state().join("login_go"), "").expect("go");
    let mut result = Value::Null;
    for _ in 0..100 {
        result = harness.call("auth.poll", json!({})).await["result"].clone();
        if result["state"] != "pending" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(result, json!({"state": "complete", "login": "hubot"}));
    assert!(
        harness
            .calls()
            .contains("auth login --hostname github.com --web")
    );
    let traffic = harness.close().await;
    assert!(traffic.iter().all(|frame| !frame.contains(GH_TOKEN)));
}

#[tokio::test]
async fn unparsable_host_login_output_fails_with_the_host_fallback() {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(
        harness.gh_state().join("login_output"),
        "? What is your preferred protocol for Git operations on this host?\n",
    )
    .expect("output");
    fs::write(harness.gh_state().join("login_mode"), "hang").expect("mode");
    let started = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-login", "host": "github.com", "login": null, "token": null}),
        )
        .await;
    assert_eq!(started["error"]["code"], -32_113);
    assert!(
        started["error"]["message"]
            .as_str()
            .expect("message")
            .contains("gh auth login")
    );
    // A foreign verification host is refused the same way.
    fs::write(
        harness.gh_state().join("login_output"),
        "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://evil.example/login/device\n",
    )
    .expect("output");
    let started = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-login", "host": "github.com", "login": null, "token": null}),
        )
        .await;
    assert_eq!(started["error"]["code"], -32_113);
}

#[tokio::test]
async fn host_login_expires_and_closing_the_process_cancels_it() {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_millis(300)).await;
    fs::write(
        harness.gh_state().join("login_output"),
        "! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
    )
    .expect("output");
    fs::write(harness.gh_state().join("login_mode"), "hang").expect("mode");
    let started = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-login", "host": "github.com", "login": null, "token": null}),
        )
        .await;
    assert_eq!(started["result"]["kind"], "hostLogin");
    tokio::time::sleep(Duration::from_millis(400)).await;
    let expired = harness.call("auth.poll", json!({})).await;
    assert_eq!(expired["result"]["state"], "failed");
    // Cancel: a second flow, then the companion closes stdin.
    let restarted = harness
        .call(
            "auth.start",
            json!({"methodId": "gh-login", "host": "github.com", "login": null, "token": null}),
        )
        .await;
    assert_eq!(restarted["result"]["kind"], "hostLogin");
    let calls_before = harness.calls();
    harness.close().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(calls_before.matches("auth login").count(), 2);
}

#[tokio::test]
async fn pasted_tokens_are_validated_and_only_valid_ones_saved_privately() {
    let mut harness = Harness::start(None, no_env(), Duration::from_mins(1)).await;
    let paste = |token: &str| json!({"methodId": "token", "host": "github.com", "login": null, "token": token});
    let invalid = harness
        .call("auth.start", paste("ghp_unknown_sentinel"))
        .await;
    assert_eq!(invalid["error"]["code"], -32_110);
    assert!(!invalid.to_string().contains("ghp_unknown_sentinel"));
    let narrow = harness.call("auth.start", paste(NARROW_TOKEN)).await;
    assert_eq!(narrow["error"]["code"], -32_110);
    assert!(
        narrow["error"]["message"]
            .as_str()
            .expect("message")
            .contains("repo, read:org")
    );
    assert!(
        !harness.secrets().exists() || fs::read_dir(harness.secrets()).expect("dir").count() == 0,
        "rejected tokens are never stored"
    );
    let classic = harness.call("auth.start", paste(PASTED_TOKEN)).await;
    assert_eq!(classic["result"]["login"], "paster");
    assert_eq!(classic["result"]["credentialSource"], "savedToken");
    let fine = harness.call("auth.start", paste(FINE_GRAINED_TOKEN)).await;
    assert_eq!(fine["result"]["login"], "finegrained");
    assert_eq!(fine["result"]["scopes"], Value::Null);
    let mode = |path: &Path| fs::metadata(path).expect("meta").permissions().mode() & 0o777;
    assert_eq!(mode(&harness.secrets()), 0o700);
    let files: Vec<_> = fs::read_dir(harness.secrets())
        .expect("dir")
        .map(|entry| entry.expect("entry").path())
        .collect();
    assert_eq!(files.len(), 2);
    assert!(files.iter().all(|file| mode(file) == 0o600));
    assert!(
        files
            .iter()
            .all(|file| !file.to_string_lossy().ends_with(".tmp"))
    );
    // A saved token is resolved for its account and removed by forgetToken.
    let verified = harness
        .call(
            "auth.verify",
            json!({"host": "github.com", "login": "paster", "purpose": "account"}),
        )
        .await;
    assert_eq!(verified["result"]["credentialSource"], "savedToken");
    harness
        .call(
            "auth.disconnect",
            json!({"host": "github.com", "login": "paster", "mode": "forgetToken"}),
        )
        .await;
    let after = harness
        .call(
            "auth.verify",
            json!({"host": "github.com", "login": "paster", "purpose": "account"}),
        )
        .await;
    assert_eq!(after["error"]["code"], -32_110);
    let traffic = harness.close().await;
    for frame in traffic
        .iter()
        .filter(|frame| !frame.contains("\"auth.start\""))
    {
        for token in ALL_TOKENS {
            assert!(!frame.contains(token), "token leaked: {frame}");
        }
    }
}

#[tokio::test]
async fn credential_precedence_is_saved_then_environment_then_gh() {
    let env = EnvTokens {
        gh_token: Some(Secret::new(ENV_TOKEN.into())),
        gh_enterprise_token: Some(Secret::new(ENTERPRISE_TOKEN.into())),
        enterprise_host: Some("ghe.example.com".into()),
    };
    let mut harness = Harness::start(Some("2.96.0"), env, Duration::from_mins(1)).await;
    // octocat is both the environment login and held by gh.
    fs::write(harness.gh_state().join("logins"), "octocat\n").expect("logins");
    fs::write(harness.gh_state().join("tokens/octocat"), GH_TOKEN).expect("token");
    let verify = |login: &str| json!({"host": "github.com", "login": login, "purpose": "account"});
    let environment = harness.call("auth.verify", verify("octocat")).await;
    assert_eq!(environment["result"]["credentialSource"], "environment");
    let spelled = harness
        .call(
            "auth.verify",
            json!({"host": "GitHub.com.", "login": "octocat", "purpose": "account"}),
        )
        .await;
    assert_eq!(
        spelled["result"]["credentialSource"], "environment",
        "GitHub.com. is github.com"
    );
    let ported = harness
        .call(
            "auth.verify",
            json!({"host": "github.com:8443", "login": "octocat", "purpose": "account"}),
        )
        .await;
    assert_eq!(ported["error"]["code"], -32_602, "github.com takes no port");
    // A saved token for the same login wins over the environment.
    let secrets = harness.secrets();
    forge_github::secrets::SecretStore::new(secrets.parent().expect("state"))
        .save("github.com", "octocat", &Secret::new(PASTED_TOKEN.into()))
        .expect("save");
    harness.api.lock().expect("state").tokens.insert(
        PASTED_TOKEN.into(),
        ("octocat".into(), Some("repo, read:org".into())),
    );
    let saved = harness.call("auth.verify", verify("octocat")).await;
    assert_eq!(saved["result"]["credentialSource"], "savedToken");
    // A login the environment token does not prove falls through to gh.
    fs::write(harness.gh_state().join("tokens/hubot"), GH_TOKEN).expect("token");
    let gh = harness.call("auth.verify", verify("hubot")).await;
    assert_eq!(gh["result"]["credentialSource"], "ghCli");
    let enterprise = harness
        .call(
            "auth.verify",
            json!({"host": "ghe.example.com", "login": "enterprise-user", "purpose": "account"}),
        )
        .await;
    assert_eq!(enterprise["result"]["credentialSource"], "environment");
    let elsewhere = harness
        .call(
            "auth.verify",
            json!({"host": "other.example", "login": "enterprise-user", "purpose": "account"}),
        )
        .await;
    assert_eq!(
        elsewhere["error"]["code"], -32_110,
        "GH_ENTERPRISE_TOKEN goes only to GH_HOST"
    );
    let seen = harness.api.lock().expect("state").seen.clone();
    assert!(
        seen.iter()
            .all(|(tag, token)| tag == "ghe.example.com" || token != ENTERPRISE_TOKEN),
        "GH_ENTERPRISE_TOKEN reached a host other than GH_HOST"
    );
    assert!(
        seen.iter()
            .all(|(tag, token)| !(tag == "github.com" && token == ENTERPRISE_TOKEN)),
        "GH_ENTERPRISE_TOKEN reached github.com"
    );
    assert!(
        seen.iter()
            .all(|(tag, token)| !(tag == "ghe.example.com" && token == ENV_TOKEN)),
        "GH_TOKEN reached an enterprise host"
    );
}

#[tokio::test]
async fn a_full_run_carries_no_token_in_any_frame_but_the_pasted_start() {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(harness.gh_state().join("logins"), "hubot\n").expect("logins");
    fs::write(harness.gh_state().join("tokens/hubot"), GH_TOKEN).expect("token");
    harness.call("auth.methods", json!({"host": null})).await;
    harness
        .call(
            "auth.start",
            json!({"methodId": "gh-existing", "host": "github.com", "login": "hubot", "token": null}),
        )
        .await;
    let listed = harness
        .call(
            "forge.pullRequests.list",
            json!({"account": account("hubot"), "category": "reviewRequested", "repository": null, "cursor": null, "limit": 50}),
        )
        .await;
    let row = &listed["result"]["rows"][0];
    assert_eq!(
        row["ref"],
        json!({"host": "github.com", "repository": "octo/repo", "number": "1"})
    );
    assert_eq!(row["reviewRequestedFromMe"], true);
    assert_eq!(row["activityRevision"], "2026-10-01T00:00:00Z");
    let pr = json!({"host": "github.com", "repository": "octo/repo", "number": "1"});
    let read = harness
        .call(
            "forge.pullRequest.read",
            json!({"account": account("hubot"), "ref": pr}),
        )
        .await;
    assert_eq!(read["result"]["headRevision"], "abc123");
    assert_eq!(read["result"]["activityRevision"], row["activityRevision"]);
    let stale = harness
        .call(
            "forge.pullRequest.review.submit",
            json!({"account": account("hubot"), "ref": pr, "headRevision": "old", "verdictActionId": "comment",
                   "body": "Looks good", "comments": [], "idempotencyKey": "k1"}),
        )
        .await;
    assert_eq!(stale["error"]["code"], -32_112);
    assert_eq!(stale["error"]["data"]["headRevision"], "abc123");
    assert_eq!(harness.api.lock().expect("state").submitted_reviews, 0);
    let submitted = harness
        .call(
            "forge.pullRequest.review.submit",
            json!({"account": account("hubot"), "ref": pr, "headRevision": "abc123", "verdictActionId": "comment",
                   "body": "Looks good", "comments": [{"draftId": "d1", "path": "a.rs", "side": "new", "startLine": 1, "endLine": 1, "body": "x"}],
                   "idempotencyKey": "k2"}),
        )
        .await;
    assert_eq!(submitted["result"]["comments"][0]["state"], "published");
    let paste = harness
        .call(
            "auth.start",
            json!({"methodId": "token", "host": "github.com", "login": null, "token": PASTED_TOKEN}),
        )
        .await;
    assert_eq!(paste["result"]["login"], "paster");
    harness
        .call(
            "auth.disconnect",
            json!({"host": "github.com", "login": "paster", "mode": "forgetToken"}),
        )
        .await;
    let unlink = harness
        .call(
            "auth.disconnect",
            json!({"host": "github.com", "login": "hubot", "mode": "unlink"}),
        )
        .await;
    assert_eq!(unlink["error"]["code"], -32_602);
    let calls = harness.calls();
    assert!(
        !calls.contains("auth logout"),
        "unlink never logs out of gh"
    );
    let traffic = harness.close().await;
    let pasted_start = traffic
        .iter()
        .filter(|frame| frame.contains(PASTED_TOKEN))
        .count();
    assert_eq!(
        pasted_start, 1,
        "only the inbound pasteToken request carries it"
    );
    for frame in &traffic {
        assert!(!frame.contains(GH_TOKEN), "gh token leaked: {frame}");
        if !frame.contains("\"auth.start\"") {
            assert!(
                !frame.contains(PASTED_TOKEN),
                "pasted token echoed: {frame}"
            );
        }
    }
}

#[tokio::test]
async fn involved_search_scopes_the_real_plugin_request_to_the_account() {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(harness.gh_state().join("logins"), "hubot\n").expect("logins");
    fs::write(harness.gh_state().join("tokens/hubot"), GH_TOKEN).expect("token");
    harness
        .call(
            "auth.start",
            json!({"methodId": "gh-existing", "host": "github.com", "login": "hubot", "token": null}),
        )
        .await;

    let listed = harness
        .call(
            "forge.pullRequests.search",
            json!({
                "account": account("hubot"),
                "query": {
                    "text": "", "category": "involved",
                    "repositories": {"include": [], "exclude": []},
                    "authors": {"include": [], "exclude": []},
                    "assignees": {"include": [], "exclude": []},
                    "reviewers": {"include": [], "exclude": []},
                    "review": {"include": [], "exclude": []},
                    "states": {"include": ["open"], "exclude": []},
                    "checks": {"include": [], "exclude": []},
                    "labels": {"include": [], "exclude": []},
                    "baseBranches": {"include": [], "exclude": []},
                    "headBranches": {"include": [], "exclude": []},
                    "sort": {"field": "updated", "direction": "descending"}
                },
                "cursor": null,
                "limit": 50
            }),
        )
        .await;

    assert_eq!(listed["result"]["rows"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        harness.api.lock().expect("state").search_queries,
        ["is:pr archived:false involves:\"hubot\" is:open draft:false sort:updated-desc"]
    );
}

async fn linked_hubot() -> Harness {
    let mut harness = Harness::start(Some("2.96.0"), no_env(), Duration::from_mins(1)).await;
    fs::write(harness.gh_state().join("logins"), "hubot\n").expect("logins");
    fs::write(harness.gh_state().join("tokens/hubot"), GH_TOKEN).expect("token");
    harness
        .call(
            "auth.start",
            json!({"methodId": "gh-existing", "host": "github.com", "login": "hubot", "token": null}),
        )
        .await;
    harness
}

fn pull_ref() -> Value {
    json!({"host": "github.com", "repository": "octo/repo", "number": "1"})
}

#[tokio::test]
async fn conversation_reads_and_comment_writes_reach_github() {
    let mut harness = linked_hubot().await;
    let page = harness
        .call(
            "forge.pullRequest.conversation",
            json!({"account": account("hubot"), "ref": pull_ref(), "cursor": null}),
        )
        .await;
    let entries = page["result"]["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2);
    // Newest first: the thread (2026-10-02) above the comment (2026-10-01).
    assert_eq!(entries[1]["kind"], "comment");
    assert_eq!(entries[1]["comment"]["author"]["kind"], "bot");
    assert_eq!(
        entries[0]["thread"],
        json!({
            "id": "PRRT_1",
            "anchor": {"kind": "line", "path": "src/a.rs", "line": 3, "startLine": null, "side": "new"},
            "outdated": false,
            "resolution": {"kind": "conversation", "resolved": false, "viewerCanToggle": true},
            "reviewId": "PRR_1",
            "iteration": null,
            "comments": [{"id": "PRRC_1", "author": {"login": "hubot", "kind": "user", "avatarUrl": null},
                          "createdAt": "2026-10-02T00:00:00Z", "updatedAt": null, "body": "Rename this",
                          "url": null, "reactions": []}],
            "viewerCanReply": true,
            "excerpt": {"lines": [
                {"kind": "context", "oldLine": 1, "newLine": 1, "text": "fn a() {}"},
                {"kind": "added", "newLine": 2, "text": "fn b() {}"},
                {"kind": "context", "oldLine": 2, "newLine": 3, "text": "fn c() {}"}
            ]}
        })
    );
    assert_eq!(page["result"]["nextCursor"], Value::Null);
    assert_eq!(page["result"]["openIssuesBlockMerge"], Value::Null);
    let activity = harness
        .call(
            "forge.pullRequest.activity",
            json!({"account": account("hubot"), "ref": pull_ref(), "cursor": null}),
        )
        .await;
    let items: Vec<&str> = activity["result"]["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert_eq!(items, ["PRRC_1", "IC_1"], "activity is newest first");
    assert_eq!(activity["result"]["items"][0]["reviewThreadId"], "PRRT_1");

    let created = harness
        .call(
            "forge.pullRequest.comment.create",
            json!({"account": account("hubot"), "ref": pull_ref(), "body": "Thanks!", "idempotencyKey": "k1"}),
        )
        .await;
    assert_eq!(created["result"]["comment"]["id"], "IC_new");
    assert_eq!(created["result"]["comment"]["updatedAt"], Value::Null);
    let replied = harness
        .call(
            "forge.pullRequest.reviewThread.reply",
            json!({"account": account("hubot"), "ref": pull_ref(), "threadId": "PRRT_1", "body": "Done", "idempotencyKey": "k2"}),
        )
        .await;
    assert_eq!(replied["result"]["comment"]["id"], "PRRC_new");
    let elsewhere = harness
        .call(
            "forge.pullRequest.reviewThread.reply",
            json!({"account": account("hubot"), "ref": pull_ref(), "threadId": "PRRT_other", "body": "Done", "idempotencyKey": "k3"}),
        )
        .await;
    assert_eq!(elsewhere["error"]["code"], -32_115);
    let empty = harness
        .call(
            "forge.pullRequest.comment.create",
            json!({"account": account("hubot"), "ref": pull_ref(), "body": "  ", "idempotencyKey": "k4"}),
        )
        .await;
    assert_eq!(empty["error"]["code"], -32_602);
    assert_eq!(
        harness.api.lock().expect("state").created_comments,
        ["Thanks!", "Done"]
    );

    for frame in harness.close().await {
        assert!(!frame.contains(GH_TOKEN), "token leaked: {frame}");
    }
}

#[tokio::test]
async fn conversations_resolve_through_github_only_when_the_state_changes() {
    let mut harness = linked_hubot().await;
    let resolve = |thread: &str, resolved: bool, key: &str| json!({"account": account("hubot"), "ref": pull_ref(), "threadId": thread, "resolved": resolved, "idempotencyKey": key});
    let resolved = harness
        .call(
            "forge.pullRequest.reviewThread.resolve",
            resolve("PRRT_1", true, "k5"),
        )
        .await;
    assert_eq!(
        resolved["result"],
        json!({"resolved": true, "viewerCanToggle": true})
    );
    let again = harness
        .call(
            "forge.pullRequest.reviewThread.resolve",
            resolve("PRRT_1", true, "k6"),
        )
        .await;
    assert_eq!(again["result"]["resolved"], true);
    let reopened = harness
        .call(
            "forge.pullRequest.reviewThread.resolve",
            resolve("PRRT_1", false, "k7"),
        )
        .await;
    assert_eq!(reopened["result"]["resolved"], false);
    let foreign = harness
        .call(
            "forge.pullRequest.reviewThread.resolve",
            resolve("PRRT_other", true, "k8"),
        )
        .await;
    assert_eq!(foreign["error"]["code"], -32_115);
    assert_eq!(
        harness.api.lock().expect("state").resolve_mutations,
        ["resolveReviewThread", "unresolveReviewThread"],
        "a thread already resolved and a foreign thread are not written"
    );
    for frame in harness.close().await {
        assert!(!frame.contains(GH_TOKEN), "token leaked: {frame}");
    }
}

#[tokio::test]
async fn media_reads_only_forge_hosts_and_never_follow_a_foreign_redirect() {
    let mut harness = linked_hubot().await;
    let (public, media, foreign) = {
        let state = harness.api.lock().expect("state");
        (
            state.web_base.clone(),
            state.media_base.clone(),
            state.foreign_base.clone(),
        )
    };
    let read = async |harness: &mut Harness, url: String| {
        harness
            .call(
                "forge.media.read",
                json!({"account": account("hubot"), "url": url}),
            )
            .await
    };
    let direct = read(
        &mut harness,
        format!("{public}/user-attachments/assets/direct"),
    )
    .await;
    assert_eq!(
        direct["result"]["bytesBase64"].as_str().map(str::len),
        Some(44)
    );
    let redirected = read(
        &mut harness,
        format!("{public}/user-attachments/assets/redirect"),
    )
    .await;
    assert_eq!(redirected["result"]["contentType"], "image/png");
    let anonymous = read(&mut harness, format!("{media}/img.png")).await;
    assert_eq!(anonymous["result"]["contentType"], "image/png");
    let foreign_url = read(&mut harness, format!("{foreign}/img.png")).await;
    assert_eq!(foreign_url["error"]["code"], -32_602);
    let foreign_redirect = read(
        &mut harness,
        format!("{public}/user-attachments/assets/foreign"),
    )
    .await;
    assert_eq!(foreign_redirect["error"]["code"], -32_602);
    let indirect = read(&mut harness, format!("{media}/away")).await;
    assert_eq!(indirect["error"]["code"], -32_602);
    let huge = read(&mut harness, format!("{media}/huge.png")).await;
    assert_eq!(huge["error"]["code"], -32_113);
    assert_eq!(huge["error"]["data"]["kind"], "tooLarge");
    {
        let state = harness.api.lock().expect("state");
        assert_eq!(state.foreign_hits, 0, "a foreign host is never requested");
        assert!(
            state.media_hits.iter().all(|(_, authorized)| !authorized),
            "image hosts never receive the token"
        );
        assert!(
            state
                .seen
                .iter()
                .any(|(tag, token)| tag == "github.com" && token == GH_TOKEN),
            "the web origin received the account token"
        );
    }
    for frame in harness.close().await {
        assert!(!frame.contains(GH_TOKEN), "token leaked: {frame}");
    }
}

#[tokio::test]
async fn file_content_reads_the_head_file_in_the_raw_media_type_within_its_bound() {
    let mut harness = linked_hubot().await;
    let read = async |harness: &mut Harness, head: &str, path: &str| {
        harness
            .call(
                "forge.pullRequest.fileContent",
                json!({"account": account("hubot"), "ref": pull_ref(), "headRevision": head, "path": path}),
            )
            .await
    };
    assert_eq!(
        read(&mut harness, HEAD_SHA, "src/a.rs").await["result"],
        json!({"state": "text", "content": HEAD_FILE})
    );
    assert_eq!(
        read(&mut harness, HEAD_SHA, "docs/read me.md").await["result"],
        json!({"state": "text", "content": "# Read me\n"})
    );
    assert_eq!(
        read(&mut harness, HEAD_SHA, "assets/logo.png").await["result"],
        json!({"state": "binary"})
    );
    let huge = read(&mut harness, HEAD_SHA, "data/huge.txt").await;
    assert_eq!(huge["result"]["state"], "tooLarge");
    assert!(
        huge["result"]["bytes"]
            .as_u64()
            .is_none_or(|bytes| bytes > 1024 * 1024)
    );
    for missing in ["src", "src/removed.rs"] {
        assert_eq!(
            read(&mut harness, HEAD_SHA, missing).await["result"],
            json!({"state": "missing"}),
            "{missing}"
        );
    }
    let requests = harness.api.lock().expect("state").content_requests.len();
    for (head, path) in [
        ("main", "src/a.rs"),
        (HEAD_SHA, "../secrets"),
        (HEAD_SHA, "src/../../x"),
    ] {
        assert_eq!(
            read(&mut harness, head, path).await["error"]["code"],
            -32_602,
            "{head} {path}"
        );
    }
    {
        let state = harness.api.lock().expect("state");
        assert_eq!(
            state.content_requests.len(),
            requests,
            "a refused read never reaches GitHub"
        );
        assert!(state.content_requests.iter().all(|(_, query, accept)| {
            query == &format!("ref={HEAD_SHA}") && accept == "application/vnd.github.raw+json"
        }));
        assert!(
            state
                .content_requests
                .iter()
                .any(|(path, _, _)| path == "docs/read%20me.md")
        );
    }
    for frame in harness.close().await {
        assert!(!frame.contains(GH_TOKEN), "token leaked: {frame}");
    }
}
