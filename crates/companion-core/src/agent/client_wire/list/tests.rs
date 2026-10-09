use std::sync::Arc;

use serde_json::{Value, json};

use super::*;
use crate::agent::{
    client_wire::WireProvider,
    model::{CapabilitySet, ProviderId, StartWhileActiveMode},
    provider::AgentProvider,
    testing::{FakeProvider, thread},
};

fn non_lead(rows: &[(&str, i64)]) -> (Arc<FakeProvider>, WireProvider) {
    let mut fake = FakeProvider::new("claude", CapabilitySet::none(StartWhileActiveMode::Busy));
    fake.threads = rows
        .iter()
        .map(|(id, key)| thread("claude", id, *key))
        .collect();
    let fake = fake.into_arc();
    let wire = WireProvider {
        descriptor: fake.descriptor(),
        capabilities: fake.capabilities(),
        primary_id: ProviderId::from_static("codex"),
        multi_provider: true,
    };
    (fake, wire)
}

fn lead_page(rows: &[(&str, i64)], next: Option<&str>) -> Value {
    json!({
        "data": rows.iter().map(|(id, key)| json!({
            "id": id, "createdAt": key, "updatedAt": key, "recencyAt": key
        })).collect::<Vec<_>>(),
        "nextCursor": next,
        "backwardsCursor": null,
    })
}

fn ids(result: &Value) -> Vec<String> {
    result["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn providers(
    fake: &Arc<FakeProvider>,
    wire: &WireProvider,
) -> Vec<(Arc<dyn AgentProvider>, WireProvider)> {
    vec![(fake.clone() as Arc<dyn AgentProvider>, wire.clone())]
}

#[tokio::test]
async fn one_provider_passes_params_cursor_and_result_through() {
    let params = json!({"cursor": "opaque-lead", "limit": 50, "sortKey": "recency_at"});
    let plan = prepare(&params, false);
    assert!(plan.is_passthrough());
    assert_eq!(plan.lead_params.as_ref(), Some(&params));
    let lead = lead_page(&[("a", 10)], Some("next-lead"));
    assert_eq!(finish(&plan, Some(&lead), lead.clone(), &[]).await, lead);
}

#[tokio::test]
async fn pages_merge_non_lead_rows_inside_disjoint_windows() -> Result<(), String> {
    let (fake, wire) = non_lead(&[("c1", 95), ("c2", 85), ("c3", 80), ("c4", 75), ("c5", 5)]);
    let params = json!({"limit": 3, "sortKey": "recency_at", "sortDirection": "desc", "archived": false,
        "modelProviders": [], "sourceKinds": ["cli", "vscode"], "useStateDbOnly": true});
    let first = prepare(&params, true);
    assert_eq!(
        first
            .lead_params
            .as_ref()
            .and_then(|lead| lead.get("cursor")),
        Some(&Value::Null)
    );
    let lead = lead_page(&[("x1", 100), ("x2", 90), ("x3", 80)], Some("L1"));
    let page = finish(&first, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["x1", "c1", "x2", "c2", "x3", "c3"]);
    let cursor = page["nextCursor"]
        .as_str()
        .ok_or("composite cursor")?
        .to_owned();
    assert!(cursor.starts_with("cwl1."));

    let second = prepare(
        &json!({"cursor": cursor, "limit": 3, "sortKey": "recency_at"}),
        true,
    );
    assert_eq!(
        second
            .lead_params
            .as_ref()
            .and_then(|lead| lead.get("cursor")),
        Some(&json!("L1"))
    );
    let lead = lead_page(&[("x4", 70), ("x5", 60)], None);
    let page = finish(&second, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["c4", "x4", "x5", "c5"]);
    assert_eq!(page["nextCursor"], Value::Null);
    Ok(())
}

#[tokio::test]
async fn window_bound_is_clamped_to_the_previous_page() -> Result<(), String> {
    let (fake, wire) = non_lead(&[("c1", 85)]);
    let cursor = super::encode_cursor(&super::CompositeCursor {
        lead: Some("L1".into()),
        lead_done: false,
        bound: Some(80),
    })
    .ok_or("cursor")?;
    let plan = prepare(&json!({"cursor": cursor, "sortKey": "recency_at"}), true);
    // A null-recency lead row sorted after the bound must not reopen the
    // previous window.
    let lead = lead_page(&[("x9", 90)], Some("L2"));
    let page = finish(&plan, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["x9"]);
    let params = fake
        .list_params
        .lock()
        .map_err(|_| "lock")?
        .last()
        .cloned()
        .ok_or("non-lead list was not called")?;
    let window = params.window.ok_or("window")?;
    assert_eq!((window.lower, window.upper), (Some(80), Some(80)));
    Ok(())
}

#[tokio::test]
async fn excluded_params_answer_from_the_lead_only() {
    let (fake, wire) = non_lead(&[("c1", 95)]);
    for params in [
        json!({"sectionId": "s1"}),
        json!({"parentThreadId": "p"}),
        json!({"sortKey": "section_position"}),
        json!({"sourceKinds": ["exec"]}),
        json!({"futureParam": true}),
    ] {
        let plan = prepare(&params, true);
        let lead = lead_page(&[("x1", 100)], Some("L1"));
        let page = finish(&plan, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
        assert_eq!(ids(&page), ["x1"], "{params}");
        assert_eq!(page["nextCursor"], "L1", "{params}");
    }
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn model_provider_filter_selects_the_non_lead_provider_by_name() {
    let (fake, wire) = non_lead(&[("c1", 95)]);
    let plan = prepare(&json!({"modelProviders": ["openai"]}), true);
    let lead = lead_page(&[("x1", 100)], None);
    let page = finish(&plan, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["x1"]);
    let plan = prepare(&json!({"modelProviders": ["claude-models"]}), true);
    let page = finish(&plan, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["x1", "c1"]);
    assert_eq!(page["data"][1]["modelProvider"], "claude-models");
    assert_eq!(page["data"][1]["codewideAgent"]["provider"], "claude");
}

#[tokio::test]
async fn a_terminal_session_without_recency_is_merged_with_its_update_time_as_order_key() {
    // A Claude session started in a terminal has no `CodeWide` recency; it
    // must be ordered by its update time on the wire too, or a client that
    // persists `recencyAt` sorts it after every other thread.
    let (fake, wire) = {
        let mut fake = FakeProvider::new("claude", CapabilitySet::none(StartWhileActiveMode::Busy));
        let mut terminal = thread("claude", "terminal", 95);
        terminal.recency_at = None;
        terminal.origin = crate::agent::model::ThreadOrigin::External;
        fake.threads = vec![terminal];
        let fake = fake.into_arc();
        let wire = WireProvider {
            descriptor: fake.descriptor(),
            capabilities: fake.capabilities(),
            primary_id: ProviderId::from_static("codex"),
            multi_provider: true,
        };
        (fake, wire)
    };
    let plan = prepare(
        &json!({"limit": 2, "sortKey": "recency_at", "sortDirection": "desc", "archived": false,
            "modelProviders": [], "sourceKinds": ["cli", "vscode"], "useStateDbOnly": true}),
        true,
    );
    let lead = lead_page(&[("x1", 100), ("x2", 90)], Some("L1"));
    let page = finish(&plan, Some(&lead), lead.clone(), &providers(&fake, &wire)).await;
    assert_eq!(ids(&page), ["x1", "terminal", "x2"]);
    assert_eq!(page["data"][1]["recencyAt"], 95);
    assert_eq!(page["data"][1]["updatedAt"], 95);
}
