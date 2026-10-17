//! Usage prices through the real ingest, native catalog and WebSocket replay.

use super::*;
use agent_core::model::{ModelPriceEntry, ModelRates, ProviderCost, ProviderCostBasis, TokenUsage};

async fn event(
    socket: &mut ClientSocket,
    method: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    timeout(Duration::from_secs(3), async {
        loop {
            let value = receive_any(socket).await?;
            if value["type"] == "event" && value["payload"]["method"] == method {
                return Ok(value);
            }
        }
    })
    .await?
}

fn assert_usage(event: &Value, model: &str, tokens: i64) -> TestResult {
    let payload = &event["payload"];
    assert!(payload.get("codewideReplayPricing").is_none());
    let usage = &payload["codewideThreadPatch"]["operation"]["usage"];
    assert_eq!(usage["status"], "live");
    assert_eq!(usage["turn"]["tokens"]["inputTokens"], 1000);
    assert_eq!(usage["turn"]["tokens"]["outputTokens"], 100);
    assert_eq!(usage["thread"]["tokens"]["totalTokens"], tokens);
    let cost = &usage["turn"]["cost"];
    assert_eq!(cost["model"], model);
    // The neutral provider's rate card is $7 input and $35 output per million,
    // including when Codex prices the same model id at a different rate.
    let usd = cost["totalCostUsd"].as_f64().ok_or("live price missing")?;
    assert!((usd - 0.0105).abs() < 1e-12);
    Ok(())
}

#[tokio::test]
async fn provider_context_prices_live_events_and_reconnect_replay() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let models = ["claude-opus-5-5", "gpt-6.1-sol"];
    harness.fake.pricing.replace(models.map(|model| {
        (
            model.into(),
            ModelPriceEntry {
                pricing_version: "neutral-test-rates".into(),
                rates: ModelRates {
                    input: 7.0,
                    cached_input: 0.7,
                    cache_write_input: 8.75,
                    output: 35.0,
                },
                long_context: None,
            },
        )
    }));
    let thread_id = AppThreadId::parse(&harness.new_fake_thread().await?).ok_or("thread id")?;
    // Usage is a thread topic: the device mounts the thread's window first.
    // The sync answer orders the inline interest frame before the events.
    send_json(
        &mut harness.client,
        &json!({"type": "interest", "add": [thread_id.as_str()]}),
    )
    .await?;
    harness
        .rpc(
            "window",
            "companion/thread/sync",
            json!({"threadId": thread_id.as_str(), "afterTurnId": null, "limit": 36}),
        )
        .await?;
    let last = TokenUsage {
        input_tokens: 1000,
        cached_input_tokens: 0,
        cache_write_input_tokens: Some(0),
        output_tokens: 100,
        reasoning_output_tokens: 0,
        total_tokens: 1100,
    };
    let mut total = TokenUsage::default();
    for model in models {
        let turn_id = TurnId::parse(model).ok_or("turn id")?;
        harness
            .events
            .send(ProviderEvent::Event(Box::new(AgentEvent::TurnStarted {
                app_thread_id: thread_id.clone(),
                turn: AgentTurn {
                    provenance: None,
                    turn_id: turn_id.clone(),
                    status: TurnStatus::InProgress,
                    origin: TurnOrigin::User,
                    started_at: 1,
                    completed_at: None,
                    error: None,
                    items: Vec::new(),
                    usage: None,
                },
            })))
            .await?;
        let started = event(&mut harness.client, "turn/started").await?;
        total.input_tokens += last.input_tokens;
        total.output_tokens += last.output_tokens;
        total.total_tokens += last.total_tokens;
        harness
            .events
            .send(ProviderEvent::Event(Box::new(AgentEvent::UsageUpdated {
                app_thread_id: thread_id.clone(),
                turn_id,
                last,
                total,
                context_window: Some(200_000),
                cost: None,
                model: Some(model.into()),
            })))
            .await?;
        let live = event(&mut harness.client, "thread/tokenUsage/updated").await?;
        assert_usage(&live, model, total.total_tokens)?;

        harness.client.close(None).await?;
        let mut request = harness.url.as_str().into_client_request()?;
        request.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {TOKEN}"))?,
        );
        let (mut client, _) = connect_async(request).await?;
        send_json(
            &mut client,
            &json!({"type": "hello", "protocolVersion": 1,
            "cursor": started["cursor"], "interest": [thread_id.as_str()]}),
        )
        .await?;
        let replayed = event(&mut client, "thread/tokenUsage/updated").await?;
        assert_usage(&replayed, model, total.total_tokens)?;
        assert_eq!(replayed["cursor"], live["cursor"]);
        receive_type_where(&mut client, "caughtUp").await?;
        harness.client = client;
    }
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::UsageUpdated {
            app_thread_id: thread_id,
            turn_id: TurnId::from_static("gpt-6.1-sol"),
            last,
            total,
            context_window: Some(200_000),
            cost: Some(ProviderCost {
                basis: ProviderCostBasis::List,
                model: "gpt-6.1-sol".into(),
                turn_usd: 0.0042,
                thread_usd: Some(0.02),
            }),
            model: None,
        })))
        .await?;
    let reported = event(&mut harness.client, "thread/tokenUsage/updated").await?;
    let usage = &reported["payload"]["codewideThreadPatch"]["operation"]["usage"];
    assert_eq!(usage["turn"]["cost"]["basis"], "providerReported");
    assert_eq!(usage["turn"]["cost"]["totalCostUsd"], 0.0042);
    assert_eq!(usage["thread"]["cost"]["totalCostUsd"], 0.02);
    harness.stop();
    Ok(())
}
