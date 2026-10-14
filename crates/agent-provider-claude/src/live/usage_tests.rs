//! Token and cost accounting contracts, ported from the host's
//! `usage.test.ts`: a turn reports the growth of every model the session used
//! (cumulative `modelUsage` differenced against the session's earlier
//! totals), costs count only while their price table is known, and the live
//! meter reports each complete top-level request once.

use agent_core::model::{ProviderCost, ProviderCostBasis, TokenUsage};
use serde_json::{Value, json};

use super::{
    LiveRequest, LiveUsageMeter, MAX_CHECKPOINTS, NEW_SESSION_BASELINE, ResultFigures, ThreadCost,
    TurnCost, UsageBaseline, UsageDelta, ZERO_USAGE, add_delta, initial_thread_cost, meter_result,
    model_context_window, provider_cost, thread_cost_after,
};
use crate::transcript::frames::{ClaudeFrame, ResultFrame, classify_frame};

/// Neutral counters from the CLI's split figures.
fn tokens(input: i64, cached: i64, cache_write: i64, output: i64, reasoning: i64) -> TokenUsage {
    TokenUsage {
        input_tokens: input + cached + cache_write,
        cached_input_tokens: cached,
        cache_write_input_tokens: Some(cache_write),
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: input + cached + cache_write + output,
    }
}

/// A result frame whose `modelUsage` carries the given cumulative totals.
fn result_with(totals: &[(&str, Value)]) -> ResultFrame {
    let model_usage: serde_json::Map<String, Value> = totals
        .iter()
        .map(|(model, counters)| {
            let mut entry = json!({
                "cacheCreationInputTokens": 0,
                "cacheReadInputTokens": 0,
                "contextWindow": 200_000,
                "costUSD": 0,
                "inputTokens": 0,
                "maxOutputTokens": 32_000,
                "outputTokens": 0,
                "webSearchRequests": 0,
            });
            if let (Some(entry), Some(counters)) = (entry.as_object_mut(), counters.as_object()) {
                entry.extend(counters.clone());
            }
            ((*model).to_owned(), entry)
        })
        .collect();
    let frame = classify_frame(&json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "num_turns": 1,
        "usage": {
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "input_tokens": 7,
            "output_tokens": 3,
        },
        "modelUsage": model_usage,
    }));
    let ClaudeFrame::Result(result) = frame else {
        panic!("not a result frame: {frame:?}");
    };
    result
}

/// Meters one result; panics when it measured nothing.
fn measure(baseline: &mut UsageBaseline, result: &ResultFrame) -> UsageDelta {
    let Some(delta) = meter_result(baseline, ResultFigures::of(result)) else {
        panic!("the result measured nothing");
    };
    delta
}

/// Meters a sequence of single-model `sonnet` results from a new session and
/// returns each result's total tokens.
fn turn_tokens(results: &[(f64, i64, i64)]) -> Vec<i64> {
    let mut baseline = NEW_SESSION_BASELINE;
    results
        .iter()
        .map(|(cost, input, output)| {
            let result = result_with(&[(
                "sonnet",
                json!({"costUSD": cost, "inputTokens": input, "outputTokens": output}),
            )]);
            measure(&mut baseline, &result).usage.total_tokens
        })
        .collect()
}

fn priced(basis: ProviderCostBasis, models: &[&str], usd: f64) -> TurnCost {
    TurnCost::Priced {
        basis,
        models: models.iter().map(|model| (*model).to_owned()).collect(),
        usd,
    }
}

#[test]
fn a_turn_reports_every_model_it_used_and_a_mixed_cost() {
    let mut baseline = NEW_SESSION_BASELINE;
    let delta = measure(
        &mut baseline,
        &result_with(&[
            (
                "claude-haiku-4-5",
                json!({"costUSD": 0.002, "inputTokens": 90_000, "outputTokens": 500}),
            ),
            (
                "claude-sonnet-4-6",
                json!({
                    "cacheCreationInputTokens": 80,
                    "cacheReadInputTokens": 2_200,
                    "canonicalModel": "claude-sonnet-4-6",
                    "costBasis": "managed",
                    "costUSD": 0.01,
                    "inputTokens": 110,
                    "outputTokens": 60,
                    "thinkingTokens": 15,
                }),
            ),
        ]),
    );
    assert_eq!(delta.usage, tokens(90_110, 2_200, 80, 560, 15));
    assert_eq!(delta.context_window, Some(200_000));
    let thread = thread_cost_after(ThreadCost::Known { usd: 0.0 }, &delta.cost);
    assert_eq!(
        provider_cost(&delta.cost, thread),
        Some(ProviderCost {
            basis: ProviderCostBasis::Managed,
            model: "mixed".into(),
            turn_usd: 0.012,
            thread_usd: Some(0.012),
        })
    );
}

#[test]
fn results_inside_a_turn_add_up_and_later_turns_measure_from_them() {
    let mut baseline = NEW_SESSION_BASELINE;
    let mut turn = None;
    for (cost, input, output) in [(0.001, 100, 10), (0.003, 300, 30), (0.004, 400, 40)] {
        let result = result_with(&[(
            "sonnet",
            json!({"costUSD": cost, "inputTokens": input, "outputTokens": output}),
        )]);
        turn = Some(add_delta(turn, measure(&mut baseline, &result)));
    }
    let Some(first) = turn else {
        panic!("no usage measured");
    };
    assert_eq!(first.usage, tokens(400, 0, 0, 40, 0));
    let thread = thread_cost_after(ThreadCost::Known { usd: 0.0 }, &first.cost);
    assert_eq!(thread, ThreadCost::Known { usd: 0.004 });

    let second = measure(
        &mut baseline,
        &result_with(&[(
            "sonnet",
            json!({"costUSD": 0.005, "inputTokens": 450, "outputTokens": 50}),
        )]),
    );
    assert_eq!(second.usage.total_tokens, 60);
    let thread = thread_cost_after(thread, &second.cost);
    assert_eq!(
        provider_cost(&second.cost, thread).map(|cost| (cost.turn_usd, cost.thread_usd)),
        Some((0.001, Some(0.005)))
    );
}

#[test]
fn a_resumed_session_continues_restored_totals_and_a_fresh_or_cleared_one_restarts() {
    // Restored totals continue; restored none and `/clear` restart from zero.
    assert_eq!(
        turn_tokens(&[
            (0.01, 1_000, 100),
            (0.012, 1_200, 120),
            (0.003, 300, 30),
            (0.001, 50, 5),
        ]),
        vec![1_100, 220, 330, 55]
    );
    let mut baseline = NEW_SESSION_BASELINE;
    let mut thread = ThreadCost::Known { usd: 0.0 };
    for (cost, input) in [(0.01, 1_000), (0.012, 1_200), (0.003, 300), (0.001, 50)] {
        let result = result_with(&[("sonnet", json!({"costUSD": cost, "inputTokens": input}))]);
        thread = thread_cost_after(thread, &measure(&mut baseline, &result).cost);
    }
    assert_eq!(thread, ThreadCost::Known { usd: 0.016 });
}

#[test]
fn a_restored_older_running_total_is_measured_from_the_checkpoint_it_continues() {
    let mut baseline = NEW_SESSION_BASELINE;
    measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"costUSD": 0.1, "inputTokens": 1_000}))]),
    );
    // Another run whose totals do not include the first.
    let other = measure(
        &mut baseline,
        &result_with(&[
            ("sonnet", json!({"costUSD": 0.3, "inputTokens": 13})),
            ("haiku", json!({"costUSD": 0.04, "inputTokens": 10})),
        ]),
    );
    // A run that restored the first run's saved totals and continued it.
    let restored = measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"costUSD": 0.12, "inputTokens": 1_020}))]),
    );
    assert_eq!(other.usage.input_tokens, 23);
    assert_eq!(restored.usage.input_tokens, 20);
    assert_eq!(
        restored.cost,
        priced(ProviderCostBasis::List, &["sonnet"], 0.02)
    );
}

#[test]
fn a_session_without_a_baseline_counts_only_its_main_loop_usage_unpriced() {
    let mut baseline = UsageBaseline::Unknown;
    let first = measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"costUSD": 9, "inputTokens": 50_000}))]),
    );
    assert_eq!(first.usage, tokens(7, 0, 0, 3, 0));
    assert_eq!(first.cost, TurnCost::Unpriced);
    assert_eq!(provider_cost(&first.cost, ThreadCost::Unknown), None);
    let next = measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"costUSD": 9.5, "inputTokens": 50_100}))]),
    );
    assert_eq!(next.usage.input_tokens, 100);
}

#[test]
fn zeroed_results_measure_nothing_and_keep_the_earlier_totals() {
    let mut baseline = NEW_SESSION_BASELINE;
    measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"inputTokens": 100, "outputTokens": 10}))]),
    );
    let kept = baseline.clone();
    for crashed in [result_with(&[]), result_with(&[("sonnet", json!({}))])] {
        assert_eq!(
            meter_result(&mut baseline, ResultFigures::of(&crashed)),
            None
        );
        assert_eq!(baseline, kept);
    }
    let next = measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"inputTokens": 130, "outputTokens": 15}))]),
    );
    assert_eq!(next.usage.total_tokens, 35);
}

#[test]
fn a_model_priced_from_an_unknown_table_makes_the_turn_and_thread_cost_unknown() {
    let mut baseline = NEW_SESSION_BASELINE;
    let mut thread = ThreadCost::Known { usd: 0.0 };
    let mut reported = Vec::new();
    for sonnet in [(0.01, 100), (0.01, 100), (0.02, 200)] {
        let mut totals = vec![(
            "sonnet",
            json!({"costUSD": sonnet.0, "inputTokens": sonnet.1}),
        )];
        if !reported.is_empty() {
            totals.push((
                "custom",
                json!({"costBasis": "unknown", "costUSD": 0.5, "inputTokens": 10}),
            ));
        }
        let delta = measure(&mut baseline, &result_with(&totals));
        thread = thread_cost_after(thread, &delta.cost);
        reported.push(provider_cost(&delta.cost, thread));
    }
    assert_eq!(
        reported,
        vec![
            Some(ProviderCost {
                basis: ProviderCostBasis::List,
                model: "sonnet".into(),
                turn_usd: 0.01,
                thread_usd: Some(0.01),
            }),
            None,
            // The unpriced model did not grow, so this turn's cost is known.
            Some(ProviderCost {
                basis: ProviderCostBasis::List,
                model: "sonnet".into(),
                turn_usd: 0.01,
                thread_usd: None,
            }),
        ]
    );
}

#[test]
fn a_baseline_keeps_only_the_newest_checkpoints() {
    let mut baseline = NEW_SESSION_BASELINE;
    for input in 1..=10 {
        measure(
            &mut baseline,
            &result_with(&[("sonnet", json!({"inputTokens": input}))]),
        );
    }
    let UsageBaseline::Known { checkpoints } = &baseline else {
        panic!("the baseline is unknown");
    };
    let newest: Vec<i64> = checkpoints
        .iter()
        .flat_map(|snapshot| snapshot.iter().map(|entry| entry.input_tokens))
        .collect();
    assert_eq!(newest.len(), MAX_CHECKPOINTS);
    assert_eq!(newest.first(), Some(&10));
    assert_eq!(newest.last(), Some(&3));
}

#[test]
fn the_baseline_and_thread_cost_round_trip_through_the_state_file_shape() -> serde_json::Result<()>
{
    let mut baseline = NEW_SESSION_BASELINE;
    measure(
        &mut baseline,
        &result_with(&[("sonnet", json!({"costUSD": 0.5, "inputTokens": 10}))]),
    );
    let persisted = json!({
        "type": "known",
        "checkpoints": [[{
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "costUsd": 0.5,
            "inputTokens": 10,
            "model": "sonnet",
            "outputTokens": 0,
            "thinkingTokens": 0,
        }]],
    });
    assert_eq!(serde_json::to_value(&baseline)?, persisted);
    assert_eq!(
        serde_json::from_value::<UsageBaseline>(persisted)?,
        baseline
    );
    assert_eq!(
        serde_json::from_value::<UsageBaseline>(json!({"type": "unknown"}))?,
        UsageBaseline::Unknown
    );
    assert_eq!(
        serde_json::from_value::<ThreadCost>(json!({"type": "known", "usd": 0.25}))?,
        ThreadCost::Known { usd: 0.25 }
    );
    assert_eq!(
        serde_json::to_value(ThreadCost::Unknown)?,
        json!({"type": "unknown"})
    );
    Ok(())
}

#[test]
fn a_thread_from_before_cost_tracking_knows_its_cost_only_when_unused() {
    assert_eq!(
        initial_thread_cost(&ZERO_USAGE),
        ThreadCost::Known { usd: 0.0 }
    );
    assert_eq!(
        initial_thread_cost(&tokens(1, 0, 0, 0, 0)),
        ThreadCost::Unknown
    );
}

fn assistant(message_id: &str, model: &str, figures: (i64, i64, i64, i64)) -> ClaudeFrame {
    let (cache_creation, cache_read, input, output) = figures;
    classify_frame(&json!({
        "type": "assistant",
        "message": {
            "content": [{"text": format!("reply {message_id}"), "type": "text"}],
            "id": message_id,
            "model": model,
            "usage": {
                "cache_creation_input_tokens": cache_creation,
                "cache_read_input_tokens": cache_read,
                "input_tokens": input,
                "output_tokens": output,
            },
        },
        "parent_tool_use_id": null,
    }))
}

fn tool_result(tool_use_id: &str) -> ClaudeFrame {
    classify_frame(&json!({
        "type": "user",
        "message": {
            "content": [{"content": "ok", "tool_use_id": tool_use_id, "type": "tool_result"}],
            "role": "user",
        },
        "parent_tool_use_id": null,
    }))
}

#[test]
fn the_live_meter_reports_each_complete_request_once_with_its_model() {
    let mut meter = LiveUsageMeter::new();
    let frames = [
        // One request delivered as two messages with the same id: the later counts.
        assistant("m1", "claude-sonnet-4-6", (0, 0, 100, 5)),
        assistant("m1", "claude-sonnet-4-6", (0, 0, 100, 20)),
        tool_result("toolu_1"),
        assistant("m2", "claude-opus-5-5", (10, 100, 30, 40)),
        tool_result("toolu_2"),
    ];
    let mut reported = Vec::new();
    for frame in &frames {
        if let Some(request) = meter.observe(frame) {
            reported.push((request, meter.since_result()));
        }
    }
    assert_eq!(
        reported,
        vec![
            (
                LiveRequest {
                    model: Some("claude-sonnet-4-6".into()),
                    usage: tokens(100, 0, 0, 20, 0),
                },
                tokens(100, 0, 0, 20, 0),
            ),
            (
                LiveRequest {
                    model: Some("claude-opus-5-5".into()),
                    usage: tokens(30, 100, 10, 40, 0),
                },
                tokens(130, 100, 10, 60, 0),
            ),
        ]
    );
}

#[test]
fn the_next_request_or_a_compaction_completes_the_pending_one() {
    let mut meter = LiveUsageMeter::new();
    assert_eq!(
        meter.observe(&assistant("m1", "claude-sonnet-4-6", (0, 0, 10, 1))),
        None
    );
    let completed = meter.observe(&assistant("m2", "claude-sonnet-4-6", (0, 0, 20, 2)));
    assert_eq!(
        completed.map(|request| request.usage),
        Some(tokens(10, 0, 0, 1, 0))
    );
    let compaction = classify_frame(&json!({"type": "system", "subtype": "compact_boundary"}));
    assert_eq!(
        meter.observe(&compaction).map(|request| request.usage),
        Some(tokens(20, 0, 0, 2, 0))
    );
    assert_eq!(meter.observe(&compaction), None);
    assert_eq!(meter.since_result(), tokens(30, 0, 0, 3, 0));
}

#[test]
fn a_result_clears_the_live_sum_and_drops_the_pending_request() {
    let mut meter = LiveUsageMeter::new();
    meter.observe(&assistant("m1", "claude-sonnet-4-6", (0, 0, 10, 1)));
    meter.observe(&tool_result("toolu_1"));
    meter.observe(&assistant("m2", "claude-sonnet-4-6", (0, 0, 20, 2)));
    meter.result_measured();
    assert_eq!(meter.since_result(), ZERO_USAGE);
    // The pending request was part of the result; nothing is left to complete.
    assert_eq!(meter.observe(&tool_result("toolu_2")), None);
}

#[test]
fn an_assistant_message_without_usage_is_no_request() {
    let mut meter = LiveUsageMeter::new();
    meter.observe(&assistant("m1", "claude-sonnet-4-6", (0, 0, 10, 1)));
    let without_usage = classify_frame(&json!({
        "type": "assistant",
        "message": {"content": [], "id": "m2", "model": "claude-sonnet-4-6"},
    }));
    assert_eq!(meter.observe(&without_usage), None);
    assert_eq!(
        meter
            .observe(&tool_result("toolu_1"))
            .map(|request| request.usage),
        Some(tokens(10, 0, 0, 1, 0))
    );
}

#[test]
fn claude_models_have_a_context_window_and_other_models_none() {
    assert_eq!(model_context_window("claude-sonnet-4-6"), Some(1_000_000));
    assert_eq!(model_context_window("claude-opus-5-5[1m]"), Some(1_000_000));
    assert_eq!(model_context_window("claude-haiku-4-5"), Some(200_000));
    assert_eq!(
        model_context_window(" Claude-Haiku-4-5[1M] "),
        Some(200_000)
    );
    assert_eq!(model_context_window("gpt-5"), None);
    assert_eq!(model_context_window("haiku"), None);
}
