//! Runtime validators compiled directly from the executable V2 contract.

use std::sync::LazyLock;

use jsonschema::Validator;
use serde_json::{Value, json};

const CONTRACT: &str = include_str!("../../contract/v2.json");

static CLIENT: LazyLock<Validator> = LazyLock::new(|| validator("clientFrame"));
static SERVER: LazyLock<Validator> = LazyLock::new(|| validator("serverFrame"));

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
    CLIENT.is_valid(value)
}

#[must_use]
pub fn valid_server(value: &Value) -> bool {
    SERVER.is_valid(value)
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
