//! Rebuildable question history derived exclusively from paired rollout tool records.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionHistory {
    item_id: String,
    questions: Vec<Question>,
    outcome: Outcome,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Question {
    id: String,
    title: String,
    secret: bool,
    options: Vec<OptionLabel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OptionLabel {
    label: String,
    description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum Outcome {
    Unconfirmed,
    Answered { answers: Vec<Answer> },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Answer {
    question_id: String,
    answer: AnswerValue,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AnswerValue {
    Text { values: Vec<String> },
    Secret,
}

#[derive(Deserialize)]
struct Arguments {
    questions: Vec<RawQuestion>,
}

#[derive(Deserialize)]
struct RawQuestion {
    id: String,
    question: String,
    #[serde(default, alias = "isSecret")]
    is_secret: bool,
    #[serde(default)]
    options: Option<Vec<OptionLabel>>,
}

/// Avoid deserializing unrelated, potentially huge tool output bodies in summary reads.
pub(crate) fn relevant(prefix: &[u8], history: &[QuestionHistory]) -> bool {
    let contains = |needle: &[u8]| memchr::memmem::find(prefix, needle).is_some();
    if !contains(b"\"type\":\"response_item\"") {
        return false;
    }
    (contains(b"\"type\":\"function_call\"") && contains(b"\"name\":\"request_user_input\""))
        || (contains(b"\"type\":\"function_call_output\"")
            && history.iter().any(|question| {
                serde_json::to_string(&question.item_id)
                    .is_ok_and(|id| contains(format!("\"call_id\":{id}").as_bytes()))
            }))
}

pub(crate) fn ingest(history: &mut Vec<QuestionHistory>, payload: &Value) {
    let Some(id) = payload
        .get("call_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return;
    };
    match payload.get("type").and_then(Value::as_str) {
        Some("function_call")
            if payload.get("name").and_then(Value::as_str) == Some("request_user_input") =>
        {
            if history.iter().any(|question| question.item_id == id) {
                return;
            }
            if let Some(questions) = parse_questions(payload) {
                history.push(QuestionHistory {
                    item_id: id.to_owned(),
                    questions,
                    outcome: Outcome::Unconfirmed,
                });
            }
        }
        Some("function_call_output") => {
            if let Some(question) = history.iter_mut().find(|question| question.item_id == id)
                && let Some(answers) = parse_answers(&question.questions, payload)
            {
                question.outcome = Outcome::Answered { answers };
            }
        }
        _ => {}
    }
}

fn parse_questions(payload: &Value) -> Option<Vec<Question>> {
    let arguments: Arguments = serde_json::from_str(payload.get("arguments")?.as_str()?).ok()?;
    let mut questions = Vec::new();
    for raw in arguments.questions {
        if raw.id.is_empty()
            || raw.question.trim().is_empty()
            || questions
                .iter()
                .any(|question: &Question| question.id == raw.id)
        {
            return None;
        }
        questions.push(Question {
            id: raw.id,
            title: raw.question,
            secret: raw.is_secret,
            options: raw.options.unwrap_or_default(),
        });
    }
    (!questions.is_empty()).then_some(questions)
}

fn parse_answers(questions: &[Question], payload: &Value) -> Option<Vec<Answer>> {
    let output = payload.get("output")?;
    let text = output.as_str().or_else(|| {
        let parts = output.as_array()?;
        (parts.len() == 1 && parts[0].get("type")?.as_str()? == "input_text")
            .then(|| parts[0].get("text")?.as_str())
            .flatten()
    })?;
    let result: Value = serde_json::from_str(text).ok()?;
    let raw = result.get("answers")?.as_object()?;
    let mut answers = Vec::new();
    for question in questions {
        let Some(value) = raw.get(&question.id) else {
            continue;
        };
        let values = value.get("answers")?.as_array()?;
        if values.iter().any(|value| !value.is_string()) {
            return None;
        }
        if !values
            .iter()
            .any(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
        {
            continue;
        }
        // Secret contents never enter the rebuildable checkpoint or the client projection.
        let answer = if question.secret {
            AnswerValue::Secret
        } else {
            AnswerValue::Text {
                values: values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect(),
            }
        };
        answers.push(Answer {
            question_id: question.id.clone(),
            answer,
        });
    }
    (!answers.is_empty()).then_some(answers)
}

#[cfg(test)]
#[path = "history_questions_tests.rs"]
mod tests;
