use crate::history::SummaryProjectionState;
use serde_json::{Value, json};

fn ingest(
    state: &mut SummaryProjectionState,
    payload: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    state.ingest_rollout_record(
        &serde_json::to_vec(&json!({"type":"response_item", "payload":payload}))?,
        0,
    )?;
    Ok(())
}

fn call(id: &str) -> Value {
    json!({"type":"function_call", "name":"request_user_input", "call_id":id,
        "arguments":json!({"questions":[
            {"id":"choice", "question":"Where?", "options":[{"label":"Local", "description":"Here"}]},
            {"id":"password", "question":"Password?", "is_secret":true}
        ]}).to_string()})
}

fn response(id: &str, output: &str) -> Value {
    json!({"type":"function_call_output", "call_id":id, "output":output})
}

#[test]
fn question_history_survives_reopen_and_replay_without_secret_content()
-> Result<(), Box<dyn std::error::Error>> {
    let mut state = SummaryProjectionState::new("turn".into());
    ingest(&mut state, &call("call"))?;
    assert_eq!(
        state.project()["codewide"]["questions"][0]["outcome"]["status"],
        "unconfirmed"
    );
    let checkpoint = serde_json::to_vec(&state)?;
    let mut restored: SummaryProjectionState = serde_json::from_slice(&checkpoint)?;
    let result = response(
        "call",
        r#"{"answers":{"choice":{"answers":["Local"]},"password":{"answers":["secret-sentinel"]}}}"#,
    );
    ingest(&mut restored, &result)?;
    let checkpoint = serde_json::to_string(&restored)?;
    assert!(!checkpoint.contains("secret-sentinel"));
    let mut reopened: SummaryProjectionState = serde_json::from_str(&checkpoint)?;
    ingest(&mut reopened, &call("call"))?;
    ingest(&mut reopened, &result)?;
    let turn = reopened.project();
    let questions = turn["codewide"]["questions"]
        .as_array()
        .ok_or("question history missing")?;
    assert_eq!(questions.len(), 1);
    assert_eq!(questions[0]["itemId"], "call");
    assert_eq!(questions[0]["questions"][0]["options"][0]["label"], "Local");
    assert_eq!(
        questions[0]["outcome"],
        json!({"status":"answered", "answers":[
            {"questionId":"choice", "answer":{"kind":"text", "values":["Local"]}},
            {"questionId":"password", "answer":{"kind":"secret"}}
        ]})
    );
    assert!(!turn.to_string().contains("secret-sentinel"));
    Ok(())
}

#[test]
fn absent_cancelled_empty_and_unrelated_outputs_do_not_confirm_answers()
-> Result<(), Box<dyn std::error::Error>> {
    for output in [
        "aborted by user after 1s",
        r#"{"answers":{}}"#,
        r#"{"answers":{"choice":{"answers":[]}}}"#,
        r#"{"answers":{"choice":{"answers":[42]}}}"#,
    ] {
        let mut state = SummaryProjectionState::new("turn".into());
        ingest(&mut state, &call("call"))?;
        ingest(
            &mut state,
            &response(
                "other-call",
                r#"{"answers":{"choice":{"answers":["Wrong"]}}}"#,
            ),
        )?;
        ingest(&mut state, &response("call", output))?;
        state.seal_interrupted();
        let projected = state.project();
        assert_eq!(projected["status"], "interrupted");
        assert_eq!(
            projected["codewide"]["questions"][0]["outcome"]["status"],
            "unconfirmed"
        );
    }
    Ok(())
}

#[test]
fn malformed_questions_and_unrelated_tool_bodies_are_not_materialized()
-> Result<(), Box<dyn std::error::Error>> {
    let mut state = SummaryProjectionState::new("turn".into());
    let mut unrelated = call("other");
    unrelated["name"] = json!("other_tool");
    ingest(&mut state, &unrelated)?;
    let mut malformed = call("bad");
    malformed["arguments"] =
        json!(r#"{"questions":[{"id":"q","question":"One"},{"id":"q","question":"Two"}]}"#);
    ingest(&mut state, &malformed)?;
    assert!(state.project()["codewide"]["questions"].is_null());
    // Unrelated tool bodies must not enter the summary parser, even when invalid JSON.
    state.ingest_rollout_record(br#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"other","output":broken"#, 0)?;
    Ok(())
}

#[test]
fn partial_and_content_item_answers_keep_their_question_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let mut state = SummaryProjectionState::new("turn".into());
    ingest(&mut state, &call("call"))?;
    ingest(
        &mut state,
        &json!({"type":"function_call_output", "call_id":"call", "output":[
            {"type":"input_text", "text":r#"{"answers":{"choice":{"answers":["Custom", "Second"]}}}"#}
        ]}),
    )?;
    assert_eq!(
        state.project()["codewide"]["questions"][0]["outcome"],
        json!({"status":"answered", "answers":[
            {"questionId":"choice", "answer":{"kind":"text", "values":["Custom","Second"]}}
        ]})
    );
    Ok(())
}
