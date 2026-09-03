//! Owner-bound resource pagination and authorized file previews.

use std::path::{Component, PathBuf};

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};

use super::*;

impl UpstreamSemanticSource {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn thread_resources(
        &self,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
        thread_id: Id,
        scope: ResourceScope,
        cursor: Option<String>,
        limit: u16,
    ) -> Result<QueryResult, V2Error> {
        require_scope(authorization, "threads.read")?;
        self.authorize_thread_access(authorization, context, &thread_id, generation)
            .await?;
        let resources = self
            .services
            .resources
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("resource service is unavailable"))?;
        let result = resources
            .handle(
                "companion/threadResources/read",
                &json!({"threadId": thread_id.as_str(), "changeScope": resource_scope(scope)}),
            )
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let changes = normalize::resource_changes(&result)?;
        let attachments = normalize::attachments(&result)?;
        let witness = result
            .get("revision")
            .and_then(Value::as_str)
            .ok_or_else(|| V2Error::source_unavailable("resource result omitted revision"))?
            .to_owned();
        let offset = match cursor.as_deref() {
            Some(value) => {
                let decoded = ResourceCursor::decode(value, context, &thread_id, scope)?;
                if decoded.witness() != witness {
                    return Err(stale_resource_cursor());
                }
                decoded.offset()
            }
            None => 0,
        };
        let total = changes.len().saturating_add(attachments.len());
        if offset > total {
            return Err(stale_resource_cursor());
        }
        let page = resource_page(changes.len(), attachments.len(), offset, usize::from(limit))?;
        let page_changes = if page.change_start < page.change_end {
            changes[page.change_start..page.change_end].to_vec()
        } else {
            Vec::new()
        };
        let page_attachments = if page.attachment_start < page.attachment_end {
            attachments[page.attachment_start..page.attachment_end].to_vec()
        } else {
            Vec::new()
        };
        let next = if page.next_offset < total {
            Some(
                ResourceCursor::new(
                    context,
                    thread_id.clone(),
                    scope,
                    witness.clone(),
                    page.next_offset,
                )
                .encode()?,
            )
        } else {
            None
        };
        let effective_scope = parse_resource_scope(
            result
                .get("changeScope")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    V2Error::source_unavailable("resource result omitted effective scope")
                })?,
        )?;
        let available_scopes = result
            .get("changeScopes")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("resource result omitted available scopes"))?
            .iter()
            .map(|value| {
                parse_resource_scope(
                    value
                        .as_str()
                        .ok_or_else(|| V2Error::source_unavailable("resource scope is invalid"))?,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let supports_detached_review = self
            .read_thread_record(&thread_id)
            .await?
            .supports_detached_review;
        Ok(QueryResult::ThreadResources {
            thread_id,
            revision: witness,
            scope: effective_scope,
            available_scopes,
            review: review_capabilities(supports_detached_review),
            changes: page_changes,
            attachments: page_attachments,
            next,
        })
    }

    pub(super) async fn workspace_file(
        &self,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
        thread_id: Id,
        path: String,
    ) -> Result<QueryResult, V2Error> {
        require_scope(authorization, "threads.read")?;
        self.authorize_thread_access(authorization, context, &thread_id, generation)
            .await?;
        let resources = self
            .services
            .resources
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("resource service is unavailable"))?;
        let requested = authorized_file_path(authorization, &path)?;
        let (absolute, returned_path, size_bytes, media_type) = if requested.is_absolute() {
            let (size_bytes, media_type) = resources
                .host_preview_metadata(requested.clone())
                .await
                .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
            (requested, path, size_bytes, media_type)
        } else {
            let relative = normalized_workspace_relative_path(&path)?;
            let thread = self.read_thread(&thread_id).await?;
            let workspace = PathBuf::from(&thread.workspace);
            if !workspace.is_absolute() {
                return Err(V2Error::source_unavailable(
                    "thread workspace is not an absolute path",
                ));
            }
            let absolute = workspace.join(&relative);
            let (size_bytes, media_type) = resources
                .workspace_preview_metadata(workspace, absolute.clone())
                .await
                .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
            (
                absolute,
                relative.to_string_lossy().into_owned(),
                size_bytes,
                media_type,
            )
        };
        let absolute_text = absolute.to_string_lossy();
        let source_url = format!(
            "/v2/files/preview?path={}",
            utf8_percent_encode(&absolute_text, NON_ALPHANUMERIC)
        );
        let name = absolute
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| V2Error::invalid_request("workspace file name is invalid"))?
            .to_owned();
        let id = Id::new(format!(
            "workspace-file:{}",
            blake3::hash(returned_path.as_bytes()).to_hex()
        ))
        .map_err(|_| V2Error::source_unavailable("workspace file identity is invalid"))?;
        Ok(QueryResult::WorkspaceFile {
            thread_id,
            path: returned_path,
            file: super::super::super::domain::Attachment {
                id,
                name,
                media_type,
                size_bytes: U64::new(size_bytes),
                download_url: Some(source_url),
            },
        })
    }
}

fn validated_file_path(value: &str) -> Result<PathBuf, V2Error> {
    if value.is_empty() || value.len() > 8_192 || value.contains('\0') {
        return Err(V2Error::invalid_request("workspace file path is invalid"));
    }
    Ok(PathBuf::from(value))
}

fn authorized_file_path(
    authorization: &AuthorizationContext,
    value: &str,
) -> Result<PathBuf, V2Error> {
    let path = validated_file_path(value)?;
    if path.is_absolute() {
        require_scope(authorization, "shell.explicit")?;
    }
    Ok(path)
}

#[derive(Debug, Eq, PartialEq)]
struct ResourcePage {
    attachment_end: usize,
    attachment_start: usize,
    change_end: usize,
    change_start: usize,
    next_offset: usize,
}

fn resource_page(
    change_count: usize,
    attachment_count: usize,
    offset: usize,
    limit: usize,
) -> Result<ResourcePage, V2Error> {
    let total = change_count.saturating_add(attachment_count);
    if offset > total {
        return Err(stale_resource_cursor());
    }
    let next_offset = total.min(offset.saturating_add(limit));
    Ok(ResourcePage {
        attachment_start: offset.saturating_sub(change_count),
        attachment_end: next_offset
            .saturating_sub(change_count)
            .min(attachment_count),
        change_start: offset.min(change_count),
        change_end: next_offset.min(change_count),
        next_offset,
    })
}

fn normalized_workspace_relative_path(value: &str) -> Result<PathBuf, V2Error> {
    let path = validated_file_path(value)?;
    if path.is_absolute() {
        return Err(V2Error::invalid_request(
            "workspace file path must be relative",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir if normalized.pop() => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(V2Error::invalid_request(
                    "workspace file path escapes the thread workspace",
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(V2Error::invalid_request("workspace file path is invalid"));
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_host_file_path_is_distinct_from_workspace_relative_validation() {
        let file_reader = AuthorizationContext::Session {
            device_id: "device".into(),
            scopes: vec!["files.download.workspace".into(), "threads.read".into()],
            expires_at: u64::MAX,
        };
        let terminal = AuthorizationContext::Session {
            device_id: "device".into(),
            scopes: vec![
                "files.download.workspace".into(),
                "shell.explicit".into(),
                "threads.read".into(),
            ],
            expires_at: u64::MAX,
        };
        assert_eq!(
            authorized_file_path(&terminal, "/var/tmp/report.pdf")
                .unwrap_or_else(|error| panic!("valid absolute path failed: {error:?}")),
            PathBuf::from("/var/tmp/report.pdf")
        );
        assert!(authorized_file_path(&file_reader, "/var/tmp/report.pdf").is_err());
        assert!(normalized_workspace_relative_path("/var/tmp/report.pdf").is_err());
    }

    #[test]
    fn workspace_path_is_cwd_relative_and_cannot_escape() {
        assert_eq!(
            normalized_workspace_relative_path("docs/../README.md")
                .unwrap_or_else(|error| panic!("valid path failed: {error:?}")),
            PathBuf::from("README.md")
        );
        for value in ["", "/etc/passwd", "../secret", "docs/../../secret", "\0bad"] {
            assert!(
                normalized_workspace_relative_path(value).is_err(),
                "{value:?}"
            );
        }
    }

    #[test]
    fn resource_pages_do_not_silently_drop_records_after_one_hundred() {
        assert_eq!(
            resource_page(121, 87, 0, 100).unwrap_or_else(|error| panic!("page 1: {error:?}")),
            ResourcePage {
                attachment_end: 0,
                attachment_start: 0,
                change_end: 100,
                change_start: 0,
                next_offset: 100,
            }
        );
        assert_eq!(
            resource_page(121, 87, 100, 100).unwrap_or_else(|error| panic!("page 2: {error:?}")),
            ResourcePage {
                attachment_end: 79,
                attachment_start: 0,
                change_end: 121,
                change_start: 100,
                next_offset: 200,
            }
        );
        assert_eq!(
            resource_page(121, 87, 200, 100).unwrap_or_else(|error| panic!("page 3: {error:?}")),
            ResourcePage {
                attachment_end: 87,
                attachment_start: 79,
                change_end: 121,
                change_start: 121,
                next_offset: 208,
            }
        );
    }
}
