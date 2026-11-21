//! `companion/pullRequest/fileContent/read`: one complete file of a pull
//! request at a head revision (`forge.fileContent@1`), so a client can show the
//! whole file with the changes inline. The plugin's answer is re-validated
//! before a client sees it; a provider without the capability is refused, and
//! the client keeps its patch-only view.
//!
//! Content at a revision never changes, so nothing is cached here: the client
//! keys its query by connection, pull request, head revision and path.

use forge_protocol::{FileContent, FileContentParams, capability, methods, valid_file_path};
use serde::Deserialize;
use serde_json::Value;

use super::{ForgeContext, errors::ForgeError, ids::HeadRevision, params, wire::FileContentWire};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRequest {
    pull_request: Value,
    head_revision: String,
    path: String,
}

/// # Errors
///
/// Returns `-32080` when the provider lacks `forge.fileContent@1` (without
/// spawning it when its last declaration already says so), invalid params for
/// a malformed head revision or path, or the mapped plugin failure.
pub async fn read(context: &ForgeContext, raw: &Value) -> Result<Value, ForgeError> {
    let request: ReadRequest = params(raw)?;
    let (key, identity) = ForgeContext::pull_request(&request.pull_request)?;
    let head = HeadRevision::parse(&request.head_revision)
        .ok_or_else(|| ForgeError::invalid("invalid headRevision"))?;
    if !valid_file_path(&request.path) {
        return Err(ForgeError::invalid("invalid path"));
    }
    if context
        .declarations
        .get(&identity.plugin_id)
        .is_some_and(|declaration| !declaration.supports(capability::FILE_CONTENT))
    {
        return Err(undeclared(&identity.plugin_id));
    }
    let account = context.account_for(&key, &identity)?;
    let mut session = context.session(&identity.plugin_id).await?;
    let answer: Result<FileContent, _> = session
        .call(
            methods::PULL_REQUEST_FILE_CONTENT,
            &FileContentParams {
                account: account.account_ref(),
                pr_ref: identity.pr_ref.clone(),
                head_revision: head.as_str().to_owned(),
                path: request.path,
            },
        )
        .await;
    session.shutdown().await;
    let answer = answer.map_err(|error| {
        context.observe(
            &account,
            ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error),
        )
    })?;
    serde_json::to_value(validate(answer))
        .map_err(|_| ForgeError::internal("the file content could not be encoded"))
}

fn undeclared(plugin_id: &str) -> ForgeError {
    ForgeError::ProviderUnavailable {
        plugin_id: Some(plugin_id.to_owned()),
        capability: Some(capability::FILE_CONTENT.to_owned()),
        reason: "The provider does not support this".into(),
    }
}

/// The validating adapter of a plugin answer: text is held to the protocol
/// bound and text rules again, so an oversized or binary answer reaches the
/// client as `tooLarge` or `binary`, never as text.
fn validate(content: FileContent) -> FileContentWire {
    let checked = match content {
        FileContent::Text { content } => FileContent::classify(content.into_bytes()),
        other => other,
    };
    match checked {
        FileContent::Text { content } => FileContentWire::Text { content },
        FileContent::TooLarge { bytes } => FileContentWire::TooLarge { bytes },
        FileContent::Binary => FileContentWire::Binary,
        FileContent::Missing => FileContentWire::Missing,
    }
}

#[cfg(test)]
mod tests {
    use forge_protocol::MAX_FILE_CONTENT_BYTES;

    use super::*;

    #[test]
    fn plugin_text_is_revalidated_before_a_client_sees_it() {
        assert_eq!(
            validate(FileContent::Text {
                content: "fn main() {}\n".into()
            }),
            FileContentWire::Text {
                content: "fn main() {}\n".into()
            }
        );
        assert_eq!(
            validate(FileContent::Text {
                content: "a\0b".into()
            }),
            FileContentWire::Binary
        );
        assert_eq!(
            validate(FileContent::Text {
                content: "a".repeat(MAX_FILE_CONTENT_BYTES + 1)
            }),
            FileContentWire::TooLarge {
                bytes: u64::try_from(MAX_FILE_CONTENT_BYTES + 1).ok()
            }
        );
        assert_eq!(
            validate(FileContent::TooLarge { bytes: None }),
            FileContentWire::TooLarge { bytes: None }
        );
        assert_eq!(validate(FileContent::Missing), FileContentWire::Missing);
    }
}
