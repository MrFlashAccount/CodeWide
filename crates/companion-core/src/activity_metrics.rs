//! Companion-owned activity counters. Wire consumers select a ready range; they
//! never tokenize command output, add item footprints, or apply model prices.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

// The V1 bounded activity surface retains sixteen rich cards. This is a wire
// presentation contract, not a limit on the underlying history.
const LIVE_ACTIVITY_WINDOW: usize = 16;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ActivityState {
    pub(crate) items: Vec<ActivityItem>,
    // A live projection may use this rate, but persisted activity contains no prices.
    #[serde(skip)]
    pub(crate) input_price: Option<f64>,
    pub(crate) active: bool,
    pub(crate) plan: bool,
    pub(crate) diff: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub(crate) enum AgentPhase {
    #[default]
    Ordinary,
    Final,
    Question,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ActivityItem {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) output_bytes: Option<u64>,
    pub(crate) text: bool,
    pub(crate) phase: AgentPhase,
    pub(crate) pre_turn: bool,
}

impl ActivityItem {
    pub(crate) fn from_item(value: &Value) -> Option<Self> {
        Some(Self {
            id: value.get("id")?.as_str()?.to_owned(),
            kind: value.get("type")?.as_str()?.to_owned(),
            output_bytes: value
                .pointer("/codewideOutputFootprint/bytes")
                .and_then(Value::as_u64)
                .or_else(|| {
                    value
                        .get("aggregatedOutput")
                        .and_then(Value::as_str)
                        .map(|s| s.len() as u64)
                }),
            text: value
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty()),
            phase: if value.get("delivery").and_then(Value::as_str) == Some("async")
                && value
                    .get("questions")
                    .and_then(Value::as_array)
                    .is_some_and(|q| !q.is_empty())
            {
                AgentPhase::Question
            } else if value.get("phase").and_then(Value::as_str) == Some("final_answer") {
                AgentPhase::Final
            } else {
                AgentPhase::Ordinary
            },
            pre_turn: value.get("codewidePreTurn").and_then(Value::as_bool) == Some(true),
        })
    }
}

impl ActivityState {
    pub(crate) fn from_turn(turn: &Value) -> Self {
        let mut state = Self::default();
        state.merge_turn(turn);
        state
    }

    pub(crate) fn merge_turn(&mut self, turn: &Value) {
        self.active = turn.get("status").and_then(Value::as_str) == Some("inProgress");
        if let Some(items) = turn.get("items").and_then(Value::as_array) {
            for item in items {
                if let Some(item) = ActivityItem::from_item(item) {
                    self.upsert(item);
                }
            }
        }
        if let Some(price) = turn
            .pointer("/codewide/usage/turn/cost/price/input")
            .and_then(Value::as_f64)
        {
            self.input_price = Some(price);
        }
        self.plan |= turn.pointer("/codewide/plan").is_some();
        self.diff |= turn.pointer("/codewide/diff").is_some();
    }

    pub(crate) fn upsert(&mut self, mut item: ActivityItem) {
        if let Some(existing) = self.items.iter_mut().find(|old| old.id == item.id) {
            if item.output_bytes.is_none() {
                item.output_bytes = existing.output_bytes;
            }
            *existing = item;
        } else {
            self.items.push(item);
        }
    }

    pub(crate) fn projection(&self) -> Value {
        let first_user = self
            .items
            .iter()
            .position(|i| i.kind == "userMessage")
            .unwrap_or(usize::MAX);
        let last = self
            .items
            .iter()
            .rposition(|i| i.kind != "userMessage" && i.phase != AgentPhase::Question);
        let final_agent = self
            .items
            .iter()
            .rposition(|i| {
                i.kind == "agentMessage"
                    && i.text
                    && i.phase != AgentPhase::Question
                    && i.phase == AgentPhase::Final
            })
            .or_else(|| {
                self.items.iter().rposition(|i| {
                    i.kind == "agentMessage" && i.text && i.phase != AgentPhase::Question
                })
            });
        let visible: Vec<_> = self
            .items
            .iter()
            .enumerate()
            .filter(|(index, item)| {
                item.kind != "userMessage"
                    && item.phase != AgentPhase::Question
                    && (item.kind != "reasoning" || (self.active && Some(*index) == last))
            })
            .collect();
        let history: Vec<_> = visible
            .iter()
            .filter(|(index, item)| {
                Some(*index) != final_agent && *index >= first_user && !item.pre_turn
            })
            .map(|(_, i)| *i)
            .collect();
        let mut total = summary(&history, self.input_price);
        for (enabled, kind) in [(self.plan, "turnPlan"), (self.diff, "turnDiff")] {
            if enabled {
                total["count"] = json!(total["count"].as_u64().unwrap_or(0) + 1);
                if let Some(kinds) = total["kinds"].as_array_mut() {
                    kinds.push(json!(kind));
                }
            }
        }
        let ranges = self.ranges(&visible, first_user, final_agent);
        let commands: serde_json::Map<String, Value> = self
            .items
            .iter()
            .filter(|i| i.kind == "commandExecution")
            .map(|i| {
                (
                    i.id.clone(),
                    footprint(
                        i.output_bytes.unwrap_or(0),
                        i.output_bytes.unwrap_or(0).div_ceil(4),
                        self.input_price,
                    ),
                )
            })
            .collect();
        json!({"version": 1, "total": total, "ranges": ranges, "commands": commands})
    }
    fn ranges(
        &self,
        visible: &[(usize, &ActivityItem)],
        first_user: usize,
        final_agent: Option<usize>,
    ) -> Vec<Value> {
        let active_tools: Vec<_> = visible
            .iter()
            .filter(|(index, i)| *index >= first_user && !i.pre_turn && i.kind != "agentMessage")
            .map(|(_, i)| i.id.as_str())
            .collect();
        let live_ids = &active_tools[active_tools.len().saturating_sub(LIVE_ACTIVITY_WINDOW)..];
        let mut ranges = Vec::new();
        let mut group = Vec::new();
        let mut previous_scope = None;
        for (index, item) in visible {
            if !self.active && Some(*index) == final_agent {
                continue;
            }
            let pre_turn = *index < first_user || item.pre_turn;
            if previous_scope.is_some_and(|scope| scope != pre_turn) {
                push_ranges(&mut ranges, &group, self.input_price, self.active, live_ids);
                group.clear();
            }
            previous_scope = Some(pre_turn);
            if item.kind == "agentMessage" && item.text {
                push_ranges(&mut ranges, &group, self.input_price, self.active, live_ids);
                group.clear();
            } else if item.kind != "agentMessage" && !(pre_turn && item.kind == "contextCompaction")
            {
                group.push(*item);
            }
        }
        let metadata: Vec<_> = [(self.plan, "turnPlan"), (self.diff, "turnDiff")]
            .into_iter()
            .filter(|(enabled, _)| *enabled)
            .map(|(_, kind)| ActivityItem {
                id: format!("codewide:{kind}"),
                kind: kind.into(),
                ..ActivityItem::default()
            })
            .collect();
        if !self.active {
            group.extend(metadata.iter());
        }
        push_ranges(&mut ranges, &group, self.input_price, self.active, live_ids);
        ranges
    }
}

fn push_ranges(
    ranges: &mut Vec<Value>,
    items: &[&ActivityItem],
    price: Option<f64>,
    active: bool,
    live_ids: &[&str],
) {
    push_range(ranges, items, price);
    if active {
        let split = items
            .iter()
            .position(|i| live_ids.contains(&i.id.as_str()))
            .unwrap_or(items.len());
        if split > 0 && split < items.len() {
            push_range(ranges, &items[..split], price);
            push_range(ranges, &items[split..], price);
        }
    }
}

fn push_range(ranges: &mut Vec<Value>, items: &[&ActivityItem], price: Option<f64>) {
    if let (Some(first), Some(last)) = (items.first(), items.last()) {
        ranges.push(json!({"firstItemId": first.id, "lastItemId": last.id, "summary": summary(items, price)}));
    }
}

pub(crate) fn summary(items: &[&ActivityItem], price: Option<f64>) -> Value {
    let mut kinds = Vec::new();
    let (mut bytes, mut tokens) = (0_u64, 0_u64);
    for item in items {
        if !kinds.contains(&item.kind.as_str()) {
            kinds.push(item.kind.as_str());
        }
        if item.kind == "commandExecution" {
            bytes = bytes.saturating_add(item.output_bytes.unwrap_or(0));
            tokens = tokens.saturating_add(item.output_bytes.unwrap_or(0).div_ceil(4));
        }
    }
    json!({"count": items.len(), "kinds": kinds, "outputFootprint": footprint(bytes, tokens, price)})
}

// WHY: API-equivalent prices are approximate floating-point USD, just like usage pricing.
#[allow(clippy::cast_precision_loss)]
pub(crate) fn footprint(bytes: u64, tokens: u64, price: Option<f64>) -> Value {
    json!({"version": 1, "basis": "approxBytesPerToken", "bytes": bytes, "estimatedTokens": tokens,
        "estimatedInputCostUsd": price.filter(|p| p.is_finite() && *p >= 0.0).map(|p| tokens as f64 * p / 1_000_000.0)})
}

pub(crate) fn attach_to_turn(mut turn: Value) -> Value {
    if turn.get("itemsView").and_then(Value::as_str) == Some("summary") {
        return turn;
    }
    let projection = ActivityState::from_turn(&turn).projection();
    if let Some(object) = turn.as_object_mut() {
        let metadata = object.entry("codewide").or_insert_with(|| json!({}));
        if let Some(metadata) = metadata.as_object_mut() {
            metadata.insert("activity".into(), projection["total"].clone());
            metadata.insert("activityMetrics".into(), projection);
        }
    }
    turn
}

/// Carries exact group figures through item-only activity hydration. Each range
/// lives on its first item, so this remains linear rather than copying a whole
/// turn projection into every item.
pub(crate) fn attach_item_metrics(item: &mut Value, metrics: &Value) {
    let Some(id) = item.get("id").and_then(Value::as_str).map(str::to_owned) else {
        return;
    };
    let Some(object) = item.as_object_mut() else {
        return;
    };
    if let Some(footprint) = metrics
        .get("commands")
        .and_then(|commands| commands.get(&id))
    {
        object.insert("codewideOutputFootprint".into(), footprint.clone());
    }
    if let Some(ranges) = metrics.get("ranges").and_then(Value::as_array) {
        let ending: Vec<_> = ranges
            .iter()
            .filter(|r| r.get("firstItemId").and_then(Value::as_str) == Some(&id))
            .cloned()
            .collect();
        if !ending.is_empty() {
            object.insert("codewideActivityRanges".into(), Value::Array(ending));
        }
    }
}

/// Closed history carries only its ready total, independently of command count.
pub(crate) fn compact_summary(metrics: &mut Value) {
    metrics["ranges"] = json!([]);
    metrics["commands"] = json!({});
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(items: &[Value], status: &str) -> Value {
        json!({"id":"turn", "status":status, "itemsView":"full", "items":items,
            "codewide":{"usage":{"turn":{"cost":{"price":{"input":5.0}}}}}})
    }
    fn user() -> Value {
        json!({"id":"user","type":"userMessage"})
    }
    fn command(id: &str, output: &str) -> Value {
        json!({"id":id,"type":"commandExecution","aggregatedOutput":output})
    }

    #[test]
    fn counts_utf8_once_per_command_and_prices_on_server() {
        let state = ActivityState::from_turn(&turn(
            &[
                user(),
                command("a", "λa"),
                command("b", "12345"),
                json!({"id":"answer","type":"agentMessage","phase":"final_answer","text":"done"}),
            ],
            "completed",
        ));
        let projection = state.projection();
        assert_eq!(projection["total"]["count"], 2);
        assert_eq!(projection["total"]["kinds"], json!(["commandExecution"]));
        assert_eq!(
            projection["total"]["outputFootprint"],
            footprint(8, 3, Some(5.0))
        );
        assert_eq!(projection["ranges"][0]["firstItemId"], "a");
        assert_eq!(projection["ranges"][0]["lastItemId"], "b");
        assert_eq!(projection["ranges"][0]["summary"], projection["total"]);
    }

    #[test]
    fn separates_agent_updates_and_live_window_without_double_counting() {
        let mut items = vec![
            user(),
            command("before", "abcd"),
            json!({"id":"update","type":"agentMessage","text":"working"}),
        ];
        items.extend((0..20).map(|i| command(&format!("c{i}"), "1234")));
        let projection = ActivityState::from_turn(&turn(&items, "inProgress")).projection();
        let ranges = projection["ranges"].as_array().into_iter().flatten();
        let counts: Vec<_> = ranges
            .map(|range| range["summary"]["count"].clone())
            .collect();
        assert_eq!(
            counts,
            json!([1, 20, 4, 16])
                .as_array()
                .cloned()
                .unwrap_or_default()
        );
        assert_eq!(
            projection["total"]["outputFootprint"]["estimatedTokens"],
            21
        );
    }

    #[test]
    fn hidden_reasoning_questions_and_final_answer_are_not_activity() {
        let projection = ActivityState::from_turn(&turn(&[user(),
            json!({"id":"think","type":"reasoning"}),
            command("cmd","output"),
            json!({"id":"question","type":"agentMessage","text":"question","delivery":"async","questions":[{}]}),
            json!({"id":"final","type":"agentMessage","text":"answer","phase":"final_answer"})],"completed")).projection();
        assert_eq!(projection["total"]["count"], 1);
    }

    #[test]
    fn closed_summary_stays_compact_and_metadata_belongs_to_its_group() {
        let mut items = vec![user()];
        items.extend((0..300).map(|i| command(&format!("c{i}"), "abcd")));
        let mut metrics = ActivityState::from_turn(&turn(&items, "completed")).projection();
        compact_summary(&mut metrics);
        assert_eq!(metrics["total"]["count"], 300);
        assert_eq!(metrics["total"]["kinds"], json!(["commandExecution"]));
        assert_eq!(metrics["total"]["outputFootprint"]["estimatedTokens"], 300);
        assert_eq!(metrics["ranges"], json!([]));
        assert_eq!(metrics["commands"], json!({}));
        let mut raw = turn(
            &[
                user(),
                command("a", "abcd"),
                json!({"id":"final","type":"agentMessage","text":"done","phase":"final_answer"}),
            ],
            "completed",
        );
        raw["codewide"]["diff"] = json!("patch");
        let metrics = ActivityState::from_turn(&raw).projection();
        assert_eq!(metrics["total"]["count"], 2);
        assert_eq!(metrics["ranges"][0]["lastItemId"], "codewide:turnDiff");
        assert_eq!(metrics["ranges"][0]["summary"]["count"], 2);
    }

    #[test]
    fn pre_turn_groups_do_not_merge_into_the_response_group() {
        let metrics = ActivityState::from_turn(&turn(
            &[
                command("pre", "abcd"),
                user(),
                command("response", "12345678"),
            ],
            "completed",
        ))
        .projection();
        assert_eq!(metrics["total"]["count"], 1);
        assert_eq!(metrics["total"]["outputFootprint"]["estimatedTokens"], 2);
        assert_eq!(metrics["ranges"][0]["firstItemId"], "pre");
        assert_eq!(metrics["ranges"][0]["lastItemId"], "pre");
        assert_eq!(metrics["ranges"][1]["firstItemId"], "response");
    }

    #[test]
    fn missing_price_is_unknown_and_hydration_carries_exact_range() {
        let mut raw = turn(
            &[user(), command("a", "1234"), command("b", "1234")],
            "completed",
        );
        raw["codewide"] = json!({});
        let projected = attach_to_turn(raw);
        let metrics = &projected["codewide"]["activityMetrics"];
        assert!(metrics["total"]["outputFootprint"]["estimatedInputCostUsd"].is_null());
        let mut item = command("a", "");
        attach_item_metrics(&mut item, metrics);
        assert_eq!(
            item["codewideActivityRanges"][0]["summary"]["outputFootprint"]["estimatedTokens"],
            2
        );
        assert_eq!(item["codewideOutputFootprint"]["bytes"], 4);
    }
}
