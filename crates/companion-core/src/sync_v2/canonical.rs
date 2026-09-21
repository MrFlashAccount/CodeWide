//! Binding RFC 8785 canonical JSON used by cursors and command identity.

use serde::Serialize;

pub fn to_vec(value: &impl Serialize) -> Result<Vec<u8>, serde_json::Error> {
    serde_json_canonicalizer::to_vec(value)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn follows_the_rfc_8785_number_and_key_representation() {
        let value = json!({"z": 1.0, "a": {"y": 2, "x": 3}});
        let encoded = super::to_vec(&value).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(encoded, br#"{"a":{"x":3,"y":2},"z":1}"#);
    }
}
