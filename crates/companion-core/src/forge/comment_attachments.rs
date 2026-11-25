//! Forge-hosted uploads for PR comments. Only the selected plugin receives the bytes.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use forge_protocol::{CommentAttachmentParams, CommentAttachmentResult, methods};

use super::{ForgeService, errors::ForgeError, ids::PullRequestKey};

impl ForgeService {
    /// Resolves the PR/account and requests a stable URL from its declared upload capability.
    ///
    /// # Errors
    /// Returns a typed forge error when ownership, provider support or upload validation fails.
    pub async fn upload_comment_attachment(
        &self,
        pr: &str,
        name: String,
        content_type: String,
        bytes: &[u8],
    ) -> Result<CommentAttachmentResult, ForgeError> {
        let (key, identity) =
            PullRequestKey::parse(pr).ok_or_else(|| ForgeError::invalid("Invalid pull request"))?;
        let account = self.context.account_for(&key, &identity)?;
        let mut session = self.context.session(&identity.plugin_id).await?;
        let result = session
            .call::<_, CommentAttachmentResult>(
                methods::COMMENT_ATTACHMENT_UPLOAD,
                &CommentAttachmentParams {
                    account: account.account_ref(),
                    pr_ref: identity.pr_ref,
                    name,
                    content_type,
                    bytes_base64: STANDARD.encode(bytes),
                },
            )
            .await;
        session.shutdown().await;
        let attachment = result.map_err(|error| {
            ForgeError::from_plugin(&identity.plugin_id, Some(&account.key), error)
        })?;
        let url = url::Url::parse(&attachment.url)
            .map_err(|_| ForgeError::invalid("Invalid forge attachment URL"))?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(ForgeError::invalid("Invalid forge attachment URL"));
        }
        Ok(attachment)
    }
}
