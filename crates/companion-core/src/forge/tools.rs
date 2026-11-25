//! `codewide_link_pull_request {pullRequestUrl}`: the only forge tool an
//! agent has. It writes companion link state only (source `agent`), scoped
//! to the calling thread, and fails as an unsuccessful tool result. It never
//! writes to a forge, starts an auth flow or runs an action.

use std::sync::{Arc, Weak};

use async_trait::async_trait;
use forge_protocol::ForgePrRef;
use serde_json::{Value, json};

use super::{
    ForgeContext,
    ids::{PullRequestKey, parse_thread_id},
    link_resolver::{self, PageUrl},
    wire::LinkSource,
};
use crate::agent::{
    model::{ClientToolSpec, ProviderId, ToolCallParams, ToolCallResult},
    provider::ClientToolHost,
};

pub const LINK_TOOL: &str = "codewide_link_pull_request";
const MAX_URL_BYTES: usize = 2_048;

/// The tool declaration, identical for every provider.
#[must_use]
pub fn spec() -> ClientToolSpec {
    ClientToolSpec {
        name: LINK_TOOL.into(),
        description: "Link this thread to a pull request on a connected forge, so the pull request shows this thread and the thread shows the pull request. It changes only CodeWide's links; it never writes to the forge.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pullRequestUrl": {
                    "type": "string",
                    "description": "The web URL of the pull request, for example https://github.com/owner/repo/pull/12."
                }
            },
            "required": ["pullRequestUrl"],
            "additionalProperties": false
        }),
    }
}

pub struct ForgeTools {
    context: Weak<ForgeContext>,
    specs: Vec<ClientToolSpec>,
}

impl ForgeTools {
    #[must_use]
    pub fn new(context: &Arc<ForgeContext>) -> Arc<Self> {
        Arc::new(Self {
            context: Arc::downgrade(context),
            specs: vec![spec()],
        })
    }

    async fn link(&self, call: &ToolCallParams) -> Result<Value, String> {
        let context = self
            .context
            .upgrade()
            .ok_or_else(|| "no connected forge account".to_owned())?;
        let url = call
            .arguments
            .get("pullRequestUrl")
            .and_then(Value::as_str)
            .filter(|url| url.len() <= MAX_URL_BYTES)
            .ok_or_else(|| "pullRequestUrl must be a URL".to_owned())?;
        let page = PageUrl::parse(url)
            .map_err(|_| "pullRequestUrl must be a credential-free HTTPS URL".to_owned())?;
        let thread = parse_thread_id(call.app_thread_id.as_str())
            .ok_or_else(|| "the calling thread is unknown".to_owned())?;
        let (plugin_id, reference) = unique_target(&context, &page).await?;
        let key = PullRequestKey::issue(&plugin_id, &reference);
        context
            .links
            .link(
                &key,
                &plugin_id,
                &reference.number,
                &thread,
                LinkSource::Agent,
            )
            .map_err(|_| "the link could not be stored".to_owned())?;
        context.cache.invalidate_pull_request(&key);
        context.publish_pr(&key, "pullRequest").await;
        context.events.list().await;
        Ok(json!({"linked": true, "repository": reference.repository, "number": reference.number}))
    }
}

async fn unique_target(
    context: &ForgeContext,
    page: &PageUrl,
) -> Result<(String, ForgePrRef), String> {
    let entries = context
        .providers
        .entries()
        .map_err(|_| "forge providers are unavailable".to_owned())?;
    let mut target = None;
    let mut connected = false;
    for entry in entries
        .into_iter()
        .filter(|entry| entry.enabled && entry.spec.is_some())
    {
        let links = context
            .accounts
            .links_of(&entry.plugin_id)
            .map_err(|_| "forge accounts are unavailable".to_owned())?;
        if links.is_empty() {
            continue;
        }
        connected = true;
        let choices = link_resolver::admit(context, &entry.plugin_id, page, &links)
            .await
            .map_err(|_| "could not verify pull request access".to_owned())?;
        let mut choices = choices.into_iter();
        if let Some(choice) = choices.next() {
            if target.is_some() || choices.next().is_some() {
                return Err("multiple connected forge accounts match this URL".into());
            }
            target = Some((entry.plugin_id, choice.reference));
        }
    }
    target.ok_or_else(|| {
        if connected {
            "no connected forge account owns this URL"
        } else {
            "no connected forge account"
        }
        .to_owned()
    })
}

#[async_trait]
impl ClientToolHost for ForgeTools {
    fn specs(&self) -> &[ClientToolSpec] {
        &self.specs
    }

    async fn call(&self, provider: &ProviderId, call: ToolCallParams) -> ToolCallResult {
        match self.link(&call).await {
            Ok(result) => ToolCallResult::text(result.to_string()),
            Err(message) => {
                tracing::info!(tool = LINK_TOOL, provider = %provider, "forge tool call failed");
                ToolCallResult::failure(message)
            }
        }
    }
}
