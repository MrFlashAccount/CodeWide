//! Structural access to Claude's JSON records. Stored session rows and live
//! stream frames spell some fields differently (`toolUseResult` in a file,
//! `tool_use_result` on the wire); readers ask for both spellings and take
//! whichever is present. Pure.

use serde_json::{Map, Value};

/// One JSON object.
pub type JsonRecord = Map<String, Value>;

/// The object `value` is, if it is one.
#[must_use]
pub fn record(value: &Value) -> Option<&JsonRecord> {
    value.as_object()
}

/// A string field.
#[must_use]
pub fn str_of<'a>(record: &'a JsonRecord, name: &str) -> Option<&'a str> {
    record.get(name).and_then(Value::as_str)
}

/// A string field under either spelling.
#[must_use]
pub fn str_of2<'a>(record: &'a JsonRecord, name: &str, alias: &str) -> Option<&'a str> {
    str_of(record, name).or_else(|| str_of(record, alias))
}

/// A field under either spelling.
#[must_use]
pub fn field<'a>(record: &'a JsonRecord, name: &str, alias: &str) -> Option<&'a Value> {
    record.get(name).or_else(|| record.get(alias))
}

/// An integer field. Counts and indexes are written as integers; a
/// fractional number is no integer and reads as absent.
#[must_use]
pub fn int_of(record: &JsonRecord, name: &str) -> Option<i64> {
    record.get(name).and_then(Value::as_i64)
}

/// A boolean field that is exactly `true`.
#[must_use]
pub fn is_true(record: &JsonRecord, name: &str) -> bool {
    record.get(name).and_then(Value::as_bool) == Some(true)
}

/// A boolean field that is exactly `true` under either spelling.
#[must_use]
pub fn is_true2(record: &JsonRecord, name: &str, alias: &str) -> bool {
    is_true(record, name) || is_true(record, alias)
}

/// An array field, empty when absent or not an array.
#[must_use]
pub fn arr_of<'a>(record: &'a JsonRecord, name: &str) -> &'a [Value] {
    record
        .get(name)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// An object field.
#[must_use]
pub fn record_of<'a>(record: &'a JsonRecord, name: &str) -> Option<&'a JsonRecord> {
    record.get(name).and_then(Value::as_object)
}

/// The elements of `value` when it is an array, else none.
#[must_use]
pub fn elements(value: Option<&Value>) -> &[Value] {
    value.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}
