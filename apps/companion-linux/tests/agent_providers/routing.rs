//! Provider routing, catalog, request, and provider-list integration contracts.

use super::*;

#[tokio::test]
async fn thread_start_binds_the_requested_provider_and_turns_bypass_the_primary() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let started = harness
        .rpc(
            "start",
            "thread/start",
            json!({"cwd": "/work", "model": "fake-model", "codewideAgentProvider": FAKE}),
        )
        .await?;
    let result = &started["result"];
    let thread_id = result["thread"]["id"]
        .as_str()
        .ok_or("no thread id")?
        .to_owned();
    assert_eq!(thread_id.len(), 36);
    assert_eq!(&thread_id[14..15], "7", "host-minted ids are UUIDv7");
    assert_eq!(result["model"], "fake-model");
    assert_eq!(result["sandbox"]["type"], "workspaceWrite");
    assert_eq!(result["activePermissionProfile"]["id"], ":workspace");
    assert_eq!(result["thread"]["modelProvider"], "fake-models");
    assert_eq!(result["thread"]["codewideAgent"]["provider"], FAKE);
    assert_eq!(result["thread"]["codewideAgent"]["primary"], false);
    assert_eq!(
        result["thread"]["codewideAgent"]["capabilities"]["review"],
        false
    );
    let binding = harness
        .store
        .agent_binding(&thread_id)?
        .ok_or("binding was not written before the response")?;
    let binding: Value = serde_json::from_slice(&binding)?;
    assert_eq!(binding["activeProvider"], FAKE);
    assert_eq!(binding["origin"], "created");

    let queued = harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "message-1",
                "remoteThreadId": thread_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": thread_id,
                    "clientUserMessageId": "message-1",
                    "input": [{"type": "text", "text": "hello", "text_elements": []}]
                }
            }}),
        )
        .await?;
    assert!(queued.get("error").is_none(), "{queued}");
    wait_for_state(&harness.store, "message-1", OutboxState::Delivered).await?;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        1
    );
    // The primary provider never saw the thread: no admission read, no
    // turn/start, no thread/read.
    let primary_methods = harness.observed_methods();
    assert!(
        !primary_methods
            .iter()
            .any(|method| method.starts_with("turn/") || method == "thread/read"),
        "{primary_methods:?}"
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn turn_start_overrides_become_thread_settings_before_the_turn() -> TestResult {
    // A new chat sends its effort and access choice only with its first
    // `turn/start`; a neutral provider must receive them as thread settings.
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "message-settings",
                "remoteThreadId": thread_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": thread_id,
                    "clientUserMessageId": "message-settings",
                    "input": [{"type": "text", "text": "hello", "text_elements": []}],
                    "model": "fake-model",
                    "effort": "max",
                    "permissions": ":full-access"
                }
            }}),
        )
        .await?;
    wait_for_state(&harness.store, "message-settings", OutboxState::Delivered).await?;
    let calls = harness.fake.calls();
    let update = calls.iter().position(|call| call == "thread.update");
    let start = calls.iter().position(|call| call == "turn.start");
    assert!(
        matches!((update, start), (Some(update), Some(start)) if update < start),
        "{calls:?}"
    );
    let updates = harness.fake.updates.lock().map_err(|_| "lock")?.clone();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0]["type"], "settings");
    assert_eq!(updates[0]["model"], "fake-model");
    assert_eq!(updates[0]["effort"], "max");
    assert_eq!(updates[0]["permissionProfile"], ":full-access");
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn busy_start_stays_queued_and_is_delivered_once_after_turn_completed() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    harness
        .fake
        .turn_starts
        .lock()
        .map_err(|_| "lock")?
        .push_back(TurnStartResult::Busy {
            active_turn_id: TurnId::from_static("turn-wake"),
        });
    harness
        .rpc(
            "put",
            "companion/queue/put",
            json!({"command": {
                "commandId": "message-busy",
                "remoteThreadId": thread_id,
                "method": "turn/start",
                "presentation": "delivery",
                "params": {
                    "threadId": thread_id,
                    "clientUserMessageId": "message-busy",
                    "input": [{"type": "text", "text": "while active", "text_elements": []}]
                }
            }}),
        )
        .await?;
    // After `busy` the command is queued again as "deliver after idle".
    timeout(Duration::from_secs(3), async {
        loop {
            let command = harness
                .store
                .outbox_list(None)?
                .into_iter()
                .find(|command| command.command_id == "message-busy");
            if let Some(command) = command
                && command.state == OutboxState::Queued
                && command.presentation == codewide_companion::store::OutboxPresentation::Queue
                && command.attempts == 0
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        1,
        "nothing is redelivered while the thread is active"
    );
    harness.fake.set_active(false);
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::TurnCompleted {
            app_thread_id: AppThreadId::parse(&thread_id).ok_or("id")?,
            turn: AgentTurn {
                turn_id: TurnId::from_static("turn-wake"),
                status: TurnStatus::Completed,
                origin: TurnOrigin::Provider,
                started_at: 1,
                completed_at: Some(2),
                error: None,
                items: Vec::new(),
                provenance: None,
                usage: None,
            },
        })))
        .await?;
    let completed = harness
        .event_where(|payload| payload["method"] == "turn/completed")
        .await?;
    assert_eq!(completed["params"]["turn"]["itemsView"], "full");
    wait_for_state(&harness.store, "message-busy", OutboxState::Delivered).await?;
    assert_eq!(
        harness
            .fake
            .calls()
            .iter()
            .filter(|call| *call == "turn.start")
            .count(),
        2
    );
    let failed = harness
        .store
        .outbox_list(None)?
        .iter()
        .any(|command| command.state == OutboxState::Failed);
    assert!(!failed);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn missing_capability_answers_32072_without_contacting_the_provider() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    let before = harness.fake.calls();
    for (method, capability) in [
        ("review/start", "review"),
        ("thread/fork", "threads.fork"),
        ("thread/goal/get", "goals"),
        ("thread/backgroundTerminals/list", "backgroundTerminals"),
        ("companion/threadResources/read", "history.threadResources"),
    ] {
        let response = harness
            .rpc(method, method, json!({"threadId": thread_id}))
            .await?;
        assert_eq!(response["error"]["code"], -32072, "{method}");
        assert_eq!(
            response["error"]["message"],
            format!("{capability} is not supported by this thread's agent")
        );
        assert_eq!(response["error"]["data"]["capability"], capability);
        assert_eq!(response["error"]["data"]["provider"], FAKE);
    }
    assert_eq!(harness.fake.calls(), before);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_provider_index_serves_its_threads_resources_and_joins_search() -> TestResult {
    let stored = Arc::new(FakeStored::default());
    let mut harness =
        Harness::start_with(default_answer, |_| Vec::new(), Some(stored.clone())).await?;
    let thread_id = harness.new_fake_thread().await?;

    let resources = harness
        .rpc(
            "resources",
            "companion/threadResources/read",
            json!({"threadId": thread_id}),
        )
        .await?;
    assert_eq!(resources["result"]["from"], "fake-index");

    let window = harness
        .rpc(
            "window",
            "companion/search/window",
            json!({"threadId": thread_id, "messageId": 7, "direction": "around"}),
        )
        .await?;
    assert_eq!(window["result"]["turns"][0]["id"], "window-turn");

    // The Codex index of this harness has no search worker: the global page
    // still carries the provider index's hits and counts the failed source.
    let global = harness
        .rpc("search", "companion/search", json!({"query": "hello"}))
        .await?;
    assert_eq!(global["result"]["data"][0]["threadId"], "fake-hit");
    assert_eq!(global["result"]["failedSources"], 1);

    assert_eq!(
        stored.reads(),
        [
            (
                "companion/threadResources/read".to_owned(),
                thread_id.clone()
            ),
            ("companion/search/window".to_owned(), thread_id.clone()),
            ("companion/search".to_owned(), String::new()),
        ]
    );

    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::TurnStarted {
            app_thread_id: AppThreadId::parse(&thread_id).ok_or("id")?,
            turn: AgentTurn {
                turn_id: TurnId::from_static("turn-live"),
                status: TurnStatus::InProgress,
                origin: TurnOrigin::User,
                started_at: 1,
                completed_at: None,
                error: None,
                items: Vec::new(),
                provenance: None,
                usage: None,
            },
        })))
        .await?;
    timeout(Duration::from_secs(3), async {
        while !stored
            .observed()
            .iter()
            .any(|method| method == "turn/started")
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_thread_of_a_disabled_provider_answers_32070() -> TestResult {
    let ghost_thread = AppThreadId::parse("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e").ok_or("id")?;
    let bound = ghost_thread.clone();
    let mut harness = Harness::start(default_answer, move |_| {
        vec![(bound, ProviderId::from_static("ghost"))]
    })
    .await?;
    let response = harness
        .rpc(
            "read",
            "thread/read",
            json!({"threadId": ghost_thread.as_str()}),
        )
        .await?;
    assert_eq!(response["error"]["code"], -32070);
    assert_eq!(
        response["error"]["message"],
        "Ghost provider is disabled on this host"
    );
    assert!(harness.observed_methods().is_empty());
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn an_unknown_thread_answers_the_primary_not_found_and_is_not_bound() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let response = harness
        .rpc(
            "interrupt",
            "turn/interrupt",
            json!({"threadId": "missing-thread", "turnId": "t"}),
        )
        .await?;
    assert_eq!(response["error"]["code"], -32600);
    assert_eq!(
        response["error"]["message"],
        "thread not found: missing-thread"
    );
    assert!(harness.store.agent_binding("missing-thread")?.is_none());
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn runtime_request_ids_are_namespaced_and_answers_reach_the_asking_provider() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    let app_thread_id = AppThreadId::parse(&thread_id).ok_or("id")?;
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::RequestOpened {
            app_thread_id: app_thread_id.clone(),
            turn_id: TurnId::from_static("turn-1"),
            request_id: NativeRequestId::Text("perm-1".into()),
            request: RuntimeRequest::Approval {
                kind: ApprovalKind::Tool,
                item_id: ItemId::from_static("toolu_1"),
                title: "Fetch https://example.com".into(),
                detail: Some("WebFetch".into()),
                command: Some("WebFetch https://example.com".into()),
                cwd: None,
                decisions: vec![ApprovalDecision::Accept, ApprovalDecision::Decline],
            },
        })))
        .await?;
    let approval = harness
        .event_where(|payload| payload["method"] == "item/commandExecution/requestApproval")
        .await?;
    assert_eq!(approval["id"], "cw-fake:\"perm-1\"");
    assert_eq!(
        approval["params"]["codewideApprovalTitle"],
        "Fetch https://example.com"
    );
    harness
        .pushed
        .send(json!({
            "id": 7,
            "method": "item/tool/requestUserInput",
            "params": {"threadId": "codex-1", "turnId": "t", "itemId": "i", "questions": [], "isBlocking": true, "autoResolutionMs": null}
        }))
        .await?;
    let codex_question = harness
        .event_where(|payload| payload["method"] == "item/tool/requestUserInput")
        .await?;
    assert_eq!(
        codex_question["id"], 7,
        "primary ids pass through unchanged"
    );

    send_json(
        &mut harness.client,
        &json!({"type": "serverResponse", "response": {"id": "cw-fake:\"perm-1\"", "result": {"decision": "accept"}}}),
    )
    .await?;
    receive_type_where(&mut harness.client, "serverResponseAccepted").await?;
    let responses = harness.fake.responses.lock().map_err(|_| "lock")?.clone();
    assert_eq!(responses.len(), 1);
    assert_eq!(
        responses[0].request_id,
        NativeRequestId::Text("perm-1".into())
    );
    assert_eq!(
        responses[0].response,
        RuntimeResponse::Approval {
            decision: ApprovalDecision::Accept
        }
    );
    send_json(
        &mut harness.client,
        &json!({"type": "serverResponse", "response": {"id": 7, "result": {"answers": {}}}}),
    )
    .await?;
    receive_type_where(&mut harness.client, "serverResponseAccepted").await?;
    timeout(Duration::from_secs(2), async {
        loop {
            if harness
                .observed_methods()
                .iter()
                .any(|method| method == "serverResponse")
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn a_provider_reconnect_resolves_only_its_own_user_requests() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let thread_id = harness.new_fake_thread().await?;
    harness
        .events
        .send(ProviderEvent::Event(Box::new(AgentEvent::RequestOpened {
            app_thread_id: AppThreadId::parse(&thread_id).ok_or("id")?,
            turn_id: TurnId::from_static("turn-1"),
            request_id: NativeRequestId::Text("perm-9".into()),
            request: RuntimeRequest::UserInput {
                item_id: ItemId::from_static("toolu_9"),
                questions: Vec::new(),
            },
        })))
        .await?;
    harness
        .event_where(|payload| payload["id"] == "cw-fake:\"perm-9\"")
        .await?;
    harness
        .pushed
        .send(json!({
            "id": 8,
            "method": "item/tool/requestUserInput",
            "params": {"threadId": "codex-1", "turnId": "t", "itemId": "i", "questions": [], "isBlocking": true, "autoResolutionMs": null}
        }))
        .await?;
    harness.event_where(|payload| payload["id"] == 8).await?;
    harness.fake.status.send(ProviderStatus::Reconnecting)?;
    let resolved = harness
        .event_where(|payload| payload["method"] == "serverRequest/resolved")
        .await?;
    assert_eq!(resolved["params"]["requestId"], "cw-fake:\"perm-9\"");
    assert_eq!(resolved["params"]["reason"], "upstream_disconnected");
    // The primary provider's question is still pending for a new client.
    let (_second, hello) = connect_client_with_hello(&harness.url).await?;
    let pending = hello["pendingRequests"]
        .as_array()
        .map(|requests| {
            requests
                .iter()
                .map(|request| request["id"].clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert_eq!(pending, vec![json!(8)]);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn thread_list_merges_non_primary_rows_inside_the_lead_window() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    {
        let mut threads = harness.fake.threads.lock().map_err(|_| "lock")?;
        for (id, key) in [
            ("0199a3c4-0000-7000-8000-000000000001", 250),
            ("0199a3c4-0000-7000-8000-000000000002", 50),
        ] {
            threads.push(agent_thread(AppThreadId::parse(id).ok_or("id")?, key));
        }
    }
    let first = harness
        .rpc(
            "list",
            "thread/list",
            json!({"archived": false, "cursor": null, "limit": 2, "modelProviders": [],
                   "sortDirection": "desc", "sortKey": "recency_at", "sourceKinds": ["cli", "vscode"],
                   "useStateDbOnly": true}),
        )
        .await?;
    let rows = first["result"]["data"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let ids = rows
        .iter()
        .filter_map(|row| row["id"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        ["codex-1", "0199a3c4-0000-7000-8000-000000000001", "codex-2"]
    );
    assert!(
        rows.iter()
            .all(|row| row["codewideAgent"]["provider"].is_string())
    );
    assert_eq!(rows[1]["modelProvider"], "fake-models");
    let cursor = first["result"]["nextCursor"]
        .as_str()
        .ok_or("composite cursor")?
        .to_owned();
    assert!(cursor.starts_with("cwl1."));
    let lead_requests = harness
        .observed
        .try_recv()
        .ok()
        .filter(|request| request["method"] == "thread/list")
        .ok_or("lead thread/list was not forwarded")?;
    assert_eq!(lead_requests["params"]["cursor"], Value::Null);
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn model_list_merges_catalogs_with_one_default() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let models = harness
        .rpc("models", "model/list", json!({"limit": 100}))
        .await?;
    let rows = models["result"]["data"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["codewideAgentProvider"], "codex");
    assert_eq!(rows[1]["codewideAgentProvider"], FAKE);
    assert_eq!(rows[1]["displayName"], "Default (recommended)");
    assert_eq!(
        rows.iter().filter(|row| row["isDefault"] == true).count(),
        1
    );
    assert_eq!(rows[0]["isDefault"], true);
    assert!(
        models["result"]
            .get("codewideAgentProvidersUnavailable")
            .is_none()
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn model_list_names_a_provider_whose_catalog_is_missing() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    harness.fake.status.send(ProviderStatus::Reconnecting)?;
    let models = harness
        .rpc("models", "model/list", json!({"limit": 100}))
        .await?;
    let rows = models["result"]["data"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        models["result"]["codewideAgentProvidersUnavailable"],
        json!([FAKE])
    );
    harness.stop();
    Ok(())
}

#[tokio::test]
async fn agent_providers_read_lists_providers_and_journals_changes() -> TestResult {
    let mut harness = Harness::start(default_answer, |_| Vec::new()).await?;
    let read = harness
        .rpc("providers", "companion/agentProviders/read", json!({}))
        .await?;
    let providers = read["result"]["providers"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let summary = providers
        .iter()
        .map(|row| {
            (
                row["id"].clone(),
                row["primary"].clone(),
                row["status"].clone(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        summary,
        vec![
            (json!("codex"), json!(true), json!("live")),
            (json!(FAKE), json!(false), json!("live")),
        ]
    );
    assert_eq!(providers[1]["auth"], "unknown");
    assert!(providers[1]["capabilities"].is_object());
    assert_eq!(read["result"]["hostCapabilities"]["realtimeVoice"], true);
    harness.fake.status.send(ProviderStatus::Reconnecting)?;
    let changed = harness
        .event_where(|payload| payload["method"] == "companion/agentProviders/changed")
        .await?;
    assert_eq!(changed["params"]["providers"][1]["status"], "reconnecting");
    harness.stop();
    Ok(())
}
