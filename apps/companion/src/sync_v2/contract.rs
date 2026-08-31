//! Runtime validators compiled directly from the executable V2 contract.

use std::{collections::HashMap, sync::LazyLock};

use jsonschema::Validator;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

const CONTRACT: &str = include_str!("../../contract/v2.json");

const RUNTIME_DEFINITIONS: &[&str] = &[
    "clientFrame",
    "serverFrame",
    "query",
    "command",
    "action",
    "queryResult",
    "commandResult",
    "actionResult",
    "operationReceipt",
    "inputBlock",
    "item",
    "pendingRequest",
    "projectionChange",
    "threadUpdate",
    "queueMutation",
    "accountChange",
    "requestResolution",
    "v2Error",
    "fileLocation",
    "previewLocation",
    "contentLocation",
    "mediaMaterializeRequest",
    "mediaMaterializeResponse",
    "portDescriptor",
    "portsResponse",
    "tunnelCreateRequest",
    "tunnelCreateResponse",
    "terminalClientRecord",
    "terminalServerRecord",
    "voiceInputScope",
    "voiceClientRecord",
    "voiceServerRecord",
    "transportError",
];

static DEFINITIONS: LazyLock<HashMap<&'static str, Validator>> = LazyLock::new(|| {
    RUNTIME_DEFINITIONS
        .iter()
        .copied()
        .map(|definition| (definition, validator(definition)))
        .collect()
});

#[expect(
    clippy::panic,
    reason = "an invalid embedded contract is a build defect and cannot be recovered at runtime"
)]
fn validator(definition: &str) -> Validator {
    let mut schema: Value = serde_json::from_str(CONTRACT)
        .unwrap_or_else(|error| panic!("invalid embedded Sync V2 contract: {error}"));
    schema["oneOf"] = json!([{ "$ref": format!("#/$defs/{definition}") }]);
    jsonschema::draft202012::options()
        .should_validate_formats(true)
        .build(&schema)
        .unwrap_or_else(|error| panic!("invalid Sync V2 {definition} schema: {error}"))
}

#[must_use]
pub fn valid_client(value: &Value) -> bool {
    valid_definition("clientFrame", value)
}

#[must_use]
pub fn valid_server(value: &Value) -> bool {
    valid_definition("serverFrame", value)
}

#[must_use]
pub(crate) fn valid_definition(definition: &str, value: &Value) -> bool {
    DEFINITIONS
        .get(definition)
        .is_some_and(|validator| validator.is_valid(value))
}

pub(crate) fn parse_definition<T: DeserializeOwned>(definition: &str, text: &str) -> Result<T, ()> {
    let value: Value = serde_json::from_str(text).map_err(|_| ())?;
    if !valid_definition(definition, &value) {
        return Err(());
    }
    serde_json::from_value(value).map_err(|_| ())
}

pub(crate) fn serialize_definition<T: Serialize>(
    definition: &str,
    value: &T,
) -> Result<String, ()> {
    let value = serde_json::to_value(value).map_err(|_| ())?;
    if !valid_definition(definition, &value) {
        return Err(());
    }
    serde_json::to_string(&value).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn required_nullable_fields_are_not_optional() {
        let valid = json!({
            "type": "command",
            "requestId": "request",
            "operationId": "operation",
            "command": {
                "kind": "turn.submit",
                "threadId": null,
                "workspace": "/tmp",
                "input": [],
                "intent": "chat",
                "settings": null
            }
        });
        assert!(super::valid_client(&valid));
        for field in ["threadId", "workspace", "settings"] {
            let mut invalid = valid.clone();
            invalid["command"]
                .as_object_mut()
                .map(|object| object.remove(field));
            assert!(
                !super::valid_client(&invalid),
                "omitted {field} was accepted"
            );
        }
    }
}
