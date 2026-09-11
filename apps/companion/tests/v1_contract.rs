use codewide_companion::{
    build_shelf::PUBLIC_BUILD_SHELF_PATHS,
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
    rpc_policy: RpcPolicy,
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
struct RpcPolicy {
    method_filter: String,
    unknown_method_handling: String,
    passive_mode: String,
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
fn companion_implements_the_frozen_v1_contract() -> Result<(), Box<dyn std::error::Error>> {
    let raw = include_str!("../contract/v1.json");
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
        .unwrap_or_else(|| panic!("patch compiler is missing {}", expected.method));
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
    assert_eq!(contract.http_routes.len(), 20);
    assert_eq!(contract.rpc_policy.method_filter, "none");
    assert_eq!(
        contract.rpc_policy.unknown_method_handling,
        "forwardToAppServer"
    );
    assert_eq!(contract.rpc_policy.passive_mode, "noRpc");
    Ok(())
}
