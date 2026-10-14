//! Live scenarios of the Claude provider against the user's real `claude`.
//!
//! Each run of this example drives one scenario through `ClaudeProvider`
//! (thread, turns, approvals, client tools, interrupt, steer, permission
//! switch, user input, compaction, restart, sub-agent) and writes the
//! neutral events to `<CODEWIDE_LIVE_OUT>/<scenario>.events.ndjson`. The
//! turns are real model calls on the user's Claude login. Not part of any
//! automatic suite: run it through `scripts/claude-live/run`, which puts a
//! wire recorder in front of `claude`, isolates the environment and runs
//! every scenario in its own process.
//!
//! Environment: `CODEWIDE_LIVE_CONFIG` (the provider entry JSON),
//! `CODEWIDE_LIVE_OUT` (output directory), `CODEWIDE_LIVE_WORK` (scenario
//! working directories). Arguments: one scenario name, or `--list`.

use std::{
    io::Write as _,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError, Weak},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use codewide_companion::agent::{
    client_wire::gateway::mint_app_thread_id,
    model::{
        ClientToolSpec, ProviderId, RequestRespondParams, ThreadCreateParams, ThreadUpdateParams,
        ToolCallParams, ToolCallResult, ToolResultContent, TurnInterruptParams, TurnStartParams,
        TurnSteerParams,
    },
    provider::{AgentProvider, ClientToolHost, ProviderEvent, ProviderStatus},
    providers::claude::{ClaudeConfig, ClaudeProvider, config::ClaudeDefaults},
};
use serde_json::{Value, json};
use tokio::{sync::mpsc, time::timeout};

type ScenarioResult = Result<(), Box<dyn std::error::Error>>;

const TURN_TIMEOUT: Duration = Duration::from_mins(3);

fn variable(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}

fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_nanos())
}

/// The echo tool the companion would declare.
struct EchoTools {
    specs: Vec<ClientToolSpec>,
}

impl EchoTools {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            specs: vec![ClientToolSpec {
                name: "wire_echo".into(),
                description: "Echoes the given text back, prefixed with 'echo:'.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"]
                }),
            }],
        })
    }
}

#[async_trait]
impl ClientToolHost for EchoTools {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, _provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        let text = call.arguments["text"].as_str().unwrap_or("").to_owned();
        ToolCallResult {
            success: true,
            content: vec![ToolResultContent::Text {
                text: format!("echo:{text}"),
            }],
        }
    }
}

/// One scenario: a provider, its event log and a scenario working directory.
struct Run {
    name: String,
    provider: Arc<ClaudeProvider>,
    events: mpsc::UnboundedReceiver<Value>,
    log: Arc<Mutex<std::fs::File>>,
    work: PathBuf,
    model: String,
    opened: Vec<Value>,
    started: Instant,
    _tools: Option<Arc<EchoTools>>,
}

fn note(log: &Arc<Mutex<std::fs::File>>, entry: &Value) {
    let mut file = log.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = writeln!(file, "{entry}");
}

async fn spawn_provider(
    journal: &Path,
    tools: Option<&Arc<EchoTools>>,
    log: &Arc<Mutex<std::fs::File>>,
) -> Result<(Arc<ClaudeProvider>, mpsc::UnboundedReceiver<Value>), Box<dyn std::error::Error>> {
    let mut entry: Value = serde_json::from_str(&variable("CODEWIDE_LIVE_CONFIG")?)?;
    entry["journalDirectory"] = json!(journal);
    let provider = ClaudeProvider::spawn(&ClaudeConfig::parse(&entry, &ClaudeDefaults::default())?);
    if let Some(tools) = tools {
        let host: Arc<dyn ClientToolHost> = tools.clone();
        let weak: Weak<dyn ClientToolHost> = Arc::downgrade(&host);
        provider.install_client_tools(weak);
    }
    let mut status = provider.subscribe_status();
    timeout(Duration::from_mins(1), async {
        while *status.borrow() != ProviderStatus::Live {
            status.changed().await?;
        }
        Ok::<(), Box<dyn std::error::Error>>(())
    })
    .await??;
    let mut raw = provider.take_events();
    let (sender, receiver) = mpsc::unbounded_channel();
    let drain_log = log.clone();
    tokio::spawn(async move {
        let mut fences = 0_u64;
        while let Some(event) = raw.recv().await {
            match event {
                ProviderEvent::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap_or(Value::Null);
                    note(
                        &drain_log,
                        &json!({"kind": "event", "at": now_ns(), "event": value}),
                    );
                    if sender.send(value).is_err() {
                        return;
                    }
                }
                ProviderEvent::Fence(answer) => {
                    fences += 1;
                    let _ = answer.send(Ok(fences));
                }
            }
        }
    });
    Ok((provider, receiver))
}

impl Run {
    async fn start(name: &str, tools: bool) -> Result<Self, Box<dyn std::error::Error>> {
        Self::open(name, tools, true).await
    }

    /// Continues a scenario: keeps its work directory, journal and log.
    async fn resume(name: &str) -> Result<Self, Box<dyn std::error::Error>> {
        Self::open(name, false, false).await
    }

    async fn open(
        name: &str,
        tools: bool,
        fresh: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let out = PathBuf::from(variable("CODEWIDE_LIVE_OUT")?);
        std::fs::create_dir_all(&out)?;
        let work = PathBuf::from(variable("CODEWIDE_LIVE_WORK")?).join(name);
        let journal = out.join(format!("{name}.journal"));
        if fresh {
            let _ = std::fs::remove_dir_all(&work);
            let _ = std::fs::remove_dir_all(&journal);
        }
        std::fs::create_dir_all(&work)?;
        let log = Arc::new(Mutex::new(
            std::fs::OpenOptions::new()
                .create(true)
                .append(!fresh)
                .write(true)
                .truncate(fresh)
                .open(out.join(format!("{name}.events.ndjson")))?,
        ));
        note(
            &log,
            &json!({"kind": "scenario.start", "at": now_ns(), "work": work}),
        );
        let tools = tools.then(EchoTools::new);
        let (provider, events) = spawn_provider(&journal, tools.as_ref(), &log).await?;
        let catalog = provider.catalog_models().await?;
        let catalog = serde_json::to_value(&catalog)?;
        note(
            &log,
            &json!({"kind": "catalog", "at": now_ns(), "catalog": catalog}),
        );
        let model = catalog["models"]
            .as_array()
            .and_then(|models| {
                models.iter().find(|entry| {
                    entry["id"]
                        .as_str()
                        .is_some_and(|id| id.to_lowercase().contains("haiku"))
                })
            })
            .and_then(|entry| entry["id"].as_str())
            .ok_or("no haiku model in the catalog")?
            .to_owned();
        Ok(Self {
            name: name.to_owned(),
            provider,
            events,
            log,
            work,
            model,
            opened: Vec::new(),
            started: Instant::now(),
            _tools: tools,
        })
    }

    fn mark(&self, label: &str, detail: &Value) {
        note(
            &self.log,
            &json!({"kind": "step", "at": now_ns(), "label": label, "detail": detail}),
        );
    }

    async fn thread(&self, profile: &str) -> Result<String, Box<dyn std::error::Error>> {
        let params: ThreadCreateParams = serde_json::from_value(json!({
            "appThreadId": mint_app_thread_id(),
            "cwd": self.work,
            "settings": {"model": self.model, "effort": null, "permissionProfile": profile, "serviceTier": null},
        }))?;
        let thread = self.provider.thread_create(params).await?;
        let thread = serde_json::to_value(&thread)?;
        self.mark("thread.created", &thread);
        Ok(thread["appThreadId"]
            .as_str()
            .ok_or("no thread id")?
            .to_owned())
    }

    async fn turn(&self, thread: &str, text: &str) -> Result<String, Box<dyn std::error::Error>> {
        let params: TurnStartParams = serde_json::from_value(json!({
            "appThreadId": thread,
            "clientMessageId": null,
            "input": [{"type": "text", "text": text}],
        }))?;
        let result = serde_json::to_value(self.provider.turn_start(params).await?)?;
        self.mark("turn.start", &result);
        Ok(result["turnId"]
            .as_str()
            .ok_or_else(|| format!("turn not started: {result}"))?
            .to_owned())
    }

    async fn steer(
        &self,
        thread: &str,
        turn: &str,
        text: &str,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        let params: TurnSteerParams = serde_json::from_value(json!({
            "appThreadId": thread,
            "expectedTurnId": turn,
            "clientMessageId": null,
            "input": [{"type": "text", "text": text}],
        }))?;
        let result = serde_json::to_value(self.provider.turn_steer(params).await?)?;
        self.mark("turn.steer", &result);
        Ok(result)
    }

    async fn interrupt(&self, thread: &str, turn: &str) -> ScenarioResult {
        let params: TurnInterruptParams =
            serde_json::from_value(json!({"appThreadId": thread, "turnId": turn}))?;
        self.provider.turn_interrupt(params).await?;
        self.mark("turn.interrupt", &json!({}));
        Ok(())
    }

    async fn update(&self, thread: &str, change: Value) -> ScenarioResult {
        let params: ThreadUpdateParams =
            serde_json::from_value(json!({"appThreadId": thread, "change": change}))?;
        let result = serde_json::to_value(self.provider.thread_update(params).await?)?;
        self.mark("thread.update", &result);
        Ok(())
    }

    async fn respond(&self, thread: &str, request: &Value, response: Value) -> ScenarioResult {
        let params: RequestRespondParams = serde_json::from_value(json!({
            "appThreadId": thread,
            "requestId": request["requestId"],
            "response": response,
        }))?;
        self.provider.request_respond(params).await?;
        self.mark("request.respond", &response);
        Ok(())
    }

    /// The next event matching `predicate`; every request on the way is
    /// answered by `answer`.
    async fn until(
        &mut self,
        thread: &str,
        predicate: impl Fn(&Value) -> bool,
        answer: &dyn Fn(&Value) -> Option<Value>,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        let deadline = Instant::now() + TURN_TIMEOUT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let event = timeout(left, self.events.recv())
                .await
                .map_err(|_| format!("{}: timed out waiting", self.name))?
                .ok_or("event stream ended")?;
            if event["type"] == "request.opened" {
                self.opened.push(event["request"].clone());
                if let Some(response) = answer(&event) {
                    self.respond(thread, &event, response).await?;
                }
            }
            if predicate(&event) {
                return Ok(event);
            }
        }
    }

    async fn completed(
        &mut self,
        thread: &str,
        answer: &dyn Fn(&Value) -> Option<Value>,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        let event = self
            .until(thread, |event| event["type"] == "turn.completed", answer)
            .await?;
        self.mark("turn.completed", &event["turn"]["status"]);
        Ok(event["turn"].clone())
    }

    async fn read(&self, thread: &str) -> ScenarioResult {
        let read = self
            .provider
            .thread_read(&serde_json::from_value(json!(thread))?)
            .await?;
        self.mark("thread.read", &serde_json::to_value(&read)?);
        Ok(())
    }

    /// Ends the scenario as the companion stops: the provider closes its
    /// sessions and waits for their processes.
    async fn finish(self) {
        self.provider.shutdown().await;
        note(
            &self.log,
            &json!({"kind": "scenario.end", "at": now_ns(), "elapsedMs": self.started.elapsed().as_millis()}),
        );
    }
}

fn no_requests(_: &Value) -> Option<Value> {
    None
}

fn approve(decision: &'static str) -> impl Fn(&Value) -> Option<Value> {
    move |event: &Value| {
        (event["request"]["type"] == "approval")
            .then(|| json!({"type": "approval", "decision": decision}))
    }
}

fn final_text(turn: &Value) -> String {
    turn["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item["type"] == "agentMessage")
                .filter_map(|item| item["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn assert_status(turn: &Value, status: &str) {
    assert_eq!(turn["status"], status, "{turn}");
}

async fn s01_simple_and_multi_turn() -> ScenarioResult {
    let mut run = Run::start("s01_simple_and_multi_turn", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Reply with exactly the word PONG and nothing else.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("PONG"), "{turn}");
    run.turn(
        &thread,
        "Now reply with exactly the word PING and nothing else.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("PING"), "{turn}");
    run.read(&thread).await?;
    run.finish().await;
    Ok(())
}

async fn s02_approval_accept() -> ScenarioResult {
    let mut run = Run::start("s02_approval_accept", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Use the Bash tool to run exactly this command: python3 -c \"open('wire-accept.txt','w').write('ok')\" . Then reply DONE.",
    )
    .await?;
    let turn = run.completed(&thread, &approve("accept")).await?;
    assert_status(&turn, "completed");
    assert!(!run.opened.is_empty(), "no approval was requested");
    assert!(run.work.join("wire-accept.txt").is_file(), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s03_approval_decline() -> ScenarioResult {
    let mut run = Run::start("s03_approval_decline", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Use the Bash tool to run exactly this command: python3 -c \"open('wire-decline.txt','w').write('no')\" . If it is refused, do not retry and do not try anything else; reply REFUSED.",
    )
    .await?;
    let turn = run.completed(&thread, &approve("decline")).await?;
    assert_status(&turn, "completed");
    assert!(!run.opened.is_empty(), "no approval was requested");
    assert!(!run.work.join("wire-decline.txt").exists(), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s04_client_tool() -> ScenarioResult {
    let mut run = Run::start("s04_client_tool", true).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Call the wire_echo tool with text 'hello', then reply with the tool's output verbatim.",
    )
    .await?;
    let turn = run
        .completed(&thread, &|event| {
            (event["request"]["type"] == "approval")
                .then(|| json!({"type": "approval", "decision": "accept"}))
        })
        .await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("echo:hello"), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s05_interrupt_mid_tool() -> ScenarioResult {
    let mut run = Run::start("s05_interrupt_mid_tool", false).await?;
    let thread = run.thread(":full-access").await?;
    let turn_id = run
        .turn(
            &thread,
            "Use the Bash tool (in the foreground, not in the background) to run exactly this command: python3 -c \"import time; time.sleep(60)\"",
        )
        .await?;
    run.until(
        &thread,
        |event| event["type"] == "item.started" && event["item"]["type"] == "command",
        &no_requests,
    )
    .await?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let asked = Instant::now();
    run.interrupt(&thread, &turn_id).await?;
    let turn = run.completed(&thread, &no_requests).await?;
    run.mark("interrupt.latencyMs", &json!(asked.elapsed().as_millis()));
    assert_status(&turn, "interrupted");
    assert!(asked.elapsed() < Duration::from_secs(20));
    run.turn(
        &thread,
        "Reply with exactly the word AFTER and nothing else.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    run.finish().await;
    Ok(())
}

async fn s06_steer() -> ScenarioResult {
    let mut run = Run::start("s06_steer", false).await?;
    let thread = run.thread(":full-access").await?;
    let turn_id = run
        .turn(
            &thread,
            "Use the Bash tool (in the foreground, not in the background) to run exactly this command: python3 -c \"import time; time.sleep(10)\" . After it finishes, reply DONE.",
        )
        .await?;
    run.until(
        &thread,
        |event| event["type"] == "item.started" && event["item"]["type"] == "command",
        &no_requests,
    )
    .await?;
    run.steer(
        &thread,
        &turn_id,
        "Additional instruction: your final reply must also contain the word BANANA.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    let mut text = final_text(&turn);
    // A steer may land as a follow-up turn instead of the active one.
    if !text.contains("BANANA")
        && let Ok(next) = timeout(
            Duration::from_secs(90),
            run.completed(&thread, &no_requests),
        )
        .await
    {
        text.push_str(&final_text(&next?));
    }
    assert!(text.contains("BANANA"), "{text}");
    run.finish().await;
    Ok(())
}

async fn s07_permission_switch() -> ScenarioResult {
    let mut run = Run::start("s07_permission_switch", false).await?;
    let thread = run.thread(":read-only").await?;
    run.turn(&thread, "Reply with exactly the word OK and nothing else.")
        .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    run.update(
        &thread,
        json!({"type": "settings", "model": null, "effort": null, "permissionProfile": ":full-access", "serviceTier": null}),
    )
    .await?;
    run.turn(
        &thread,
        "Use the Bash tool to run exactly this command: mkdir wire-switch-dir . Then reply DONE.",
    )
    .await?;
    let turn = run.completed(&thread, &approve("decline")).await?;
    assert_status(&turn, "completed");
    assert!(run.work.join("wire-switch-dir").is_dir(), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s08_user_input() -> ScenarioResult {
    let mut run = Run::start("s08_user_input", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Use the AskUserQuestion tool to ask me which color I prefer, with exactly two options: Red and Blue. Then reply with only the color I chose.",
    )
    .await?;
    let turn = run
        .completed(&thread, &|event| match event["request"]["type"].as_str() {
            Some("userInput") => {
                let mut answers = serde_json::Map::new();
                for question in event["request"]["questions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                {
                    if let Some(id) = question["id"].as_str() {
                        answers.insert(id.to_owned(), json!({"answers": ["Blue"]}));
                    }
                }
                Some(json!({"type": "userInput", "answers": answers}))
            }
            Some("approval") => Some(json!({"type": "approval", "decision": "accept"})),
            _ => None,
        })
        .await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("Blue"), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s09_compact() -> ScenarioResult {
    let mut run = Run::start("s09_compact", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Remember the codeword ZEBRA. Reply with exactly OK.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    run.provider
        .thread_compact(&serde_json::from_value(json!(thread))?)
        .await?;
    run.mark("thread.compact", &json!({}));
    let turn = run.completed(&thread, &no_requests).await?;
    run.mark("compact.turn", &turn);
    run.turn(
        &thread,
        "What was the codeword? Reply with only the codeword.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("ZEBRA"), "{turn}");
    run.finish().await;
    Ok(())
}

/// The first half of a restart: run as its own test process, so the
/// process exit ends the provider and its children.
async fn s10a_restart_before() -> ScenarioResult {
    let mut run = Run::start("s10_restart", false).await?;
    let thread = run.thread(":workspace").await?;
    run.turn(
        &thread,
        "Remember the codeword OTTER. Reply with exactly OK.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    std::fs::write(
        PathBuf::from(variable("CODEWIDE_LIVE_OUT")?).join("s10_restart.thread"),
        &thread,
    )?;
    run.finish().await;
    Ok(())
}

/// The second half: a new provider on the same journal resumes the thread.
async fn s10b_restart_after() -> ScenarioResult {
    let thread = std::fs::read_to_string(
        PathBuf::from(variable("CODEWIDE_LIVE_OUT")?).join("s10_restart.thread"),
    )?;
    let mut run = Run::resume("s10_restart").await?;
    run.read(&thread).await?;
    run.turn(
        &thread,
        "What was the codeword? Reply with only the codeword.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    assert!(final_text(&turn).contains("OTTER"), "{turn}");
    run.finish().await;
    Ok(())
}

async fn s11_subagent() -> ScenarioResult {
    let mut run = Run::start("s11_subagent", false).await?;
    let thread = run.thread(":full-access").await?;
    run.turn(
        &thread,
        "Use the Task tool to launch a general-purpose subagent whose prompt is: 'Reply with exactly the word PONG.' Then reply with what the subagent said.",
    )
    .await?;
    let turn = run.completed(&thread, &no_requests).await?;
    assert_status(&turn, "completed");
    let mut text = final_text(&turn);
    // A background sub-agent reports in a later wake turn.
    while !text.contains("PONG") {
        let next = timeout(Duration::from_mins(2), run.completed(&thread, &no_requests)).await??;
        text.push_str(&final_text(&next));
    }
    run.finish().await;
    Ok(())
}

type Scenario = fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = ScenarioResult>>>;

/// Every scenario, in run order. `s10b` continues `s10a` in a new process.
const SCENARIOS: &[(&str, Scenario)] = &[
    ("s01_simple_and_multi_turn", || {
        Box::pin(s01_simple_and_multi_turn())
    }),
    ("s02_approval_accept", || Box::pin(s02_approval_accept())),
    ("s03_approval_decline", || Box::pin(s03_approval_decline())),
    ("s04_client_tool", || Box::pin(s04_client_tool())),
    ("s05_interrupt_mid_tool", || {
        Box::pin(s05_interrupt_mid_tool())
    }),
    ("s06_steer", || Box::pin(s06_steer())),
    (
        "s07_permission_switch",
        || Box::pin(s07_permission_switch()),
    ),
    ("s08_user_input", || Box::pin(s08_user_input())),
    ("s09_compact", || Box::pin(s09_compact())),
    ("s10a_restart_before", || Box::pin(s10a_restart_before())),
    ("s10b_restart_after", || Box::pin(s10b_restart_after())),
    ("s11_subagent", || Box::pin(s11_subagent())),
];

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let name = std::env::args().nth(1).unwrap_or_default();
    if name == "--list" {
        for (scenario, _) in SCENARIOS {
            println!("{scenario}");
        }
        return std::process::ExitCode::SUCCESS;
    }
    let Some((_, run)) = SCENARIOS.iter().find(|(scenario, _)| *scenario == name) else {
        eprintln!("unknown scenario {name:?}; --list prints them");
        return std::process::ExitCode::from(2);
    };
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{name}: {err}");
            std::process::ExitCode::FAILURE
        }
    }
}
