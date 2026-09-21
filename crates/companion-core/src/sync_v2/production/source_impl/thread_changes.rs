use super::*;

impl UpstreamSemanticSource {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn thread_change_output(
        &self,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
        generation: u64,
        thread_id: Id,
        path: String,
        scope: ResourceScope,
        cursor: Option<String>,
        limit_bytes: u32,
    ) -> Result<QueryResult, V2Error> {
        require_authenticated_session(authorization)?;
        self.authorize_thread_access(authorization, context, &thread_id, generation)
            .await?;
        let resources = self
            .services
            .resources
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("resource service is unavailable"))?;
        let decoded = cursor
            .as_deref()
            .map(|value| ChangeOutputCursor::decode(value, context, &thread_id, scope, &path))
            .transpose()?;
        let offset = decoded.as_ref().map_or(0, ChangeOutputCursor::offset);
        let result = resources
            .handle(
                "companion/threadChangeOutput/read",
                &json!({
                    "threadId": thread_id.as_str(),
                    "path": path,
                    "changeScope": resource_scope(scope),
                    "offset": offset,
                    "limitBytes": limit_bytes,
                }),
            )
            .await
            .map_err(|error| match error {
                crate::resources::ResourceError::InvalidOffset => stale_resource_cursor(),
                _ => V2Error::source_unavailable(error.to_string()),
            })?;
        let page = parse_change_output_page(&result, &thread_id, &path, scope)?;
        if decoded
            .as_ref()
            .is_some_and(|cursor| cursor.witness() != page.revision)
        {
            return Err(stale_resource_cursor());
        }
        let next = if page.next_offset < page.total_bytes {
            Some(
                ChangeOutputCursor::new(
                    context,
                    thread_id.clone(),
                    scope,
                    &path,
                    page.revision,
                    page.next_offset,
                )
                .encode()?,
            )
        } else {
            None
        };
        Ok(QueryResult::ThreadChangeOutput {
            thread_id,
            path: page.path,
            scope: page.scope,
            content: page.content,
            total_bytes: U64::new(page.total_bytes as u64),
            next,
        })
    }
}

struct ChangeOutputPage {
    content: String,
    next_offset: usize,
    path: String,
    revision: String,
    scope: ResourceScope,
    total_bytes: usize,
}

fn parse_change_output_page(
    result: &Value,
    expected_thread_id: &Id,
    requested_path: &str,
    requested_scope: ResourceScope,
) -> Result<ChangeOutputPage, V2Error> {
    if result.get("threadId").and_then(Value::as_str) != Some(expected_thread_id.as_str()) {
        return Err(V2Error::source_unavailable(
            "thread change output belongs to a different thread",
        ));
    }
    let path = result
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| V2Error::source_unavailable("thread change output omitted path"))?;
    if !same_change_path(path, requested_path) {
        return Err(V2Error::source_unavailable(
            "thread change output belongs to a different path",
        ));
    }
    let scope = serde_json::from_value::<ResourceScope>(
        result
            .get("changeScope")
            .cloned()
            .ok_or_else(|| V2Error::source_unavailable("thread change output omitted scope"))?,
    )
    .map_err(|_| V2Error::source_unavailable("thread change output has invalid scope"))?;
    if scope != requested_scope {
        return Err(V2Error::source_unavailable(
            "thread change output belongs to a different scope",
        ));
    }
    let content = result
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| V2Error::source_unavailable("thread change output omitted content"))?;
    let revision = result
        .get("revision")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| V2Error::source_unavailable("thread change output omitted revision"))?;
    let total_bytes = result
        .get("totalBytes")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| V2Error::source_unavailable("thread change output has invalid length"))?;
    let next_offset = result
        .get("nextOffset")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| V2Error::source_unavailable("thread change output has invalid cursor"))?;
    if next_offset > total_bytes || content.len() > 65_536 {
        return Err(V2Error::source_unavailable(
            "thread change output exceeded its bounds",
        ));
    }
    Ok(ChangeOutputPage {
        content: content.to_owned(),
        next_offset,
        path: path.to_owned(),
        revision: revision.to_owned(),
        scope,
        total_bytes,
    })
}

pub(super) struct ThreadChangeDetail {
    pub(super) path: String,
    pub(super) scope: ResourceScope,
    pub(super) patches: Vec<ThreadChangePatch>,
    pub(super) source: Option<String>,
    pub(super) truncated: bool,
}

pub(super) fn parse_thread_change_result(
    result: &Value,
    expected_thread_id: &Id,
    requested_path: &str,
) -> Result<ThreadChangeDetail, V2Error> {
    if result.get("threadId").and_then(Value::as_str) != Some(expected_thread_id.as_str()) {
        return Err(V2Error::source_unavailable(
            "thread change result belongs to a different thread",
        ));
    }
    let path = result
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| V2Error::source_unavailable("thread change result omitted path"))?;
    if !same_change_path(path, requested_path) {
        return Err(V2Error::source_unavailable(
            "thread change result belongs to a different path",
        ));
    }
    let scope = serde_json::from_value::<ResourceScope>(
        result
            .get("changeScope")
            .cloned()
            .ok_or_else(|| V2Error::source_unavailable("thread change result omitted scope"))?,
    )
    .map_err(|_| V2Error::source_unavailable("thread change result has invalid scope"))?;
    require_source_array_limit(result, "patches", 10_000)?;
    let patches = serde_json::from_value::<Vec<ThreadChangePatch>>(
        result
            .get("patches")
            .cloned()
            .ok_or_else(|| V2Error::source_unavailable("thread change result omitted patches"))?,
    )
    .map_err(|_| V2Error::source_unavailable("thread change result has invalid patches"))?;
    if patches
        .iter()
        .any(|patch| patch.diff.chars().count() > 4_194_304)
    {
        return Err(V2Error::source_unavailable(
            "thread change patch exceeded content limit",
        ));
    }
    let source = match result.get("source") {
        None | Some(Value::Null) => None,
        Some(Value::String(source)) => Some(source.clone()),
        Some(_) => {
            return Err(V2Error::source_unavailable(
                "thread change result has invalid source",
            ));
        }
    };
    let truncated = result
        .get("truncated")
        .and_then(Value::as_bool)
        .ok_or_else(|| V2Error::source_unavailable("thread change result omitted truncation"))?;
    Ok(ThreadChangeDetail {
        path: path.to_owned(),
        scope,
        patches,
        source,
        truncated,
    })
}

fn same_change_path(returned: &str, requested: &str) -> bool {
    let returned = returned.replace('\\', "/");
    let requested = requested.replace('\\', "/");
    let relative = requested.trim_start_matches('/');
    returned == requested || (!relative.is_empty() && returned.ends_with(&format!("/{relative}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authoritative_change_detail_accepts_resolved_paths_and_missing_source()
    -> Result<(), Box<dyn std::error::Error>> {
        let thread_id = Id::new("thread")?;
        let result = json!({
            "threadId": "thread",
            "path": "/workspace/src/main.rs",
            "changeScope": "session",
            "patches": [{
                "turnId": "turn",
                "itemId": "item",
                "kind": "update",
                "diff": "@@ -1 +1 @@\n-old\n+new",
            }],
            "truncated": false,
        });

        let detail = parse_thread_change_result(&result, &thread_id, "src/main.rs")
            .map_err(|error| format!("valid resource response was rejected: {error:?}"))?;

        assert_eq!(detail.path, "/workspace/src/main.rs");
        assert_eq!(detail.scope, ResourceScope::Session);
        assert_eq!(detail.patches.len(), 1);
        assert_eq!(detail.source, None);
        assert!(!detail.truncated);
        Ok(())
    }

    #[test]
    fn authoritative_change_detail_rejects_a_different_path()
    -> Result<(), Box<dyn std::error::Error>> {
        let thread_id = Id::new("thread")?;
        let result = json!({
            "threadId": "thread",
            "path": "/workspace/src/other.rs",
            "changeScope": "session",
            "patches": [],
            "source": null,
            "truncated": false,
        });

        assert!(parse_thread_change_result(&result, &thread_id, "src/main.rs").is_err());
        Ok(())
    }
}
