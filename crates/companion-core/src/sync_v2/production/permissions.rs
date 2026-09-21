//! Closed App Server permission-profile mappings for Sync V2 approvals.

#![allow(clippy::wildcard_imports)]

use super::helpers::{optional_string, required_string_field};
use super::*;

pub(super) fn permission_profile(value: &Value) -> Result<PermissionProfile, V2Error> {
    let network = value
        .get("network")
        .and_then(Value::as_object)
        .map(|network| NetworkPermissions {
            enabled: network.get("enabled").and_then(Value::as_bool),
        });
    let file_system = match value.get("fileSystem") {
        None | Some(Value::Null) => None,
        Some(file_system) => Some(FileSystemPermissions {
            read: optional_string_array(file_system, "read")?,
            write: optional_string_array(file_system, "write")?,
            glob_scan_max_depth: file_system.get("globScanMaxDepth").and_then(Value::as_i64),
            entries: file_system
                .get("entries")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(permission_entry)
                .collect::<Result<Vec<_>, _>>()?,
        }),
    };
    Ok(PermissionProfile {
        network,
        file_system,
    })
}

fn optional_string_array(value: &Value, field: &str) -> Result<Option<Vec<String>>, V2Error> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| V2Error::source_unavailable("permission path is invalid"))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(V2Error::source_unavailable(
            "permission path list is invalid",
        )),
    }
}

fn permission_entry(value: &Value) -> Result<FileSystemPermissionEntry, V2Error> {
    let access = match value.get("access").and_then(Value::as_str) {
        Some("read") => FileSystemAccessMode::Read,
        Some("write") => FileSystemAccessMode::Write,
        Some("deny") => FileSystemAccessMode::Deny,
        _ => return Err(V2Error::source_unavailable("permission access is invalid")),
    };
    Ok(FileSystemPermissionEntry {
        path: permission_path(
            value
                .get("path")
                .ok_or_else(|| V2Error::source_unavailable("permission entry omitted path"))?,
        )?,
        access,
    })
}

fn permission_path(value: &Value) -> Result<FileSystemPath, V2Error> {
    match value.get("type").and_then(Value::as_str) {
        Some("path") => Ok(FileSystemPath::Path {
            path: required_string_field(value, "path", "permission path")?,
        }),
        Some("glob_pattern") => Ok(FileSystemPath::GlobPattern {
            pattern: required_string_field(value, "pattern", "permission path")?,
        }),
        Some("special") => Ok(FileSystemPath::Special {
            value: permission_special_path(value.get("value").ok_or_else(|| {
                V2Error::source_unavailable("special permission path omitted value")
            })?)?,
        }),
        _ => Err(V2Error::source_unavailable(
            "permission path type is invalid",
        )),
    }
}

fn permission_special_path(value: &Value) -> Result<FileSystemSpecialPath, V2Error> {
    Ok(match value.get("kind").and_then(Value::as_str) {
        Some("root") => FileSystemSpecialPath::Root,
        Some("minimal") => FileSystemSpecialPath::Minimal,
        Some("project_roots") => FileSystemSpecialPath::ProjectRoots {
            subpath: optional_string(value, "subpath")?,
        },
        Some("tmpdir") => FileSystemSpecialPath::Tmpdir,
        Some("slash_tmp") => FileSystemSpecialPath::SlashTmp,
        Some("unknown") => FileSystemSpecialPath::Unknown {
            path: required_string_field(value, "path", "special permission path")?,
            subpath: optional_string(value, "subpath")?,
        },
        _ => {
            return Err(V2Error::source_unavailable(
                "special permission path is invalid",
            ));
        }
    })
}

pub(super) fn permission_profile_source(profile: &PermissionProfile) -> Value {
    let mut result = serde_json::Map::new();
    if let Some(network) = &profile.network {
        result.insert("network".to_owned(), json!({"enabled": network.enabled}));
    }
    if let Some(file_system) = &profile.file_system {
        let mut source = serde_json::Map::from_iter([
            ("read".to_owned(), json!(file_system.read)),
            ("write".to_owned(), json!(file_system.write)),
            (
                "entries".to_owned(),
                Value::Array(
                    file_system
                        .entries
                        .iter()
                        .map(permission_entry_source)
                        .collect(),
                ),
            ),
        ]);
        if let Some(depth) = file_system.glob_scan_max_depth {
            source.insert("globScanMaxDepth".to_owned(), json!(depth));
        }
        result.insert("fileSystem".to_owned(), Value::Object(source));
    }
    Value::Object(result)
}

fn permission_entry_source(entry: &FileSystemPermissionEntry) -> Value {
    let access = match entry.access {
        FileSystemAccessMode::Read => "read",
        FileSystemAccessMode::Write => "write",
        FileSystemAccessMode::Deny => "deny",
    };
    json!({"path": permission_path_source(&entry.path), "access": access})
}

fn permission_path_source(path: &FileSystemPath) -> Value {
    match path {
        FileSystemPath::Path { path } => json!({"type": "path", "path": path}),
        FileSystemPath::GlobPattern { pattern } => {
            json!({"type": "glob_pattern", "pattern": pattern})
        }
        FileSystemPath::Special { value } => {
            json!({"type": "special", "value": permission_special_path_source(value)})
        }
    }
}

fn permission_special_path_source(path: &FileSystemSpecialPath) -> Value {
    match path {
        FileSystemSpecialPath::Root => json!({"kind": "root"}),
        FileSystemSpecialPath::Minimal => json!({"kind": "minimal"}),
        FileSystemSpecialPath::ProjectRoots { subpath } => {
            json!({"kind": "project_roots", "subpath": subpath})
        }
        FileSystemSpecialPath::Tmpdir => json!({"kind": "tmpdir"}),
        FileSystemSpecialPath::SlashTmp => json!({"kind": "slash_tmp"}),
        FileSystemSpecialPath::Unknown { path, subpath } => {
            json!({"kind": "unknown", "path": path, "subpath": subpath})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn granted_profile_omits_absent_optional_objects_and_depth() {
        assert_eq!(
            permission_profile_source(&PermissionProfile {
                network: None,
                file_system: None,
            }),
            json!({})
        );

        let source = permission_profile_source(&PermissionProfile {
            network: Some(NetworkPermissions { enabled: None }),
            file_system: Some(FileSystemPermissions {
                read: None,
                write: Some(vec!["/workspace".to_owned()]),
                glob_scan_max_depth: None,
                entries: Vec::new(),
            }),
        });
        assert_eq!(source.pointer("/network/enabled"), Some(&Value::Null));
        assert_eq!(source.pointer("/fileSystem/read"), Some(&Value::Null));
        assert!(source.pointer("/fileSystem/globScanMaxDepth").is_none());
    }
}
