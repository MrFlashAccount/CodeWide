use codewide_host_rs::{
    auth::{contract_default_device_scopes, contract_device_scopes},
    build_shelf::PUBLIC_BUILD_SHELF_PATHS,
    sync::contract_scope_for_rpc,
    thread_patch::{THREAD_PATCH_FIELD, compile_thread_patch},
    thread_view::READ_MODEL_VERSION,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct V1Contract {
    protocol_version: u32,
    thread_read_model_version: u64,
    web_socket_paths: Vec<String>,
    http_routes: Vec<String>,
    device_scopes: Vec<String>,
    default_device_scopes: Vec<String>,
    rpc_methods: Vec<String>,
    public_build_shelf_paths: Vec<String>,
    thread_projection_patch: ThreadProjectionPatchContract,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadProjectionPatchContract {
    field: String,
    version: u32,
    operations: Vec<ThreadProjectionOperation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadProjectionOperation {
    method: String,
    kind: String,
    item_type: Option<String>,
    field: Option<String>,
    archived: Option<bool>,
}

#[test]
fn rust_reads_the_frozen_node_contract() -> Result<(), Box<dyn std::error::Error>> {
    let raw = include_str!("../../host-companion/contract/v1.json");
    let contract: V1Contract = serde_json::from_str(raw)?;

    assert_eq!(contract.protocol_version, 1);
    assert_eq!(contract.thread_read_model_version, READ_MODEL_VERSION);
    assert_eq!(contract.web_socket_paths, ["/v1/app-server", "/v1/sync"]);
    assert_eq!(contract.public_build_shelf_paths, PUBLIC_BUILD_SHELF_PATHS);
    assert_eq!(contract.thread_projection_patch.field, THREAD_PATCH_FIELD);
    assert_eq!(contract.thread_projection_patch.version, 1);
    for expected in &contract.thread_projection_patch.operations {
        let patch = compile_thread_patch(&json!({
            "method": expected.method,
            "params": {"threadId": "thread"}
        }))
        .unwrap_or_else(|| panic!("Rust patch compiler is missing {}", expected.method));
        assert_eq!(patch["version"], contract.thread_projection_patch.version);
        assert_eq!(patch["operation"]["kind"], expected.kind);
        assert_eq!(
            patch["operation"]
                .get("itemType")
                .and_then(|value| value.as_str()),
            expected.item_type.as_deref()
        );
        assert_eq!(
            patch["operation"]
                .get("field")
                .and_then(|value| value.as_str()),
            expected.field.as_deref()
        );
        assert_eq!(
            patch["operation"].get("archived").and_then(Value::as_bool),
            expected.archived
        );
    }
    assert_eq!(
        contract_scope_for_rpc("account/rateLimits/read"),
        Some("threads.read")
    );
    assert_eq!(contract.http_routes.len(), 18);
    assert_eq!(
        contract.device_scopes,
        contract_device_scopes()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        contract.default_device_scopes,
        contract_default_device_scopes()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
    for method in &contract.rpc_methods {
        if matches!(method.as_str(), "initialize" | "initialized") {
            continue;
        }
        assert!(
            contract_scope_for_rpc(method).is_some(),
            "frozen V1 RPC is missing from Rust policy: {method}"
        );
    }
    Ok(())
}
