#![cfg(unix)]

use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};

use axum::{Json, Router, body::Body, extract::State, response::Response, routing::post};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use codewide_companion::dictation::DictationService;
use futures_util::FutureExt;
use serde_json::{Value, json};
use tokio::{net::TcpListener, sync::Notify, task::JoinHandle, time::timeout};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const DEADLINE: Duration = Duration::from_secs(2);

#[derive(Default)]
struct UpstreamGate {
    entered: Notify,
    release: Notify,
    dropped: Notify,
}

struct PendingBody(Arc<UpstreamGate>);

impl Drop for PendingBody {
    fn drop(&mut self) {
        self.0.dropped.notify_one();
    }
}

async fn transcribe_body(State(gate): State<Arc<UpstreamGate>>) -> Response {
    let pending = PendingBody(gate);
    let body = futures_util::stream::once(async move {
        pending.0.entered.notify_one();
        pending.0.release.notified().await;
        Ok::<_, std::io::Error>("{\"text\":\"late transcript\"}")
    });
    Response::new(Body::from_stream(body))
}

async fn transcribe(State(gate): State<Arc<UpstreamGate>>) -> Json<Value> {
    gate.entered.notify_one();
    gate.release.notified().await;
    Json(json!({"text": "transcript"}))
}

struct Fixture {
    service: DictationService,
    gate: Arc<UpstreamGate>,
    server: JoinHandle<()>,
    root: tempfile::TempDir,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl Fixture {
    async fn open() -> TestResult<Self> {
        Self::open_path("/transcribe").await
    }

    async fn open_path(path: &str) -> TestResult<Self> {
        let root = tempfile::tempdir()?;
        let auth = root.path().join("auth.json");
        tokio::fs::write(
            &auth,
            serde_json::to_vec(&json!({"tokens": {
                "access_token": "test-access-token-that-is-at-least-32-characters",
                "account_id": "test-account"
            }}))?,
        )
        .await?;
        tokio::fs::set_permissions(&auth, std::fs::Permissions::from_mode(0o600)).await?;
        let gate = Arc::new(UpstreamGate::default());
        let app = Router::new()
            .route("/transcribe", post(transcribe))
            .route("/body", post(transcribe_body))
            .with_state(gate.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("http://{}{path}", listener.local_addr()?);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let service =
            DictationService::open_with_endpoint(auth, root.path().join("audio"), endpoint).await?;
        Ok(Self {
            service,
            gate,
            server,
            root,
        })
    }

    async fn recording(&self, owner: &str) -> TestResult<Value> {
        let session = timeout(
            DEADLINE,
            self.service
                .handle(owner, "companion/dictation/start", &json!({})),
        )
        .await??;
        self.service
            .handle(
                owner,
                "companion/dictation/append",
                &json!({
                    "sessionId": session["sessionId"],
                    "data": STANDARD.encode([1_u8, 0, 2, 0]),
                    "sampleRate": 24_000,
                    "numChannels": 1,
                    "samplesPerChannel": 2
                }),
            )
            .await?;
        Ok(session)
    }

    fn finish(
        &self,
        owner: &'static str,
        session: Value,
    ) -> JoinHandle<Result<Value, codewide_companion::dictation::DictationError>> {
        let service = self.service.clone();
        tokio::spawn(async move {
            service
                .handle(owner, "companion/dictation/finish", &session)
                .await
        })
    }
}

#[tokio::test]
async fn cancel_interrupts_pending_transcription_and_allows_immediate_replacement() -> TestResult {
    let fixture = Fixture::open().await?;
    let session = fixture.recording("owner").await?;
    let finish = fixture.finish("owner", session.clone());
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    let cancelled = timeout(
        DEADLINE,
        fixture
            .service
            .handle("owner", "companion/dictation/cancel", &session),
    )
    .await??;
    assert_eq!(cancelled, json!({"cancelled": true}));
    assert!(
        timeout(DEADLINE, finish).await??.is_err(),
        "finish must settle without an upstream response"
    );
    let id = session["sessionId"].as_str().ok_or("session id missing")?;
    assert!(!fixture.root.path().join("audio").join(id).exists());
    let replacement = fixture.recording("owner").await?;
    let replacement_finish = fixture.finish("owner", replacement);
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    fixture.gate.release.notify_waiters();
    assert_eq!(
        timeout(DEADLINE, replacement_finish).await???["text"],
        "transcript"
    );
    assert!(
        fixture
            .service
            .handle("owner", "companion/dictation/finish", &session)
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn starting_another_owner_does_not_wait_for_transcription() -> TestResult {
    let fixture = Fixture::open().await?;
    let session = fixture.recording("owner").await?;
    let finish = fixture.finish("owner", session.clone());
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    let foreign_cancel = timeout(
        DEADLINE,
        fixture
            .service
            .handle("other", "companion/dictation/cancel", &session),
    )
    .await??;
    assert_eq!(foreign_cancel, json!({"cancelled": false}));
    let other = fixture.recording("other").await?;
    let other_finish = fixture.finish("other", other);
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    fixture.gate.release.notify_waiters();
    assert_eq!(timeout(DEADLINE, finish).await???["text"], "transcript");
    assert_eq!(
        timeout(DEADLINE, other_finish).await???["text"],
        "transcript"
    );
    Ok(())
}

#[tokio::test]
async fn starting_replacement_aborts_previous_recording_without_waiting_for_upstream() -> TestResult
{
    let fixture = Fixture::open().await?;
    let session = fixture.recording("owner").await?;
    let finish = fixture.finish("owner", session);
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    let _replacement = fixture.recording("owner").await?;
    assert!(timeout(DEADLINE, finish).await??.is_err());
    Ok(())
}

#[tokio::test]
async fn cancelling_drops_the_upstream_response_body() -> TestResult {
    let fixture = Fixture::open_path("/body").await?;
    let session = fixture.recording("owner").await?;
    let finish = fixture.finish("owner", session.clone());
    timeout(DEADLINE, fixture.gate.entered.notified()).await?;
    assert!(fixture.gate.dropped.notified().now_or_never().is_none());
    timeout(
        DEADLINE,
        fixture
            .service
            .handle("owner", "companion/dictation/cancel", &session),
    )
    .await??;
    assert!(timeout(DEADLINE, finish).await??.is_err());
    // The upstream never completes its body. Its stream must be dropped because
    // Companion abandoned the HTTP request, not because we released the gate.
    timeout(DEADLINE, fixture.gate.dropped.notified()).await?;
    Ok(())
}
