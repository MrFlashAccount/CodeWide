//! Executable Rust Serde <-> JSON Schema conformance for auxiliary V2 transports.

#![allow(clippy::expect_used)]

use std::fmt::Debug;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use super::{
    contract,
    domain::{InputBlock, Item, PendingRequest, ProjectionChange},
    protocol::*,
};

mod variant_tags;
use variant_tags::*;

const SCHEMA: &str = include_str!("../../contract/v2.json");

#[test]
fn every_auxiliary_transport_variant_round_trips_through_the_schema() {
    assert_case::<FileLocation>("fileLocation", &json!({"rootId":"root","path":"file.txt"}));
    assert_case::<PreviewLocation>("previewLocation", &json!({"path":"file.txt"}));
    assert_case::<ContentLocation>("contentLocation", &json!({"offset":0,"limit":1024}));
    assert_case::<MediaMaterializeRequest>(
        "mediaMaterializeRequest",
        &json!({"url":"https://example.test/image.png"}),
    );
    assert_case::<MediaMaterializeResponse>(
        "mediaMaterializeResponse",
        &json!({"id":"media","expiresAt":1}),
    );
    assert_case::<PortDescriptor>(
        "portDescriptor",
        &json!({"port":3000,"name":"app","group":"dev","details":"local","process":null,"pid":null,"cwd":null,"kind":"http","forwardingKey":"localhost:3000","defaultForwardingEnabled":true}),
    );
    assert_case::<PortsResponse>("portsResponse", &json!({"ports":[],"scannedAt":1}));
    assert_case::<TunnelCreateRequest>(
        "tunnelCreateRequest",
        &json!({"port":3000,"ttlSeconds":60}),
    );
    assert_case::<TunnelCreateResponse>(
        "tunnelCreateResponse",
        &json!({"id":"tunnel","expiresAt":1,"basePath":"/v2/tunnels/tunnel/"}),
    );

    let terminal_clients = [
        json!({"type":"open","version":2,"sessionId":"terminal-session","threadId":"thread","generation":"1","cwd":null,"cols":120,"rows":40,"offset":"0","create":true}),
        json!({"type":"input","data":"YQ=="}),
        json!({"type":"resize","cols":100,"rows":30}),
        json!({"type":"close"}),
    ];
    assert_registry::<TerminalClientRecord>(
        "terminalClientRecord",
        terminal_clients,
        terminal_client_tag,
    );
    let terminal_servers = [
        json!({"type":"opened","sessionId":"terminal-session","generation":"1","offset":"0"}),
        json!({"type":"output","offset":"0","data":"YQ=="}),
        json!({"type":"exited","offset":"1"}),
        json!({"type":"error","error":{"code":"replayUnavailable","message":"replay unavailable"}}),
    ];
    assert_registry::<TerminalServerRecord>(
        "terminalServerRecord",
        terminal_servers,
        terminal_server_tag,
    );

    for scope in [
        json!({"kind":"generic","id":"composer"}),
        json!({"kind":"chat","id":"composer"}),
        json!({"kind":"review","id":"composer"}),
    ] {
        assert_case::<VoiceInputScope>("voiceInputScope", &scope);
    }
    let voice_clients = [
        json!({"type":"start","version":2,"generation":"1","inputScope":{"kind":"generic","id":"composer"},"threadId":null,"language":null}),
        json!({"type":"batch","sessionId":"voice-session","sequence":"0","sampleRate":48000,"numChannels":1,"samplesPerChannel":1,"data":"AAAAAA=="}),
        json!({"type":"finish","sessionId":"voice-session"}),
        json!({"type":"cancel","sessionId":"voice-session"}),
    ];
    assert_registry::<VoiceClientRecord>("voiceClientRecord", voice_clients, voice_client_tag);
    let voice_servers = [
        json!({"type":"started","sessionId":"voice-session","generation":"1"}),
        json!({"type":"ack","sessionId":"voice-session","sequence":"0"}),
        json!({"type":"result","sessionId":"voice-session","text":"result"}),
        json!({"type":"retry","sessionId":"voice-session","retryAfterMs":10}),
        json!({"type":"cancelled","sessionId":"voice-session"}),
        json!({"type":"error","sessionId":"voice-session","error":{"code":"unavailable","message":"unavailable"}}),
    ];
    assert_registry::<VoiceServerRecord>("voiceServerRecord", voice_servers, voice_server_tag);
}

#[test]
fn every_sync_variant_round_trips_through_the_schema() {
    assert_generated_registry::<InputBlock>("inputBlock", input_block_tag);
    assert_generated_registry::<Item>("item", item_tag);
    assert_generated_registry::<PendingRequest>("pendingRequest", pending_request_tag);
    assert_generated_registry::<ProjectionChange>("projectionChange", projection_change_tag);
    assert_generated_registry::<ClientFrame>("clientFrame", client_frame_tag);
    assert_generated_registry::<Query>("query", query_tag);
    assert_generated_registry::<Command>("command", command_tag);
    assert_generated_registry::<Action>("action", action_tag);
    assert_generated_registry::<ServerFrame>("serverFrame", server_frame_tag);
    assert_generated_registry::<QueryResult>("queryResult", query_result_tag);
    assert_generated_registry::<CommandResult>("commandResult", command_result_tag);
    assert_generated_registry::<ActionResult>("actionResult", action_result_tag);
    assert_generated_registry::<OperationReceipt>("operationReceipt", operation_receipt_tag);
    assert_generated_registry::<ThreadUpdate>("threadUpdate", thread_update_tag);
    assert_generated_registry::<QueueMutation>("queueMutation", queue_mutation_tag);
    assert_generated_registry::<AccountChange>("accountChange", account_change_tag);
    assert_generated_registry::<RequestResolution>("requestResolution", request_resolution_tag);
    assert_generated_registry::<V2Error>("v2Error", v2_error_tag);
}

#[test]
fn schema_variant_registries_match_rust_owned_exhaustive_registries() {
    assert_schema_tags(
        "clientFrame",
        &[
            "open",
            "snapshotCommitted",
            "threadWatch",
            "query",
            "command",
            "action",
            "ping",
        ],
    );
    let queries = &[
        "capabilities.read",
        "models.list",
        "catalog.page",
        "history.page",
        "turn.items",
        "thread.resources",
        "projects.list",
        "workspace.inspect",
        "queue.list",
        "operation.get",
        "accounts.list",
    ];
    assert_schema_tags("query", queries);
    assert_schema_tags("queryResult", queries);
    let commands = &[
        "thread.create",
        "thread.fork",
        "thread.update",
        "thread.delete",
        "turn.submit",
        "turn.steer",
        "turn.interrupt",
        "thread.compact",
        "thread.rollback",
        "project.add",
        "workspace.create",
        "queue.mutate",
        "account.update",
    ];
    assert_schema_tags("command", commands);
    assert_schema_tags("commandResult", commands);
    assert_schema_tags("action", &["request.resolve"]);
    assert_schema_tags("actionResult", &["request.resolve"]);
    assert_schema_tags(
        "serverFrame",
        &[
            "snapshot",
            "change",
            "live",
            "reinitialize",
            "threadWatched",
            "threadWatchFailed",
            "queryCompleted",
            "queryFailed",
            "commandRejected",
            "commandExpired",
            "commandAccepted",
            "commandCompleted",
            "commandFailed",
            "commandIndeterminate",
            "actionCompleted",
            "actionFailed",
            "pong",
        ],
    );
    assert_schema_tags(
        "operationReceipt",
        &[
            "admitted",
            "completed",
            "failed",
            "indeterminate",
            "expired",
        ],
    );
}

fn assert_schema_tags(definition: &str, rust_owned: &[&str]) {
    let mut schema = schema_variant_tags(definition);
    schema.sort_unstable();
    let mut rust_owned = rust_owned
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    rust_owned.sort_unstable();
    assert_eq!(
        schema, rust_owned,
        "schema/Rust registry drifted for {definition}"
    );
}

fn assert_generated_registry<T>(definition: &str, tag: fn(&T) -> &'static str)
where
    T: DeserializeOwned + Serialize + Debug,
{
    let schema: Value = serde_json::from_str(SCHEMA).expect("contract JSON");
    let variants = variant_nodes(&schema, definition);
    let mut actual = Vec::new();
    for variant in variants {
        for sample in synthesize_variants(&schema, variant) {
            let value = assert_case::<T>(definition, &sample);
            actual.push(tag(&value).to_owned());
        }
    }
    actual.sort_unstable();
    actual.dedup();
    let mut expected = schema_variant_tags(definition);
    expected.sort_unstable();
    assert_eq!(actual, expected, "Rust registry drifted from {definition}");
}

fn synthesize_variants(schema: &Value, node: &Value) -> Vec<Value> {
    let node = resolve_ref(schema, node);
    if let Some(values) = node.get("enum").and_then(Value::as_array) {
        return values.clone();
    }
    if let Some(branches) = node.get("oneOf").and_then(Value::as_array) {
        return branches
            .iter()
            .flat_map(|branch| synthesize_variants(schema, branch))
            .collect();
    }
    if node.get("type").and_then(Value::as_str) == Some("object") {
        for tag in ["type", "kind", "state", "code"] {
            if let Some(values) = node["properties"][tag]["enum"].as_array() {
                return values
                    .iter()
                    .map(|value| {
                        let mut sample = synthesize(schema, node);
                        sample[tag] = value.clone();
                        sample
                    })
                    .collect();
            }
        }
    }
    vec![synthesize(schema, node)]
}

fn synthesize(schema: &Value, node: &Value) -> Value {
    let node = resolve_ref(schema, node);
    if let Some(value) = node.get("const") {
        return value.clone();
    }
    if let Some(value) = node
        .get("enum")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
    {
        return value.clone();
    }
    if let Some(branches) = node.get("oneOf").and_then(Value::as_array) {
        let branch = branches
            .iter()
            .find(|branch| {
                resolve_ref(schema, branch).get("type") != Some(&Value::String("null".to_owned()))
            })
            .or_else(|| branches.first())
            .expect("oneOf branch");
        return synthesize(schema, branch);
    }
    if let Some(types) = node.get("type").and_then(Value::as_array) {
        let selected = types
            .iter()
            .find(|kind| kind.as_str() != Some("null"))
            .or_else(|| types.first())
            .expect("schema type");
        let mut narrowed = node.clone();
        narrowed["type"] = selected.clone();
        return synthesize(schema, &narrowed);
    }
    match node.get("type").and_then(Value::as_str) {
        Some("object") => {
            let mut object = serde_json::Map::new();
            for field in node["properties"]
                .as_object()
                .expect("object properties")
                .keys()
            {
                object.insert(
                    field.to_owned(),
                    synthesize(schema, &node["properties"][field]),
                );
            }
            Value::Object(object)
        }
        Some("array") => node.get("items").map_or_else(
            || Value::Array(Vec::new()),
            |items| Value::Array(vec![synthesize(schema, items)]),
        ),
        Some("integer" | "number") => node.get("minimum").cloned().unwrap_or_else(|| json!(0)),
        Some("boolean") => Value::Bool(false),
        Some("null") => Value::Null,
        Some("string") => {
            let value = match node.get("format").and_then(Value::as_str) {
                Some("date-time") => "2026-01-01T00:00:00Z".to_owned(),
                Some("uri") => "https://example.test/resource".to_owned(),
                _ if node.get("contentEncoding").and_then(Value::as_str) == Some("base64") => {
                    "YQ==".to_owned()
                }
                _ if node.get("pattern").and_then(Value::as_str) == Some("^sync-v2-revision:") => {
                    "sync-v2-revision:x".to_owned()
                }
                _ if node
                    .get("pattern")
                    .and_then(Value::as_str)
                    .is_some_and(|pattern| pattern.contains("[0-9]")) =>
                {
                    "0".to_owned()
                }
                _ => "x".repeat(
                    node.get("minLength")
                        .and_then(Value::as_u64)
                        .and_then(|length| usize::try_from(length).ok())
                        .unwrap_or(1),
                ),
            };
            Value::String(value)
        }
        kind => panic!("unsupported schema node type {kind:?}: {node}"),
    }
}

fn assert_registry<T>(
    definition: &str,
    samples: impl IntoIterator<Item = Value>,
    tag: fn(&T) -> &'static str,
) where
    T: DeserializeOwned + Serialize + Debug,
{
    let mut actual = Vec::new();
    for sample in samples {
        let value = assert_case::<T>(definition, &sample);
        actual.push(tag(&value).to_owned());
    }
    actual.sort_unstable();
    actual.dedup();

    let mut expected = schema_variant_tags(definition);
    expected.sort_unstable();
    assert_eq!(actual, expected, "Rust registry drifted from {definition}");
}

fn assert_case<T>(definition: &str, sample: &Value) -> T
where
    T: DeserializeOwned + Serialize + Debug,
{
    assert!(
        contract::valid_definition(definition, sample),
        "schema rejected {definition}: {sample}",
    );
    let value: T =
        serde_json::from_value(sample.clone()).expect("schema-valid sample must deserialize");
    let encoded = serde_json::to_value(&value).expect("Rust DTO must serialize");
    assert!(contract::valid_definition(definition, &encoded));
    assert_recursive_schema_agreement::<T>(definition, &encoded);
    value
}

#[derive(Clone)]
enum JsonPathPart {
    Field(String),
    Index(usize),
}

fn assert_recursive_schema_agreement<T: DeserializeOwned>(definition: &str, sample: &Value) {
    let schema: Value = serde_json::from_str(SCHEMA).expect("contract JSON");
    walk_schema_agreement::<T>(
        definition,
        &schema,
        &schema["$defs"][definition],
        sample,
        sample,
        &mut Vec::new(),
    );
}

fn walk_schema_agreement<T: DeserializeOwned>(
    definition: &str,
    schema: &Value,
    node: &Value,
    value: &Value,
    root: &Value,
    path: &mut Vec<JsonPathPart>,
) {
    let node = resolve_ref(schema, node);
    if let Some(branches) = node.get("oneOf").and_then(Value::as_array) {
        for branch in branches {
            for replacement in synthesize_variants(schema, branch) {
                let mut candidate = root.clone();
                replace_at(&mut candidate, path, replacement.clone());
                if contract::valid_definition(definition, &candidate) {
                    assert!(
                        serde_json::from_value::<T>(candidate.clone()).is_ok(),
                        "Serde rejected schema-valid {definition} oneOf mutation: {candidate}",
                    );
                    let concrete = concrete_schema_branch(schema, branch, &replacement);
                    walk_schema_agreement::<T>(
                        definition,
                        schema,
                        concrete,
                        &replacement,
                        &candidate,
                        path,
                    );
                }
            }
        }
        return;
    }
    if let Some(values) = node.get("enum").and_then(Value::as_array) {
        for enum_value in values {
            let mut candidate = root.clone();
            replace_at(&mut candidate, path, enum_value.clone());
            if contract::valid_definition(definition, &candidate) {
                assert!(
                    serde_json::from_value::<T>(candidate.clone()).is_ok(),
                    "Serde rejected schema-valid {definition} enum mutation: {candidate}",
                );
            }
        }
    }
    if let (Some(object), Some(properties)) = (value.as_object(), node["properties"].as_object()) {
        let unit_tag_only = properties.len() == 1
            && properties
                .keys()
                .all(|field| matches!(field.as_str(), "type" | "kind" | "state" | "code"));
        if !unit_tag_only {
            let mut extra = root.clone();
            value_at_mut(&mut extra, path)
                .as_object_mut()
                .expect("object path")
                .insert("__sync_v2_unknown".to_owned(), Value::Bool(true));
            let schema_accepts = contract::valid_definition(definition, &extra);
            let serde_accepts = serde_json::from_value::<T>(extra.clone()).is_ok();
            if schema_accepts {
                assert!(
                    serde_accepts,
                    "Serde rejected a schema property inside {definition} at {}",
                    display_path(path),
                );
            } else {
                assert!(
                    contract::parse_definition::<T>(definition, &extra.to_string()).is_err(),
                    "the public boundary accepted an unknown field inside {definition} at {}",
                    display_path(path),
                );
            }
        }
        for field in node["required"].as_array().into_iter().flatten() {
            let field = field.as_str().expect("required field name");
            let mut missing = root.clone();
            value_at_mut(&mut missing, path)
                .as_object_mut()
                .expect("object path")
                .remove(field);
            let schema_accepts = contract::valid_definition(definition, &missing);
            let serde_accepts = serde_json::from_value::<T>(missing).is_ok();
            assert_eq!(
                serde_accepts,
                schema_accepts,
                "schema/Serde required-field drift for {definition}.{}.{field}",
                display_path(path),
            );
        }
        for (field, child) in object {
            if let Some(child_schema) = properties.get(field) {
                path.push(JsonPathPart::Field(field.clone()));
                walk_schema_agreement::<T>(definition, schema, child_schema, child, root, path);
                path.pop();
            }
        }
    } else if let (Some(values), Some(items)) = (value.as_array(), node.get("items")) {
        for (index, child) in values.iter().enumerate() {
            path.push(JsonPathPart::Index(index));
            walk_schema_agreement::<T>(definition, schema, items, child, root, path);
            path.pop();
        }
    }
}

fn concrete_schema_branch<'a>(schema: &'a Value, node: &'a Value, value: &Value) -> &'a Value {
    let mut current = resolve_ref(schema, node);
    while let Some(branches) = current.get("oneOf").and_then(Value::as_array) {
        current = branches
            .iter()
            .find(|branch| schema_branch_matches(schema, branch, value))
            .map(|branch| resolve_ref(schema, branch))
            .expect("synthesized oneOf value must select a schema branch");
    }
    current
}

fn schema_branch_matches(schema: &Value, branch: &Value, value: &Value) -> bool {
    let branch = resolve_ref(schema, branch);
    if branch.get("type").and_then(Value::as_str) == Some("null") {
        return value.is_null();
    }
    if let Some(object) = value.as_object() {
        return ["type", "kind", "state", "code"].into_iter().any(|tag| {
            object.get(tag).is_some_and(|actual| {
                branch["properties"][tag]["const"] == *actual
                    || branch["properties"][tag]["enum"]
                        .as_array()
                        .is_some_and(|values| values.contains(actual))
            })
        }) || branch.get("type").and_then(Value::as_str) == Some("object");
    }
    branch.get("type").is_some_and(|kind| match kind {
        Value::String(kind) => json_type_matches(kind, value),
        Value::Array(kinds) => kinds
            .iter()
            .filter_map(Value::as_str)
            .any(|kind| json_type_matches(kind, value)),
        _ => false,
    })
}

fn json_type_matches(kind: &str, value: &Value) -> bool {
    match kind {
        "null" => value.is_null(),
        "string" => value.is_string(),
        "integer" | "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        _ => false,
    }
}

fn replace_at(root: &mut Value, path: &[JsonPathPart], replacement: Value) {
    if path.is_empty() {
        *root = replacement;
    } else {
        *value_at_mut(root, path) = replacement;
    }
}

fn display_path(path: &[JsonPathPart]) -> String {
    path.iter()
        .map(|part| match part {
            JsonPathPart::Field(field) => field.clone(),
            JsonPathPart::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn value_at_mut<'a>(mut value: &'a mut Value, path: &[JsonPathPart]) -> &'a mut Value {
    for part in path {
        value = match part {
            JsonPathPart::Field(field) => &mut value[field],
            JsonPathPart::Index(index) => &mut value[*index],
        };
    }
    value
}

fn schema_variant_tags(definition: &str) -> Vec<String> {
    let schema: Value = serde_json::from_str(SCHEMA).expect("contract JSON");
    variant_nodes(&schema, definition)
        .into_iter()
        .flat_map(|branch| {
            let branch = resolve_ref(&schema, branch);
            let property = ["type", "kind", "state", "code"]
                .into_iter()
                .find_map(|tag| branch["properties"].get(tag))
                .expect("variant discriminant");
            if let Some(value) = property["const"].as_str() {
                vec![value.to_owned()]
            } else {
                property["enum"]
                    .as_array()
                    .expect("variant discriminant enum")
                    .iter()
                    .map(|value| value.as_str().expect("variant tag").to_owned())
                    .collect()
            }
        })
        .collect()
}

fn variant_nodes<'a>(schema: &'a Value, definition: &str) -> Vec<&'a Value> {
    schema["$defs"][definition]["oneOf"].as_array().map_or_else(
        || vec![&schema["$defs"][definition]],
        |branches| branches.iter().collect(),
    )
}

fn resolve_ref<'a>(schema: &'a Value, branch: &'a Value) -> &'a Value {
    let Some(reference) = branch.get("$ref").and_then(Value::as_str) else {
        return branch;
    };
    let name = reference
        .strip_prefix("#/$defs/")
        .expect("local contract definition reference");
    &schema["$defs"][name]
}

fn terminal_client_tag(value: &TerminalClientRecord) -> &'static str {
    match value {
        TerminalClientRecord::Open { .. } => "open",
        TerminalClientRecord::Input { .. } => "input",
        TerminalClientRecord::Resize { .. } => "resize",
        TerminalClientRecord::Close => "close",
    }
}

fn terminal_server_tag(value: &TerminalServerRecord) -> &'static str {
    match value {
        TerminalServerRecord::Opened { .. } => "opened",
        TerminalServerRecord::Output { .. } => "output",
        TerminalServerRecord::Exited { .. } => "exited",
        TerminalServerRecord::Error { .. } => "error",
    }
}

fn voice_client_tag(value: &VoiceClientRecord) -> &'static str {
    match value {
        VoiceClientRecord::Start { .. } => "start",
        VoiceClientRecord::Batch { .. } => "batch",
        VoiceClientRecord::Finish { .. } => "finish",
        VoiceClientRecord::Cancel { .. } => "cancel",
    }
}

fn voice_server_tag(value: &VoiceServerRecord) -> &'static str {
    match value {
        VoiceServerRecord::Started { .. } => "started",
        VoiceServerRecord::Ack { .. } => "ack",
        VoiceServerRecord::Result { .. } => "result",
        VoiceServerRecord::Retry { .. } => "retry",
        VoiceServerRecord::Cancelled { .. } => "cancelled",
        VoiceServerRecord::Error { .. } => "error",
    }
}

fn client_frame_tag(value: &ClientFrame) -> &'static str {
    match value {
        ClientFrame::Open { .. } => "open",
        ClientFrame::SnapshotCommitted { .. } => "snapshotCommitted",
        ClientFrame::ThreadWatch { .. } => "threadWatch",
        ClientFrame::Query { .. } => "query",
        ClientFrame::Command { .. } => "command",
        ClientFrame::Action { .. } => "action",
        ClientFrame::Ping { .. } => "ping",
    }
}

fn query_tag(value: &Query) -> &'static str {
    match value {
        Query::CapabilitiesRead => "capabilities.read",
        Query::ModelsList => "models.list",
        Query::CatalogPage { .. } => "catalog.page",
        Query::HistoryPage { .. } => "history.page",
        Query::TurnItems { .. } => "turn.items",
        Query::ThreadResources { .. } => "thread.resources",
        Query::ProjectsList => "projects.list",
        Query::WorkspaceInspect { .. } => "workspace.inspect",
        Query::QueueList { .. } => "queue.list",
        Query::OperationGet { .. } => "operation.get",
        Query::AccountsList => "accounts.list",
    }
}

fn command_tag(value: &Command) -> &'static str {
    match value {
        Command::ThreadCreate { .. } => "thread.create",
        Command::ThreadFork { .. } => "thread.fork",
        Command::ThreadUpdate { .. } => "thread.update",
        Command::ThreadDelete { .. } => "thread.delete",
        Command::TurnSubmit { .. } => "turn.submit",
        Command::TurnSteer { .. } => "turn.steer",
        Command::TurnInterrupt { .. } => "turn.interrupt",
        Command::ThreadCompact { .. } => "thread.compact",
        Command::ThreadRollback { .. } => "thread.rollback",
        Command::ProjectAdd { .. } => "project.add",
        Command::WorkspaceCreate { .. } => "workspace.create",
        Command::QueueMutate { .. } => "queue.mutate",
        Command::AccountUpdate { .. } => "account.update",
    }
}

fn action_tag(value: &Action) -> &'static str {
    match value {
        Action::RequestResolve { .. } => "request.resolve",
    }
}

fn server_frame_tag(value: &ServerFrame) -> &'static str {
    match value {
        ServerFrame::Snapshot { .. } => "snapshot",
        ServerFrame::Change { .. } => "change",
        ServerFrame::Live { .. } => "live",
        ServerFrame::Reinitialize { .. } => "reinitialize",
        ServerFrame::ThreadWatched { .. } => "threadWatched",
        ServerFrame::ThreadWatchFailed { .. } => "threadWatchFailed",
        ServerFrame::QueryCompleted { .. } => "queryCompleted",
        ServerFrame::QueryFailed { .. } => "queryFailed",
        ServerFrame::CommandRejected { .. } => "commandRejected",
        ServerFrame::CommandExpired { .. } => "commandExpired",
        ServerFrame::CommandAccepted { .. } => "commandAccepted",
        ServerFrame::CommandCompleted { .. } => "commandCompleted",
        ServerFrame::CommandFailed { .. } => "commandFailed",
        ServerFrame::CommandIndeterminate { .. } => "commandIndeterminate",
        ServerFrame::ActionCompleted { .. } => "actionCompleted",
        ServerFrame::ActionFailed { .. } => "actionFailed",
        ServerFrame::Pong { .. } => "pong",
    }
}

fn query_result_tag(value: &QueryResult) -> &'static str {
    match value {
        QueryResult::CapabilitiesRead { .. } => "capabilities.read",
        QueryResult::ModelsList { .. } => "models.list",
        QueryResult::CatalogPage { .. } => "catalog.page",
        QueryResult::HistoryPage { .. } => "history.page",
        QueryResult::TurnItems { .. } => "turn.items",
        QueryResult::ThreadResources { .. } => "thread.resources",
        QueryResult::ProjectsList { .. } => "projects.list",
        QueryResult::WorkspaceInspect { .. } => "workspace.inspect",
        QueryResult::QueueList { .. } => "queue.list",
        QueryResult::OperationGet { .. } => "operation.get",
        QueryResult::AccountsList { .. } => "accounts.list",
    }
}

fn command_result_tag(value: &CommandResult) -> &'static str {
    match value {
        CommandResult::ThreadCreate { .. } => "thread.create",
        CommandResult::ThreadFork { .. } => "thread.fork",
        CommandResult::ThreadUpdate { .. } => "thread.update",
        CommandResult::ThreadDelete { .. } => "thread.delete",
        CommandResult::TurnSubmit { .. } => "turn.submit",
        CommandResult::TurnSteer { .. } => "turn.steer",
        CommandResult::TurnInterrupt { .. } => "turn.interrupt",
        CommandResult::ThreadCompact { .. } => "thread.compact",
        CommandResult::ThreadRollback { .. } => "thread.rollback",
        CommandResult::ProjectAdd { .. } => "project.add",
        CommandResult::WorkspaceCreate { .. } => "workspace.create",
        CommandResult::QueueMutate { .. } => "queue.mutate",
        CommandResult::AccountUpdate { .. } => "account.update",
    }
}

fn action_result_tag(value: &ActionResult) -> &'static str {
    match value {
        ActionResult::RequestResolve { .. } => "request.resolve",
    }
}

fn operation_receipt_tag(value: &OperationReceipt) -> &'static str {
    match value {
        OperationReceipt::Admitted { .. } => "admitted",
        OperationReceipt::Completed { .. } => "completed",
        OperationReceipt::Failed { .. } => "failed",
        OperationReceipt::Indeterminate { .. } => "indeterminate",
        OperationReceipt::Expired { .. } => "expired",
    }
}
